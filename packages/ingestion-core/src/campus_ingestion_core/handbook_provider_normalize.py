from __future__ import annotations

import json
from pathlib import Path
import unicodedata


LAYOUT_ELEMENTS_SCHEMA_VERSION = "student_handbook_layout_elements_v1"


def normalize_handbook_provider_result(
    *,
    source_pdf: str,
    provider_jsonl_bytes: bytes,
    ocr_provider: str,
    ocr_model: str,
    source_artifact_id: str | None = None,
) -> list[dict[str, object]]:
    provider_jsonl = provider_jsonl_bytes.decode("utf-8")
    raw_lines = [line.strip() for line in provider_jsonl.splitlines() if line.strip()]
    if not raw_lines:
        raise ValueError("provider result is empty")

    normalized_rows: list[dict[str, object]] = []
    artifact_id = source_artifact_id or f"asset:{_slugify_filename(source_pdf)}"
    expected_page_id = 1
    row_index = 1

    for line_index, line in enumerate(raw_lines, start=1):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"provider result line {line_index} is not valid JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError(f"provider result line {line_index} must be a JSON object")
        page_payloads = _extract_page_payloads(payload=payload, line_index=line_index, expected_page_id=expected_page_id)
        for page_payload in page_payloads:
            provider_page_id = page_payload["provider_page_id"]
            if provider_page_id != expected_page_id:
                raise ValueError("provider pages must be contiguous and 1-based")
            page_rows = _normalize_page_rows(
                page_payload=page_payload["page_payload"],
                line_index=line_index,
                page_in_line=page_payload["page_in_line"],
                source_pdf=source_pdf,
                source_artifact_id=artifact_id,
                provider_page_id=provider_page_id,
                ocr_provider=ocr_provider,
                ocr_model=ocr_model,
                row_index_start=row_index,
            )
            if not page_rows:
                raise ValueError(f"provider page {provider_page_id} produced no structured rows")
            normalized_rows.extend(page_rows)
            row_index += len(page_rows)
            expected_page_id += 1

    return normalized_rows


