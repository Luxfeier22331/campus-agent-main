from __future__ import annotations

import hashlib
import json
from pathlib import Path

from campus_ingestion_core.handbook_cleanup_shared import RUNNING_HEADER_LINES
from campus_ingestion_core.source_truth_common import (
    detect_merged_cells,
    enrich_cross_page_continuations,
    enrich_parent_heading_hints,
    enrich_repeated_candidates,
    extract_html_table_grid,
    infer_list_level_hint,
    infer_table_column_count,
    infer_table_header_rows,
    infer_table_row_count,
    is_bottom_band,
    is_top_band,
    normalize_bbox,
    normalize_text,
    serialize_layout_rows,
)

LAYOUT_ELEMENTS_SCHEMA_VERSION = "student_handbook_layout_elements_v3"


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
        page_payloads = _extract_page_payloads(
            payload=payload, line_index=line_index, expected_page_id=expected_page_id
        )
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

    return _enrich_layout_rows(normalized_rows)


def serialize_handbook_layout_elements(rows: list[dict[str, object]]) -> bytes:
    return serialize_layout_rows(rows)


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

    page_height = _extract_page_height(page_payload)
    rows: list[dict[str, object]] = []
    for block_index, item in enumerate(layout_results, start=1):
        if not isinstance(item, dict):
            continue
        text_raw = _extract_text_raw(item)
        text_normalized = normalize_text(text_raw)
        html = _extract_html(item)
        table_cells = _extract_table_cells(item)
        bbox = normalize_bbox(
            item.get("bbox") or item.get("block_bbox") or item.get("block_polygon_points")
        )
        row_type, block_role, classification_confidence, classification_reason = _classify_block(
            item=item,
            text_normalized=text_normalized,
            html=html,
            table_cells=table_cells,
            bbox=bbox,
            page_height=page_height,
        )
        heading_level = _coerce_int(item.get("headingLevel"))
        if row_type == "heading" and heading_level is None:
            heading_level = 1 if block_role == "title" else None
        table_header_rows = infer_table_header_rows(table_cells)
        rows.append(
            {
                "schema_version": LAYOUT_ELEMENTS_SCHEMA_VERSION,
                "corpus": "regulations",
                "collection": "student_rules",
                "source_artifact_id": source_artifact_id,
                "source_pdf": source_pdf,
                "page_start": provider_page_id,
                "page_end": provider_page_id,
                "row_id": f"page-{provider_page_id:04d}-row-{block_index:04d}",
                "row_index": row_index_start + block_index - 1,
                "ocr_provider": ocr_provider,
                "ocr_model": ocr_model,
                "provider_page_id": provider_page_id,
                "provider_block_id": str(
                    item.get("blockId") or item.get("block_id") or f"block-{block_index:04d}"
                ),
                "provider_payload_ref": f"line:{line_index}#page:{page_in_line}#block:{block_index}",
                "confidence": _coerce_float(item.get("confidence")),
                "row_type": row_type,
                "block_role": block_role,
                "heading_level": heading_level,
                "reading_order": _coerce_int(item.get("readingOrder") or item.get("block_order"))
                or block_index,
                "bbox": bbox,
                "text_raw": text_raw,
                "text_normalized": text_normalized,
                "html": html,
                "table_cells": table_cells,
                "is_blank": not text_normalized and not html and not table_cells,
                "is_repeated_candidate": row_type in {"header", "footer", "page_number"},
                "title_candidate_score": 1.0
                if block_role == "title"
                else (0.75 if row_type == "heading" else 0.0),
                "section_hint": text_normalized if row_type == "heading" else None,
                "classification_confidence": classification_confidence,
                "classification_reason": classification_reason,
                "repeat_cluster_id": None,
                "repeat_frequency": 0,
                "repeat_position_band": None,
                "parent_heading_hint": None,
                "list_level_hint": infer_list_level_hint(text_normalized),
                "continues_from_previous_page": False,
                "continues_to_next_page": False,
                "table_fragment_id": None,
                "table_header_rows": table_header_rows,
                "table_row_count": infer_table_row_count(table_cells),
                "table_column_count": infer_table_column_count(table_cells),
                "table_has_merged_cells": detect_merged_cells(table_cells),
                "table_caption_hint": _infer_table_caption_hint(
                    text_normalized=text_normalized, row_type=row_type
                ),
            }
        )
    return rows


def _extract_page_height(page_payload: dict[str, object]) -> float | None:
    pruned_result = page_payload.get("prunedResult")
    if isinstance(pruned_result, dict):
        height = _coerce_float(pruned_result.get("height"))
        if height is not None and height > 0:
            return height
    page_info = page_payload.get("pageInfo")
    if isinstance(page_info, dict):
        height = _coerce_float(page_info.get("height"))
        if height is not None and height > 0:
            return height
    return None


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


