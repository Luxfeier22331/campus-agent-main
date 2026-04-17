from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any

from campus_ingestion_core.chunking import serialize_table_unit_text
from campus_ingestion_core.source_truth_common import (
    detect_merged_cells,
    extract_html_table_grid,
    infer_table_column_count,
    infer_table_header_rows,
    infer_table_row_count,
    normalize_bbox,
    normalize_text,
    serialize_layout_rows,
)


_LAYOUT_SCHEMA_VERSION = "authenticated_notice_attachment_ocr_layout_v1"
_TABLE_LIKE_ROW_TYPES = frozenset({"table", "figure_table", "table_caption"})
_HEADING_LIKE_ROW_TYPES = frozenset({"doc_title", "paragraph_title", "title", "heading"})
_SKIPPED_ROW_TYPES = frozenset({"header", "footer", "page_number"})


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeOcrAttachmentArtifacts:
    layout_elements_bytes: bytes
    document_units_bytes: bytes
    body_markdown: str


def build_authenticated_notice_ocr_attachment_artifacts(
    *,
    document_id: str,
    version_id: str,
    source_uri: str,
    title: str,
    attachment_ref_id: str,
    provider_response_bytes: bytes,
    metadata: dict[str, object],
) -> AuthenticatedNoticeOcrAttachmentArtifacts | None:
    layout_rows = _normalize_layout_rows(
        provider_response_bytes=provider_response_bytes,
        source_artifact_id=document_id,
    )
    if not layout_rows:
        return None
    document_unit_rows, body_markdown = _build_document_unit_rows(
        document_id=document_id,
        version_id=version_id,
        source_uri=source_uri,
        title=title,
        attachment_ref_id=attachment_ref_id,
        layout_rows=layout_rows,
        metadata=metadata,
    )
    if len(document_unit_rows) <= 1:
        return None
    return AuthenticatedNoticeOcrAttachmentArtifacts(
        layout_elements_bytes=serialize_layout_rows(layout_rows),
        document_units_bytes=_jsonl_bytes(document_unit_rows),
        body_markdown=body_markdown,
    )