def serialize_handbook_layout_elements(rows: list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _normalize_page_rows(
    *,
    page_payload: dict[str, object],
    line_index: int,
    page_in_line: int,
    source_pdf: str,
    source_artifact_id: str,
    provider_page_id: int,
    ocr_provider: str,
    ocr_model: str,
    row_index_start: int,
) -> list[dict[str, object]]:
    layout_results = _extract_page_blocks(page_payload)
    if not layout_results:
        raise ValueError(f"provider page {provider_page_id} is missing layout blocks")

    rows: list[dict[str, object]] = []
    for block_index, item in enumerate(layout_results, start=1):
        if not isinstance(item, dict):
            continue
        row_type, block_role = _map_row_type(item)
        text_raw = _extract_text_raw(item)
        html = _extract_html(item)
        table_cells = _extract_table_cells(item)
        heading_level = _coerce_int(item.get("headingLevel"))
        if row_type == "heading" and heading_level is None:
            heading_level = 1 if block_role == "title" else None
        rows.append(
            {
                "schema_version": LAYOUT_ELEMENTS_SCHEMA_VERSION,
                "corpus": "regulations",
                "collection": "student_handbook",
                "source_artifact_id": source_artifact_id,
                "source_pdf": source_pdf,
                "page_start": provider_page_id,
                "page_end": provider_page_id,
                "row_id": f"page-{provider_page_id:04d}-row-{block_index:04d}",
                "row_index": row_index_start + block_index - 1,
                "ocr_provider": ocr_provider,
                "ocr_model": ocr_model,
                "provider_page_id": provider_page_id,
                "provider_block_id": str(item.get("blockId") or item.get("block_id") or f"block-{block_index:04d}"),
                "provider_payload_ref": f"line:{line_index}#page:{page_in_line}#block:{block_index}",
                "confidence": _coerce_float(item.get("confidence")),
                "row_type": row_type,
                "block_role": block_role,
                "heading_level": heading_level,
                "reading_order": _coerce_int(item.get("readingOrder") or item.get("block_order")) or block_index,
                "bbox": _normalize_bbox(item.get("bbox") or item.get("block_bbox") or item.get("block_polygon_points")),
                "text_raw": text_raw,
                "text_normalized": _normalize_text(text_raw),
                "html": html,
                "table_cells": table_cells,
                "is_blank": not _normalize_text(text_raw) and not html and not table_cells,
                "is_repeated_candidate": row_type in {"header", "footer", "page_number"},
                "title_candidate_score": 1.0 if block_role == "title" else (0.75 if row_type == "heading" else 0.0),
                "section_hint": _normalize_text(text_raw) if row_type == "heading" else None,
            }
        )
    return rows


def _extract_page_payloads(
    *,
    payload: dict[str, object],
    line_index: int,
    expected_page_id: int,
) -> list[dict[str, object]]:
    result_payload = payload.get("result")
    if not isinstance(result_payload, dict):
        raise ValueError(f"provider result line {line_index} is missing result payload")
    layout_results = result_payload.get("layoutParsingResults")
    if not isinstance(layout_results, list):
        raise ValueError(f"provider result line {line_index} is missing layoutParsingResults")
    data_info = result_payload.get("dataInfo")
    if not isinstance(data_info, dict):
        raise ValueError(f"provider result line {line_index} must use batch provider payload shape")
    if not layout_results or not all(isinstance(item, dict) for item in layout_results):
        raise ValueError(f"provider result line {line_index} must use batch provider payload shape")

    expected_pages_in_line = None
    expected_pages_in_line = _coerce_int(data_info.get("numPages"))
    if expected_pages_in_line is not None and expected_pages_in_line != len(layout_results):
        raise ValueError("provider batch page count does not match layoutParsingResults length")
    return [
        {
            "provider_page_id": expected_page_id + page_index - 1,
            "page_in_line": page_index,
            "page_payload": page_payload,
        }
        for page_index, page_payload in enumerate(layout_results, start=1)
        if isinstance(page_payload, dict)
    ]


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
    if isinstance(markdown, dict):
        text = markdown.get("text")
        html = markdown.get("html")
        if isinstance(text, str) and text.strip():
            return [{"blockType": "paragraph", "markdown": {"text": text, "html": html}}]
    if isinstance(markdown, str) and markdown.strip():
        return [{"blockType": "paragraph", "markdown": {"text": markdown}}]
    return []


def _map_row_type(item: dict[str, object]) -> tuple[str, str]:
    raw_type = str(
        item.get("blockType")
        or item.get("blockRole")
        or item.get("type")
        or item.get("block_label")
        or ""
    ).strip().lower()
    if raw_type == "doc_title":
        return "heading", "title"
    if raw_type == "paragraph_title":
        return "heading", "heading"
    if raw_type in {"title", "heading"}:
        return "heading", "title" if raw_type == "title" else "heading"
    if raw_type in {"header"}:
        return "header", "header"
    if raw_type in {"footer"}:
        return "footer", "footer"
    if raw_type in {"aside_text", "vertical_text"}:
        return "header", "header"
    if raw_type in {"page_number", "pagenumber"}:
        return "page_number", "page_number"
    if raw_type == "number":
        return "page_number", "page_number"
    if raw_type in {"table"}:
        return "table", "table"
    if raw_type == "header_image":
        return "image", "header_image"
    if raw_type == "footer_image":
        return "image", "footer_image"
    if raw_type in {"image", "figure"}:
        return "image", "image"
    if raw_type in {"text", "paragraph", "body"}:
        return "paragraph", "body"

    html = _extract_html(item)
    table_cells = _extract_table_cells(item)
    if table_cells or (html is not None and "<table" in html.lower()):
        return "table", "table"
    if _extract_text_raw(item):
        return "paragraph", "body"
    return "unknown", "unknown"


def _extract_text_raw(item: dict[str, object]) -> str:
    block_content = item.get("block_content")
    if isinstance(block_content, str):
        return block_content
    markdown = item.get("markdown")
    if isinstance(markdown, dict):
        text = markdown.get("text")
        if isinstance(text, str):
            return text
    text = item.get("text")
    if isinstance(text, str):
        return text
    return ""


def _extract_html(item: dict[str, object]) -> str | None:
    block_content = item.get("block_content")
    if isinstance(block_content, str) and "<table" in block_content.lower():
        return block_content
    markdown = item.get("markdown")
    if isinstance(markdown, dict):
        value = markdown.get("html")
        if isinstance(value, str) and value.strip():
            return value
    value = item.get("html")
    if isinstance(value, str) and value.strip():
        return value
    return None


def _extract_table_cells(item: dict[str, object]) -> list[list[str]] | None:
    html = _extract_html(item)
    if html is not None and "<table" in html.lower():
        extracted = _extract_table_cells_from_html(html)
        if extracted:
            return extracted
    raw_cells = item.get("tableCells")
    if not isinstance(raw_cells, list):
        return None
    normalized_rows: list[list[str]] = []
    for row in raw_cells:
        if not isinstance(row, list):
            continue
        normalized_rows.append([str(cell) for cell in row])
    return normalized_rows or None


def _normalize_bbox(value: object) -> list[float] | None:
    if (
        isinstance(value, list)
        and value
        and all(isinstance(item, (list, tuple)) and len(item) >= 2 for item in value)
    ):
        xs = [float(item[0]) for item in value if isinstance(item[0], (int, float))]
        ys = [float(item[1]) for item in value if isinstance(item[1], (int, float))]
        if xs and ys:
            return [min(xs), min(ys), max(xs), max(ys)]
    if not isinstance(value, list):
        return None
    normalized: list[float] = []
    for item in value:
        if isinstance(item, (int, float)):
            normalized.append(float(item))
    return normalized or None


def _normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text.replace("\r\n", "\n").replace("\r", "\n"))
    output_lines: list[str] = []
    previous_blank = False
    for raw_line in normalized.split("\n"):
        collapsed = " ".join(raw_line.split()).strip()
        if not collapsed:
            if output_lines and not previous_blank:
                output_lines.append("")
            previous_blank = True
            continue
        output_lines.append(collapsed)
        previous_blank = False
    while output_lines and output_lines[0] == "":
        output_lines.pop(0)
    while output_lines and output_lines[-1] == "":
        output_lines.pop()
    return "\n".join(output_lines)


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


def _coerce_float(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        return float(value)
    return None


def _slugify_filename(filename: str) -> str:
    stem = Path(filename).stem.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in stem).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "document"


def _extract_table_cells_from_html(html: str) -> list[list[str]] | None:
    import re

    rows = re.findall(r"<tr\b[^>]*>(.*?)</tr>", html, flags=re.IGNORECASE | re.DOTALL)
    if not rows:
        return None
    table_rows: list[list[str]] = []
    for row_html in rows:
        cells = re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", row_html, flags=re.IGNORECASE | re.DOTALL)
        normalized_cells = [_normalize_text(re.sub(r"<[^>]+>", "", cell)) for cell in cells]
        normalized_cells = [cell for cell in normalized_cells if cell]
        if normalized_cells:
            table_rows.append(normalized_cells)
    return table_rows or None
