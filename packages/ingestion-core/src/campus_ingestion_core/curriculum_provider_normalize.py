from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

from campus_ingestion_core.source_truth_common import (
    detect_merged_cells,
    enrich_cross_page_continuations,
    enrich_parent_heading_hints,
    enrich_repeated_candidates,
    extract_html_table_cells,
    infer_list_level_hint,
    infer_table_column_count,
    infer_table_header_rows,
    infer_table_row_count,
    is_bottom_band,
    normalize_bbox,
    normalize_text,
    serialize_layout_rows,
)


LAYOUT_ELEMENTS_SCHEMA_VERSION = "curriculum_layout_elements_v3"
_CN_SECTION_RE = re.compile(r"^[一二三四五六七八九十]+、")
_CN_SUBSECTION_RE = re.compile(r"^[（(][一二三四五六七八九十]+[)）]")
_NUMERIC_HEADING_RE = re.compile(r"^\d+[\.．、]")
_CHAPTER_RE = re.compile(r"^第[一二三四五六七八九十百千万〇零0-9]+[章节]")
_SENTENCE_PUNCTUATION_RE = re.compile(r"[。！？；?!;]")
_LIST_LIKE_LINE_RE = re.compile(r"^(?:[-*•]|[0-9]+[\.．、)]|[（(][一二三四五六七八九十]+[)）]|[一二三四五六七八九十]+、|第[一二三四五六七八九十百千万〇零0-9]+[章节])")
_TABLE_TAG_RE = re.compile(r"<[^>]+>")
_TABLE_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)