def _classify_block(
    *,
    item: dict[str, object],
    text_normalized: str,
    html: str | None,
    table_cells: list[list[str]] | None,
    bbox: list[float] | None,
    page_height: float | None,
) -> tuple[str, str, float, str]:
    raw_type = (
        str(
            item.get("blockType")
            or item.get("blockRole")
            or item.get("type")
            or item.get("block_label")
            or ""
        )
        .strip()
        .lower()
    )
    if raw_type == "doc_title":
        return "heading", "title", 0.99, "provider_label:doc_title"
    if raw_type == "paragraph_title":
        return "heading", "heading", 0.92, "provider_label:paragraph_title"
    if raw_type in {"title", "heading"}:
        return (
            "heading",
            "title" if raw_type == "title" else "heading",
            0.9,
            f"provider_label:{raw_type}",
        )
    if raw_type in {"header"}:
        return "header", "header", 0.96, "provider_label:header"
    if raw_type in {"footer"}:
        return "footer", "footer", 0.96, "provider_label:footer"
    if raw_type in {"aside_text", "vertical_text"}:
        if is_top_band(bbox=bbox, page_height=page_height) and len(text_normalized) <= 16:
            return "paragraph", "body", 0.6, f"provider_label:{raw_type}:needs_repeat_validation"
        return "paragraph", "body", 0.7, f"provider_label:{raw_type}:body_fallback"
    if raw_type in {"page_number", "pagenumber"}:
        return "page_number", "page_number", 0.98, f"provider_label:{raw_type}"
    if raw_type == "number":
        if _looks_like_page_number(
            text_normalized=text_normalized, bbox=bbox, page_height=page_height
        ):
            return "page_number", "page_number", 0.82, "provider_label:number:page_number_heuristic"
        return "paragraph", "body", 0.55, "provider_label:number:body_fallback"
    if raw_type in {"table"}:
        return "table", "table", 0.98, "provider_label:table"
    if raw_type == "header_image":
        return "image", "header_image", 0.95, "provider_label:header_image"
    if raw_type == "footer_image":
        return "image", "footer_image", 0.95, "provider_label:footer_image"
    if raw_type in {"image", "figure"}:
        return "image", "image", 0.92, f"provider_label:{raw_type}"
    if raw_type in {"footnote"}:
        return "footnote", "footnote", 0.92, "provider_label:footnote"
    if raw_type in {"caption"}:
        return "caption", "caption", 0.9, "provider_label:caption"
    if raw_type in {"list", "list_item", "listitem"}:
        return "list_item", "list_item", 0.88, f"provider_label:{raw_type}"
    if raw_type in {"text", "paragraph", "body"}:
        if infer_list_level_hint(text_normalized) is not None:
            return "list_item", "list_item", 0.72, f"provider_label:{raw_type}:list_heuristic"
        return "paragraph", "body", 0.85, f"provider_label:{raw_type}"

    if table_cells or (html is not None and "<table" in html.lower()):
        return "table", "table", 0.86, "html_or_cells:table"
    if text_normalized:
        if infer_list_level_hint(text_normalized) is not None:
            return "list_item", "list_item", 0.62, "text_pattern:list_item"
        return "paragraph", "body", 0.6, "text_presence:body_fallback"
    return "unknown", "unknown", 0.2, "no_text_or_structure"


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
        extracted = extract_html_table_grid(html)
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


def _enrich_layout_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    enrich_repeated_candidates(rows)
    _mark_margin_running_headers(rows)
    enrich_parent_heading_hints(rows)
    enrich_cross_page_continuations(rows, textual_row_types=("paragraph", "list_item"))
    _mark_table_fragments(rows)
    return rows


def _mark_margin_running_headers(rows: list[dict[str, object]]) -> None:
    clusters: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        if bool(row.get("is_repeated_candidate")):
            continue
        text = str(row.get("text_normalized") or "").strip()
        if text not in RUNNING_HEADER_LINES:
            continue
        reason = str(row.get("classification_reason") or "")
        if not reason.startswith(("provider_label:aside_text", "provider_label:vertical_text")):
            continue
        clusters.setdefault(text, []).append(row)
    for text, members in clusters.items():
        if len(members) < 2:
            continue
        cluster_id = hashlib.sha1(f"margin:{text}".encode("utf-8")).hexdigest()[:12]
        for row in members:
            row["repeat_cluster_id"] = cluster_id
            row["repeat_frequency"] = len(members)
            row["repeat_position_band"] = "margin"
            row["is_repeated_candidate"] = True


def _mark_table_fragments(rows: list[dict[str, object]]) -> None:
    previous_table: dict[str, object] | None = None
    for row in rows:
        if str(row.get("row_type") or "") != "table":
            previous_table = (
                None if not bool(row.get("continues_from_previous_page")) else previous_table
            )
            continue
        if previous_table is not None:
            previous_page = _coerce_int(previous_table.get("page_end"))
            current_page = _coerce_int(row.get("page_start"))
            same_shape = previous_table.get("table_column_count") == row.get("table_column_count")
            if (
                previous_page is not None
                and current_page is not None
                and current_page == previous_page + 1
                and same_shape
            ):
                fragment_id = previous_table.get("table_fragment_id") or _build_table_fragment_id(
                    previous_table
                )
                previous_table["table_fragment_id"] = fragment_id
                row["table_fragment_id"] = fragment_id
        previous_table = row


def _build_table_fragment_id(row: dict[str, object]) -> str:
    payload = f"{row.get('source_artifact_id')}:{row.get('page_start')}:{row.get('row_id')}"
    return f"tablefrag:{hashlib.sha1(payload.encode('utf-8')).hexdigest()[:12]}"


def _infer_table_caption_hint(*, text_normalized: str, row_type: str) -> str | None:
    if row_type != "table":
        return None
    if "申请表" in text_normalized or "登记表" in text_normalized or "备案表" in text_normalized:
        return text_normalized
    return None


def _looks_like_page_number(
    *, text_normalized: str, bbox: list[float] | None, page_height: float | None
) -> bool:
    if not text_normalized.isdigit():
        return False
    if len(text_normalized) > 4:
        return False
    return is_bottom_band(bbox=bbox, page_height=page_height)


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
