from __future__ import annotations

import re
from pathlib import Path

from campus_ingestion_core.source_truth_common import (
    detect_merged_cells,
    extract_html_table_cells,
    infer_list_level_hint,
    infer_table_column_count,
    infer_table_header_rows,
    infer_table_row_count,
    is_bottom_band,
    normalize_bbox,
    normalize_text,
)

from .curriculum_provider_text_repairs import (
    _repair_ethnology_second_bachelor_table_artifact,
    _repair_mineru_text_artifacts,
    _repair_minority_preparatory_program_artifacts,
    _repair_paleography_program_table_artifacts,
    _repair_sentence_wraps,
)

LAYOUT_ELEMENTS_SCHEMA_VERSION = "curriculum_layout_elements_v3"
_CN_SECTION_RE = re.compile(r"^[一二三四五六七八九十]+、")
_CN_SUBSECTION_RE = re.compile(r"^[（(][一二三四五六七八九十]+[)）]")
_NUMERIC_HEADING_RE = re.compile(r"^\d+[\.．、]")
_CHAPTER_RE = re.compile(r"^第[一二三四五六七八九十百千万〇零0-9]+[章节]")
_SENTENCE_PUNCTUATION_RE = re.compile(r"[。！？；?!;]")
_DECIMAL_LIST_MARKER_AFTER_SENTENCE_RE = re.compile(r"(?<=[。！？；!?;])(?=\d+\.\d+\s)")
_TABLE_TAG_RE = re.compile(r"<[^>]+>")
_TABLE_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_TERMINAL_MOTTO_FOOTER_RE = re.compile(r"^美美与共\s+知行合一$")

__all__ = [
    "_normalize_page_payload",
    "_repair_ethnology_second_bachelor_table_artifact",
    "_repair_minority_preparatory_program_artifacts",
    "_repair_paleography_program_table_artifacts",
    "_slugify_filename",
]


def _normalize_page_payload(
    *,
    page_payload: dict[str, object],
    source_pdf: str,
    source_slug: str,
    ocr_provider: str,
    ocr_model: str,
    provider_log_id: str,
    provider_page_id: int,
    row_index_start: int,
) -> list[dict[str, object]]:
    pruned = page_payload.get("prunedResult")
    parsing_res_list = pruned.get("parsing_res_list") if isinstance(pruned, dict) else None
    page_height = _extract_page_height(page_payload)
    rows: list[dict[str, object]] = []

    if isinstance(parsing_res_list, list) and parsing_res_list:
        for block_offset, raw_block in enumerate(parsing_res_list, start=1):
            if not isinstance(raw_block, dict):
                continue
            rows.append(
                _normalize_block(
                    raw_block=raw_block,
                    source_pdf=source_pdf,
                    source_slug=source_slug,
                    ocr_provider=ocr_provider,
                    ocr_model=ocr_model,
                    provider_log_id=provider_log_id,
                    provider_page_id=provider_page_id,
                    row_index=row_index_start + block_offset,
                    generated_block_index=block_offset,
                    page_height=page_height,
                )
            )
        return rows

    markdown = page_payload.get("markdown")
    markdown_text = markdown.get("text") if isinstance(markdown, dict) else None
    normalized_text = _normalize_text(markdown_text if isinstance(markdown_text, str) else "")
    if not normalized_text:
        raise ValueError(
            f"curriculum provider page {provider_page_id} has neither blocks nor markdown text"
        )
    return [
        _build_row(
            source_pdf=source_pdf,
            source_slug=source_slug,
            ocr_provider=ocr_provider,
            ocr_model=ocr_model,
            provider_log_id=provider_log_id,
            provider_page_id=provider_page_id,
            provider_block_id="markdown-page-text",
            row_index=row_index_start + 1,
            row_id=f"page-{provider_page_id:04d}-block-page-text",
            row_type="paragraph",
            block_role="markdown_page_text",
            heading_level=None,
            reading_order=1,
            bbox=None,
            text_raw=markdown_text,
            text_normalized=normalized_text,
            html=None,
            table_cells=None,
            is_blank=False,
            title_candidate_score=0.0,
            section_hint=None,
            classification_confidence=0.7,
            classification_reason="markdown_page_text",
        )
    ]