def normalize_curriculum_provider_result(
    *,
    provider_jsonl_bytes: bytes,
    source_pdf: str,
    ocr_provider: str,
    ocr_model: str,
) -> bytes:
    raw_lines = [line.strip() for line in provider_jsonl_bytes.decode("utf-8").splitlines() if line.strip()]
    if not raw_lines:
        raise ValueError("curriculum provider result is empty")

    source_slug = _slugify_filename(source_pdf)
    rows: list[dict[str, object]] = []
    page_index = 0
    row_index = 0

    for line_number, line in enumerate(raw_lines, start=1):
        try:
            provider_payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"curriculum provider result line {line_number} is not valid JSON") from exc
        if not isinstance(provider_payload, dict):
            raise ValueError(f"curriculum provider result line {line_number} must be a JSON object")

        result_payload = provider_payload.get("result")
        if not isinstance(result_payload, dict):
            raise ValueError(f"curriculum provider result line {line_number} missing result payload")
        layout_results = result_payload.get("layoutParsingResults")
        if not isinstance(layout_results, list) or not layout_results:
            raise ValueError(f"curriculum provider result line {line_number} missing layoutParsingResults")

        log_id = str(provider_payload.get("logId") or f"line-{line_number}")
        for page_offset, page_payload in enumerate(layout_results, start=1):
            if not isinstance(page_payload, dict):
                raise ValueError(f"curriculum provider page payload {line_number}:{page_offset} must be an object")
            page_index += 1
            parsed_rows = _normalize_page_payload(
                page_payload=page_payload,
                source_pdf=source_pdf,
                source_slug=source_slug,
                ocr_provider=ocr_provider,
                ocr_model=ocr_model,
                provider_log_id=log_id,
                provider_page_id=page_index,
                row_index_start=row_index,
            )
            row_index += len(parsed_rows)
            rows.extend(parsed_rows)

    if not rows:
        raise ValueError("curriculum provider normalization produced no rows")

    _enrich_source_truth_rows(rows)
    return serialize_layout_rows(rows)


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
            row = _normalize_block(
                raw_block=raw_block,
                source_pdf=source_pdf,
                source_slug=source_slug,
                ocr_provider=ocr_provider,
                ocr_model=ocr_model,
                provider_log_id=provider_log_id,
                provider_page_id=provider_page_id,
                row_index=row_index_start + block_offset,
                fallback_block_index=block_offset,
                page_height=page_height,
            )
            rows.append(row)
        return rows

    markdown = page_payload.get("markdown")
    markdown_text = markdown.get("text") if isinstance(markdown, dict) else None
    normalized_text = _normalize_text(markdown_text if isinstance(markdown_text, str) else "")
    if not normalized_text:
        raise ValueError(f"curriculum provider page {provider_page_id} has neither blocks nor markdown text")
    return [
        _build_row(
            source_pdf=source_pdf,
            source_slug=source_slug,
            ocr_provider=ocr_provider,
            ocr_model=ocr_model,
            provider_log_id=provider_log_id,
            provider_page_id=provider_page_id,
            provider_block_id="markdown-fallback",
            row_index=row_index_start + 1,
            row_id=f"page-{provider_page_id:04d}-block-fallback",
            row_type="paragraph",
            block_role="markdown_fallback",
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
            classification_reason="markdown_fallback:page_text",
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
    fallback_block_index: int,
    page_height: float | None,
) -> dict[str, object]:
    block_label = str(raw_block.get("block_label") or "unknown").strip() or "unknown"
    block_content = raw_block.get("block_content")
    text_raw = str(block_content) if isinstance(block_content, str) else ""
    text_normalized = _normalize_text(text_raw)
    block_id = str(raw_block.get("block_id") or fallback_block_index)
    reading_order = raw_block.get("block_order")
    bbox = raw_block.get("block_bbox")
    bbox_value = normalize_bbox(bbox)
    html = text_normalized if "<table" in text_normalized.lower() else None
    table_cells = _extract_table_cells(html) if html else None
    row_type, block_role, heading_level, classification_confidence, classification_reason = _classify_block(
        block_label=block_label,
        text=text_normalized,
        bbox=bbox_value,
        page_height=page_height,
        table_cells=table_cells,
    )
    title_candidate_score = 1.0 if block_role == "doc_title" else (0.75 if row_type == "heading" else 0.0)
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
        row_id=f"page-{provider_page_id:04d}-block-{block_id}-{fallback_block_index:04d}",
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
    if block_label == "figure_title":
        return "table_caption", "figure_title", None, 0.92, "provider_label:figure_title"
    if block_label == "vision_footnote":
        return "note", "vision_footnote", None, 0.9, "provider_label:vision_footnote"
    if block_label == "content":
        return "toc_entry", "content", None, 0.94, "provider_label:content"
    if block_label == "number":
        if _looks_like_page_number(text=text, bbox=bbox, page_height=page_height):
            return "page_number", "number", None, 0.9, "provider_label:number:page_number"
        return "paragraph", "number", None, 0.5, "provider_label:number:body_fallback"
    if block_label in {"image", "header_image"}:
        return "image", block_label, None, 0.95, f"provider_label:{block_label}"
    if block_label == "footer":
        return "footer", "footer", None, 0.96, "provider_label:footer"
    if block_label == "doc_title":
        return "heading", "doc_title", 1, 0.99, "provider_label:doc_title"
    if block_label == "paragraph_title":
        return "heading", "paragraph_title", _infer_heading_level(text), 0.92, "provider_label:paragraph_title"
    if block_label == "text" and _looks_like_heading(text):
        return "heading", "text_heading_candidate", _infer_heading_level(text), 0.8, "text_pattern:heading"
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
    if _looks_like_subsection_heading(text):
        return 3
    if _NUMERIC_HEADING_RE.match(text):
        return 4
    return 2


def _section_hint(text: str) -> str | None:
    if _CHAPTER_RE.match(text):
        return "chapter"
    if _CN_SECTION_RE.match(text):
        return "section"
    if _looks_like_subsection_heading(text):
        return "subsection"
    if _looks_like_numeric_heading(text):
        return "numeric_heading"
    return None


def _normalize_text(text: str) -> str:
    normalized = normalize_text(text or "")
    compact = _repair_sentence_wraps([line for line in normalized.split("\n") if line])
    return compact.strip()


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
    remainder = text[match.end():].strip()
    if not remainder:
        return False
    if len(remainder) > 20:
        return False
    if _SENTENCE_PUNCTUATION_RE.search(remainder):
        return False
    if any(token in remainder for token in ("，", ",", "、", "以及", "并", "能够", "可以")):
        return False
    return True


def _looks_like_subsection_heading(text: str) -> bool:
    match = _CN_SUBSECTION_RE.match(text)
    if not match:
        return False
    remainder = text[match.end():].strip()
    if not remainder:
        return False
    if len(remainder) > 18:
        return False
    if _SENTENCE_PUNCTUATION_RE.search(remainder):
        return False
    if any(token in remainder for token in ("，", ",", "、", "能够", "可以", "具备", "具有", "掌握", "理解")):
        return False
    return True


def _repair_sentence_wraps(lines: list[str]) -> str:
    if not lines:
        return ""
    repaired = lines[0]
    for line in lines[1:]:
        if _should_preserve_line_break(repaired, line):
            repaired = f"{repaired}\n{line}"
            continue
        repaired = f"{repaired}{_joiner_between(repaired, line)}{line}"
    return repaired


def _should_preserve_line_break(previous: str, current: str) -> bool:
    previous_tail = previous.rstrip()
    if not previous_tail:
        return False
    if previous_tail.endswith(("。", "！", "？", "；", ":", "：")):
        return True
    if _LIST_LIKE_LINE_RE.match(current):
        return True
    return False


def _joiner_between(previous: str, current: str) -> str:
    previous_tail = previous.rstrip()
    current_head = current.lstrip()
    if not previous_tail or not current_head:
        return ""
    if previous_tail[-1].isascii() and previous_tail[-1].isalnum() and current_head[0].isascii() and current_head[0].isalnum():
        return " "
    return ""


def _extract_table_cells(html: str) -> list[dict[str, object]] | None:
    return extract_html_table_cells(html)


def _enrich_source_truth_rows(rows: list[dict[str, object]]) -> None:
    _enrich_relationships(rows)
    enrich_repeated_candidates(rows)
    enrich_parent_heading_hints(rows)
    enrich_cross_page_continuations(rows, textual_row_types=("paragraph", "list_item"))
    _assign_table_fragment_ids(rows)
    _propagate_table_caption_hints(rows)


def _enrich_relationships(rows: list[dict[str, object]]) -> None:
    pending_captions: list[dict[str, object]] = []
    open_table_context: dict[str, object] | None = None
    last_attachable_owner: dict[str, object] | None = None

    for row in rows:
        row_type = str(row.get("row_type") or "")
        if row_type == "table_caption":
            pending_captions.append(row)
            continue

        if row_type == "table":
            continuation_group_id = str(row["row_id"])
            owner_row_id: str | None = None
            relation_type: str | None = None
            header_signature = _table_header_signature(str(row.get("html") or ""))
            continuation_hint = any(_is_continuation_caption(str(caption.get("text_normalized") or "")) for caption in pending_captions)

            if continuation_hint and open_table_context is not None:
                continuation_group_id = str(open_table_context["continuation_group_id"])
                owner_row_id = str(open_table_context["continuation_group_id"])
                relation_type = "table_continuation"
            elif (
                open_table_context is not None
                and not pending_captions
                and header_signature
                and header_signature == open_table_context.get("header_signature")
            ):
                continuation_group_id = str(open_table_context["continuation_group_id"])
                owner_row_id = str(open_table_context["continuation_group_id"])
                relation_type = "table_continuation"
                row["is_repeated_candidate"] = True

            row["continuation_group_id"] = continuation_group_id
            row["owner_row_id"] = owner_row_id
            row["relation_type"] = relation_type
            row["table_caption_hint"] = _primary_caption_text(pending_captions)

            for caption in pending_captions:
                caption["owner_row_id"] = row["row_id"]
                caption["relation_type"] = "caption_of"
                caption["continuation_group_id"] = continuation_group_id
            pending_captions.clear()

            open_table_context = {
                "row_id": row["row_id"],
                "continuation_group_id": continuation_group_id,
                "header_signature": header_signature,
            }
            last_attachable_owner = {
                "row_id": row["row_id"],
                "continuation_group_id": continuation_group_id,
            }
            continue

        if row_type == "note" and last_attachable_owner is not None:
            row["owner_row_id"] = last_attachable_owner["row_id"]
            row["relation_type"] = "note_of"
            row["continuation_group_id"] = last_attachable_owner["continuation_group_id"]
            continue

        if row_type in {"heading", "paragraph", "toc_entry"}:
            last_attachable_owner = {
                "row_id": row["row_id"],
                "continuation_group_id": row["row_id"],
            }
            open_table_context = None
            pending_captions.clear()
            continue

        if row_type in {"page_number", "image", "footer"}:
            continue

        pending_captions.clear()
        open_table_context = None


def _is_continuation_caption(text: str) -> bool:
    normalized = text.strip().replace(" ", "")
    return normalized.startswith("续表")


def _table_header_signature(html: str) -> str | None:
    if not html:
        return None
    match = _TABLE_ROW_RE.search(html)
    if not match:
        return None
    header_text = _TABLE_TAG_RE.sub(" ", match.group(1))
    signature = " ".join(part for part in header_text.split() if part).strip().lower()
    return signature or None


def _primary_caption_text(captions: list[dict[str, object]]) -> str | None:
    for caption in captions:
        text = str(caption.get("text_normalized") or "").strip()
        if text:
            return text
    return None


def _assign_table_fragment_ids(rows: list[dict[str, object]]) -> None:
    groups: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        if str(row.get("row_type") or "") != "table":
            continue
        group_id = str(row.get("continuation_group_id") or row.get("row_id") or "")
        if not group_id:
            continue
        groups.setdefault(group_id, []).append(row)

    for group_id, tables in groups.items():
        if not tables:
            continue
        fragment_id = f"tablefrag:{hashlib.sha1(group_id.encode('utf-8')).hexdigest()[:12]}"
        for table_row in tables:
            table_row["table_fragment_id"] = fragment_id


def _propagate_table_caption_hints(rows: list[dict[str, object]]) -> None:
    captions_by_owner: dict[str, str] = {}
    for row in rows:
        if str(row.get("row_type") or "") != "table_caption":
            continue
        owner_row_id = str(row.get("owner_row_id") or "").strip()
        text = str(row.get("text_normalized") or "").strip()
        if owner_row_id and text and owner_row_id not in captions_by_owner:
            captions_by_owner[owner_row_id] = text

    for row in rows:
        if str(row.get("row_type") or "") != "table":
            continue
        row_id = str(row.get("row_id") or "")
        if row_id in captions_by_owner:
            row["table_caption_hint"] = captions_by_owner[row_id]


def _looks_like_page_number(*, text: str, bbox: list[float] | None, page_height: float | None) -> bool:
    normalized = text.strip()
    if not normalized.isdigit():
        return False
    if len(normalized) > 4:
        return False
    if bbox is None:
        return True
    if is_bottom_band(bbox=bbox, page_height=page_height):
        return True
    return len(bbox) >= 4 and float(bbox[1]) >= 700