def _normalize_layout_rows(
    *,
    provider_response_bytes: bytes,
    source_artifact_id: str,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    page_number = 0
    row_index = 0
    for page_payload in _iter_page_payloads(provider_response_bytes):
        page_number += 1
        for block_index, block in enumerate(_extract_page_blocks(page_payload), start=1):
            row = _normalize_block(
                block=block,
                source_artifact_id=source_artifact_id,
                page_number=page_number,
                row_index=row_index + 1,
                block_index=block_index,
            )
            if row is None:
                continue
            rows.append(row)
            row_index += 1
    return rows


def _iter_page_payloads(provider_response_bytes: bytes) -> tuple[dict[str, object], ...]:
    decoded = provider_response_bytes.decode("utf-8")
    raw_lines = [line.strip() for line in decoded.splitlines() if line.strip()]
    if not raw_lines:
        raise ValueError("ocr provider payload must not be empty")
    page_payloads: list[dict[str, object]] = []
    for line_number, line in enumerate(raw_lines, start=1):
        payload = json.loads(line)
        candidate = payload.get("result") if isinstance(payload, dict) and isinstance(payload.get("result"), dict) else payload
        if not isinstance(candidate, dict):
            raise ValueError(f"ocr provider payload line {line_number} must be a JSON object")
        layout_results = candidate.get("layoutParsingResults")
        if isinstance(layout_results, list) and layout_results:
            if all(_looks_like_page_payload(item) for item in layout_results):
                page_payloads.extend(dict(item) for item in layout_results if isinstance(item, dict))
                continue
            if all(_looks_like_block(item) for item in layout_results):
                page_payloads.append({"blocks": list(layout_results)})
                continue
        if _looks_like_page_payload(candidate):
            page_payloads.append(candidate)
            continue
        raise ValueError(f"ocr provider payload line {line_number} is missing page payloads")
    return tuple(page_payloads)


def _looks_like_page_payload(value: object) -> bool:
    return isinstance(value, dict) and any(
        key in value for key in ("prunedResult", "blocks", "markdown", "pageInfo")
    )


def _looks_like_block(value: object) -> bool:
    return isinstance(value, dict) and any(
        key in value
        for key in (
            "blockId",
            "block_id",
            "blockType",
            "block_label",
            "block_content",
            "tableCells",
            "markdown",
        )
    )


def _extract_page_blocks(page_payload: dict[str, object]) -> list[dict[str, object]]:
    blocks = page_payload.get("blocks")
    if isinstance(blocks, list):
        return [item for item in blocks if isinstance(item, dict)]
    pruned_result = page_payload.get("prunedResult")
    if isinstance(pruned_result, dict):
        parsing_res_list = pruned_result.get("parsing_res_list")
        if isinstance(parsing_res_list, list):
            return [item for item in parsing_res_list if isinstance(item, dict)]
    markdown = page_payload.get("markdown")
    if isinstance(markdown, dict) and str(markdown.get("text") or "").strip():
        return [{"blockType": "paragraph", "markdown": dict(markdown)}]
    if isinstance(markdown, str) and markdown.strip():
        return [{"blockType": "paragraph", "markdown": {"text": markdown}}]
    return []


def _normalize_block(
    *,
    block: dict[str, object],
    source_artifact_id: str,
    page_number: int,
    row_index: int,
    block_index: int,
) -> dict[str, object] | None:
    raw_type = str(
        block.get("blockType")
        or block.get("blockRole")
        or block.get("type")
        or block.get("block_label")
        or ""
    ).strip().lower()
    table_cells = _extract_table_cells(block)
    text_raw = _extract_text(block)
    text_normalized = normalize_text(text_raw)
    html = _extract_html(block)
    row_type = _classify_row_type(raw_type=raw_type, table_cells=table_cells, text=text_normalized)
    if row_type in _SKIPPED_ROW_TYPES:
        return None
    if not text_normalized and not table_cells:
        return None
    return {
        "schema_version": _LAYOUT_SCHEMA_VERSION,
        "corpus": "campus_notices",
        "collection": "internal_notice",
        "source_artifact_id": source_artifact_id,
        "page_start": page_number,
        "page_end": page_number,
        "row_id": f"page-{page_number:04d}-row-{block_index:04d}",
        "row_index": row_index,
        "provider_page_id": page_number,
        "provider_block_id": str(block.get("blockId") or block.get("block_id") or f"block-{block_index:04d}"),
        "reading_order": _coerce_int(block.get("readingOrder") or block.get("block_order")) or block_index,
        "row_type": row_type,
        "block_role": "table" if row_type == "table" else ("heading" if row_type == "heading" else "paragraph"),
        "heading_level": 1 if row_type == "heading" else None,
        "bbox": normalize_bbox(block.get("bbox") or block.get("block_bbox") or block.get("block_polygon_points")),
        "text_raw": text_raw,
        "text_normalized": text_normalized,
        "html": html,
        "table_cells": table_cells,
        "table_header_rows": infer_table_header_rows(table_cells),
        "table_row_count": infer_table_row_count(table_cells),
        "table_column_count": infer_table_column_count(table_cells),
        "table_has_merged_cells": detect_merged_cells(table_cells),
        "section_hint": text_normalized if row_type == "heading" else None,
    }


def _extract_text(block: dict[str, object]) -> str:
    markdown = block.get("markdown")
    if isinstance(markdown, dict):
        text = markdown.get("text")
        if isinstance(text, str) and text.strip():
            return text
    block_content = block.get("block_content")
    if isinstance(block_content, str) and block_content.strip():
        return block_content
    text = block.get("text")
    if isinstance(text, str) and text.strip():
        return text
    return ""


def _extract_html(block: dict[str, object]) -> str | None:
    markdown = block.get("markdown")
    if isinstance(markdown, dict):
        html = _coerce_html(markdown.get("html"))
        if html:
            return html
        html = _coerce_html(markdown.get("text"))
        if html:
            return html
    html = _coerce_html(block.get("html"))
    if html:
        return html
    html = _coerce_html(block.get("block_content"))
    if html:
        return html
    return None


def _extract_table_cells(block: dict[str, object]) -> list[list[str]] | None:
    value = block.get("tableCells") or block.get("table_cells")
    if isinstance(value, list) and value and all(isinstance(row, list) for row in value):
        normalized_rows: list[list[str]] = []
        for row in value:
            normalized_row = [normalize_text(str(cell)) for cell in row if normalize_text(str(cell))]
            if normalized_row:
                normalized_rows.append(normalized_row)
        if normalized_rows:
            return normalized_rows
    html = _extract_html(block)
    if html:
        return extract_html_table_grid(html)
    return None


def _coerce_html(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    lowered = normalized.lower()
    if "<table" in lowered or (normalized.startswith("<") and normalized.endswith(">")):
        return normalized
    return None


def _classify_row_type(
    *,
    raw_type: str,
    table_cells: list[list[str]] | None,
    text: str,
) -> str:
    if table_cells:
        return "table"
    if raw_type in _TABLE_LIKE_ROW_TYPES:
        return "table"
    if raw_type in _HEADING_LIKE_ROW_TYPES:
        return "heading"
    if raw_type in _SKIPPED_ROW_TYPES:
        return raw_type
    if (
        text
        and "\n" not in text
        and "\r" not in text
        and len(text) <= 32
        and not any(ch in text for ch in ("。", "；", "：", ".", ";", ":"))
    ):
        return "heading"
    return "paragraph"


def _build_document_unit_rows(
    *,
    document_id: str,
    version_id: str,
    source_uri: str,
    title: str,
    attachment_ref_id: str,
    layout_rows: list[dict[str, object]],
    metadata: dict[str, object],
) -> tuple[list[dict[str, object]], str]:
    shared_anchor = {
        "source_uri": source_uri,
        "attachment_ref_id": attachment_ref_id,
        "resource_role": metadata.get("source_resource_role"),
    }
    shared_metadata = dict(metadata)
    shared_metadata["title"] = title
    rows: list[dict[str, object]] = [
        _structured_row(
            document_id=document_id,
            version_id=version_id,
            chunk_id="attachment-title",
            root_unit_id="attachment-title",
            unit_type="attachment_title",
            clean_text=title,
            anchor=shared_anchor,
            metadata=shared_metadata,
        )
    ]
    markdown_parts: list[str] = []
    section_index = 0
    table_index = 0
    pending_heading: str | None = None
    current_section_lines: list[str] = []
    current_section_path: list[str] = []
    current_page_start: int | None = None
    current_page_end: int | None = None

    def flush_section() -> None:
        nonlocal section_index, current_section_lines, current_section_path, current_page_start, current_page_end
        if not current_section_lines:
            return
        section_index += 1
        section_text = "\n\n".join(line for line in current_section_lines if line.strip()).strip()
        if not section_text:
            current_section_lines = []
            current_section_path = []
            current_page_start = None
            current_page_end = None
            return
        anchor = dict(shared_anchor)
        if current_page_start is not None:
            anchor["page_start"] = current_page_start
        if current_page_end is not None:
            anchor["page_end"] = current_page_end
        if current_section_path:
            anchor["section_path"] = list(current_section_path)
        rows.append(
            _structured_row(
                document_id=document_id,
                version_id=version_id,
                chunk_id=f"attachment-section-{section_index:04d}",
                root_unit_id=f"attachment-section-{section_index:04d}",
                unit_type="section_text",
                clean_text=section_text,
                anchor=anchor,
                metadata={
                    **shared_metadata,
                    "block_role": "section_text",
                    "section_heading": current_section_path[-1] if current_section_path else None,
                },
            )
        )
        markdown_parts.append(section_text)
        current_section_lines = []
        current_section_path = []
        current_page_start = None
        current_page_end = None

    for layout_row in sorted(
        layout_rows,
        key=lambda item: (
            int(item.get("page_start") or 0),
            int(item.get("row_index") or 0),
            int(item.get("reading_order") or 0),
        ),
    ):
        row_type = str(layout_row.get("row_type") or "")
        page_start = _coerce_int(layout_row.get("page_start"))
        page_end = _coerce_int(layout_row.get("page_end")) or page_start
        if row_type == "heading":
            flush_section()
            pending_heading = str(layout_row.get("text_normalized") or "").strip() or None
            current_section_path = [pending_heading] if pending_heading else []
            current_page_start = page_start
            current_page_end = page_end
            continue
        if row_type == "table":
            flush_section()
            table_index += 1
            table_rows = _build_table_rows(
                document_id=document_id,
                version_id=version_id,
                table_index=table_index,
                layout_row=layout_row,
                shared_anchor=shared_anchor,
                shared_metadata=shared_metadata,
                current_section_path=current_section_path,
                pending_heading=pending_heading,
            )
            if table_rows:
                rows.extend(table_rows)
                markdown_parts.append(_render_table_markdown(table_rows[-1]))
            pending_heading = None
            current_section_path = [heading for heading in current_section_path if heading]
            continue
        text = str(layout_row.get("text_normalized") or "").strip()
        if not text:
            continue
        if pending_heading:
            current_section_lines = [pending_heading]
            current_section_path = [pending_heading]
            pending_heading = None
        elif not current_section_lines and current_section_path:
            current_section_lines = [current_section_path[-1]]
        current_section_lines.append(text)
        current_page_start = current_page_start or page_start
        current_page_end = page_end or current_page_end

    flush_section()
    return rows, "\n\n".join(part for part in markdown_parts if part.strip()).strip()


def _build_table_rows(
    *,
    document_id: str,
    version_id: str,
    table_index: int,
    layout_row: dict[str, object],
    shared_anchor: dict[str, object],
    shared_metadata: dict[str, object],
    current_section_path: list[str],
    pending_heading: str | None,
) -> list[dict[str, object]]:
    table_cells = layout_row.get("table_cells")
    if not isinstance(table_cells, list) or not table_cells:
        return []
    caption_lines = tuple(
        dict.fromkeys(
            line
            for line in (
                pending_heading,
                current_section_path[-1] if current_section_path else None,
            )
            if isinstance(line, str) and line.strip()
        )
    )
    header_rows = infer_table_header_rows(table_cells) or []
    header_line = " | ".join(header_rows[0]) if header_rows else ""
    body_rows = list(table_cells)
    if header_rows and body_rows and body_rows[0] == header_rows[0]:
        body_rows = body_rows[1:]
    row_lines = tuple(" | ".join(str(cell) for cell in row) for row in body_rows if row)
    note_lines: tuple[str, ...] = ()
    clean_text = serialize_table_unit_text(
        caption_lines=caption_lines,
        header_line=header_line,
        row_lines=row_lines,
        note_lines=note_lines,
    )
    anchor = dict(shared_anchor)
    if layout_row.get("page_start") is not None:
        anchor["page_start"] = int(layout_row["page_start"])
    if layout_row.get("page_end") is not None:
        anchor["page_end"] = int(layout_row["page_end"])
    if current_section_path:
        anchor["section_path"] = list(current_section_path)
    root_unit_id = f"attachment-table-{table_index:04d}"
    table_metadata = {
        **shared_metadata,
        "block_role": "table",
        "caption_lines": list(caption_lines),
        "note_lines": list(note_lines),
        "table_header_rows": [list(row) for row in header_rows],
        "table_body_rows": [list(row) for row in body_rows],
        "table_header_line": header_line,
        "table_row_lines": list(row_lines),
        "table_header_row_count": len(header_rows),
        "table_row_count": len(body_rows),
        "table_column_count": infer_table_column_count(table_cells),
    }
    return [
        _structured_row(
            document_id=document_id,
            version_id=version_id,
            chunk_id=root_unit_id,
            root_unit_id=root_unit_id,
            unit_type="table",
            clean_text=clean_text,
            anchor=anchor,
            metadata=table_metadata,
            html=layout_row.get("html"),
            table_cells=table_cells,
        ),
        _structured_row(
            document_id=document_id,
            version_id=version_id,
            chunk_id=f"{root_unit_id}-unit",
            root_unit_id=root_unit_id,
            unit_type="table_unit",
            clean_text=clean_text,
            anchor=anchor,
            metadata=table_metadata,
            table_cells=table_cells,
        ),
    ]


def _render_table_markdown(table_unit_row: dict[str, object]) -> str:
    metadata = dict(table_unit_row.get("metadata") or {})
    parts: list[str] = []
    parts.extend(str(item).strip() for item in list(metadata.get("caption_lines") or []) if str(item).strip())
    header_rows = list(metadata.get("table_header_rows") or [])
    body_rows = list(metadata.get("table_body_rows") or [])
    if header_rows:
        header = [str(cell).strip() for cell in list(header_rows[0]) if str(cell).strip()]
        if header:
            parts.append(f"| {' | '.join(header)} |")
            parts.append(f"| {' | '.join('---' for _ in header)} |")
    for row in body_rows:
        normalized = [str(cell).strip() for cell in list(row) if str(cell).strip()]
        if normalized:
            parts.append(f"| {' | '.join(normalized)} |")
    if not parts:
        return str(table_unit_row.get("clean_text") or "")
    return "\n".join(parts).strip()


def _structured_row(
    *,
    document_id: str,
    version_id: str,
    chunk_id: str,
    root_unit_id: str,
    unit_type: str,
    clean_text: str,
    anchor: dict[str, object],
    metadata: dict[str, object],
    html: object | None = None,
    table_cells: object | None = None,
) -> dict[str, object]:
    normalized_text = clean_text.strip()
    row = {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": chunk_id,
        "root_unit_id": root_unit_id,
        "unit_type": unit_type,
        "text": normalized_text,
        "raw_text": normalized_text,
        "clean_text": normalized_text,
        "anchor": dict(anchor),
        "metadata": dict(metadata),
    }
    if html is not None:
        row["html"] = html
    if table_cells is not None:
        row["table_cells"] = table_cells
    return row


def _jsonl_bytes(rows: list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _coerce_int(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip():
        return int(value)
    return None


__all__ = [
    "AuthenticatedNoticeOcrAttachmentArtifacts",
    "build_authenticated_notice_ocr_attachment_artifacts",
]