def _normalize_block(
    *,
    raw_block: dict[str, object],
    source_pdf: str,
    source_slug: str,
    ocr_provider: str,
    ocr_model: str,
    provider_log_id: str,
    provider_page_id: int,
    row_index: int,
    generated_block_index: int,
    page_height: float | None,
) -> dict[str, object]:
    block_label = str(raw_block.get("block_label") or "unknown").strip() or "unknown"
    block_content = raw_block.get("block_content")
    text_raw = str(block_content) if isinstance(block_content, str) else ""
    text_normalized = _normalize_text(text_raw)
    block_id = str(raw_block.get("block_id") or generated_block_index)
    reading_order = raw_block.get("block_order")
    bbox = raw_block.get("block_bbox")
    bbox_value = normalize_bbox(bbox)
    html = text_normalized if "<table" in text_normalized.lower() else None
    table_cells = _extract_table_cells(html) if html else None
    row_type, block_role, heading_level, classification_confidence, classification_reason = (
        _classify_block(
            block_label=block_label,
            text=text_normalized,
            bbox=bbox_value,
            page_height=page_height,
            table_cells=table_cells,
        )
    )
    title_candidate_score = (
        1.0 if block_role == "doc_title" else (0.75 if row_type == "heading" else 0.0)
    )
    section_hint = _section_hint(text_normalized) if row_type == "heading" else None

    return _build_row(
        source_pdf=source_pdf,
        source_slug=source_slug,
        ocr_provider=ocr_provider,
        ocr_model=ocr_model,
        provider_log_id=provider_log_id,
        provider_page_id=provider_page_id,
        provider_block_id=block_id,
        row_index=row_index,
        row_id=f"page-{provider_page_id:04d}-block-{block_id}-{generated_block_index:04d}",
        row_type=row_type,
        block_role=block_role,
        heading_level=heading_level,
        reading_order=reading_order if isinstance(reading_order, int) else None,
        bbox=bbox_value,
        text_raw=text_raw,
        text_normalized=text_normalized,
        html=html,
        table_cells=table_cells,
        is_blank=not bool(text_normalized),
        title_candidate_score=title_candidate_score,
        section_hint=section_hint,
        classification_confidence=classification_confidence,
        classification_reason=classification_reason,
    )


def _build_row(
    *,
    source_pdf: str,
    source_slug: str,
    ocr_provider: str,
    ocr_model: str,
    provider_log_id: str,
    provider_page_id: int,
    provider_block_id: str,
    row_index: int,
    row_id: str,
    row_type: str,
    block_role: str,
    heading_level: int | None,
    reading_order: int | None,
    bbox: list[object] | None,
    text_raw: str | None,
    text_normalized: str,
    html: str | None,
    table_cells: list[dict[str, object]] | None,
    is_blank: bool,
    title_candidate_score: float,
    section_hint: str | None,
    classification_confidence: float,
    classification_reason: str,
) -> dict[str, object]:
    table_header_rows = infer_table_header_rows(table_cells)
    return {
        "schema_version": LAYOUT_ELEMENTS_SCHEMA_VERSION,
        "corpus": "curriculum",
        "collection": "curriculum_plan",
        "source_artifact_id": f"asset:{source_slug}",
        "source_pdf": source_pdf,
        "page_start": provider_page_id,
        "page_end": provider_page_id,
        "row_id": row_id,
        "row_index": row_index,
        "ocr_provider": ocr_provider,
        "ocr_model": ocr_model,
        "provider_page_id": provider_page_id,
        "provider_block_id": provider_block_id,
        "provider_payload_ref": f"{provider_log_id}:page-{provider_page_id}",
        "confidence": None,
        "row_type": row_type,
        "block_role": block_role,
        "heading_level": heading_level,
        "reading_order": reading_order,
        "bbox": bbox,
        "text_raw": text_raw,
        "text_normalized": text_normalized,
        "html": html,
        "table_cells": table_cells,
        "is_blank": is_blank,
        "is_repeated_candidate": False,
        "title_candidate_score": title_candidate_score,
        "section_hint": section_hint,
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
        "table_caption_hint": None,
        "owner_row_id": None,
        "relation_type": None,
        "continuation_group_id": None,
    }


def _classify_block(
    *,
    block_label: str,
    text: str,
    bbox: list[float] | None,
    page_height: float | None,
    table_cells: list[dict[str, object]] | None,
) -> tuple[str, str, int | None, float, str]:
    if block_label == "table":
        return "table", "table", None, 0.98, "provider_label:table"
    if _looks_like_terminal_motto_footer(text):
        return "footer", "motto_footer", None, 0.9, "text_pattern:motto_footer"
    if block_label == "figure_title":
        return "table_caption", "figure_title", None, 0.92, "provider_label:figure_title"
    if block_label == "vision_footnote":
        return "note", "vision_footnote", None, 0.9, "provider_label:vision_footnote"
    if block_label == "content":
        return "toc_entry", "content", None, 0.94, "provider_label:content"
    if block_label == "number":
        if _looks_like_page_number(text=text, bbox=bbox, page_height=page_height):
            return "page_number", "number", None, 0.9, "provider_label:number:page_number"
        return "paragraph", "number", None, 0.5, "provider_label:number:body"
    if block_label in {"image", "header_image"}:
        return "image", block_label, None, 0.95, f"provider_label:{block_label}"
    if block_label == "footer":
        return "footer", "footer", None, 0.96, "provider_label:footer"
    if block_label == "doc_title":
        return "heading", "doc_title", 1, 0.99, "provider_label:doc_title"
    if block_label == "paragraph_title":
        return (
            "heading",
            "paragraph_title",
            _infer_heading_level(text),
            0.92,
            "provider_label:paragraph_title",
        )
    if block_label == "text" and _looks_like_page_number(
        text=text,
        bbox=bbox,
        page_height=page_height,
    ):
        return "page_number", "page_number", None, 0.84, "provider_label:text:page_number"
    if block_label == "text" and _looks_like_heading(text):
        return (
            "heading",
            "text_heading_candidate",
            _infer_heading_level(text),
            0.8,
            "text_pattern:heading",
        )
    if table_cells:
        return "table", "table", None, 0.82, "table_cells:detected"
    return "paragraph", block_label, None, 0.78, f"provider_label:{block_label or 'unknown'}"


def _extract_page_height(page_payload: dict[str, object]) -> float | None:
    pruned = page_payload.get("prunedResult")
    if isinstance(pruned, dict):
        value = pruned.get("height")
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    return None


def _looks_like_heading(text: str) -> bool:
    return bool(
        text
        and (
            _CN_SECTION_RE.match(text)
            or _looks_like_subsection_heading(text)
            or _CHAPTER_RE.match(text)
            or _looks_like_numeric_heading(text)
        )
    )


def _infer_heading_level(text: str) -> int:
    if _CHAPTER_RE.match(text) or _CN_SECTION_RE.match(text):
        return 2
    if _CN_SUBSECTION_RE.match(text):
        return 3
    if _NUMERIC_HEADING_RE.match(text):
        return 4
    return 2


def _section_hint(text: str) -> str | None:
    if _CHAPTER_RE.match(text):
        return "chapter"
    if _CN_SECTION_RE.match(text):
        return "section"
    if _CN_SUBSECTION_RE.match(text):
        return "subsection"
    if _NUMERIC_HEADING_RE.match(text):
        return "numeric_heading"
    return None


def _normalize_text(text: str) -> str:
    normalized = normalize_text(text or "")
    compact = _repair_sentence_wraps([line for line in normalized.split("\n") if line])
    compact = _DECIMAL_LIST_MARKER_AFTER_SENTENCE_RE.sub("\n", compact)
    compact = _repair_mineru_text_artifacts(compact)
    return compact.strip()


def _looks_like_terminal_motto_footer(text: str) -> bool:
    return bool(_TERMINAL_MOTTO_FOOTER_RE.fullmatch(text.strip()))


def _slugify_filename(filename: str) -> str:
    stem = Path(filename).stem.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in stem).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "document"


def _looks_like_numeric_heading(text: str) -> bool:
    match = _NUMERIC_HEADING_RE.match(text)
    if not match:
        return False
    remainder = text[match.end() :].strip()
    if not remainder or len(remainder) > 20 or _SENTENCE_PUNCTUATION_RE.search(remainder):
        return False
    return not any(token in remainder for token in ("，", ",", "、", "以及", "并", "能够", "可以"))


def _looks_like_subsection_heading(text: str) -> bool:
    match = _CN_SUBSECTION_RE.match(text)
    if not match:
        return False
    remainder = text[match.end() :].strip()
    if not remainder or len(remainder) > 18 or _SENTENCE_PUNCTUATION_RE.search(remainder):
        return False
    return not any(
        token in remainder
        for token in ("，", ",", "、", "能够", "可以", "具备", "具有", "掌握", "理解")
    )


def _extract_table_cells(html: str) -> list[dict[str, object]] | None:
    return extract_html_table_cells(html)


def _looks_like_page_number(
    *, text: str, bbox: list[float] | None, page_height: float | None
) -> bool:
    normalized = text.strip()
    if not normalized.isdigit() or len(normalized) > 4:
        return False
    if bbox is None:
        return True
    if is_bottom_band(bbox=bbox, page_height=page_height):
        return True
    return len(bbox) >= 4 and float(bbox[1]) >= 700
