from __future__ import annotations

from html import unescape
import json
from pathlib import Path
import re
import unicodedata


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
                ocr_model=ocr_model,
                provider_log_id=log_id,
                provider_page_id=page_index,
                row_index_start=row_index,
            )
            row_index += len(parsed_rows)
            rows.extend(parsed_rows)

    if not rows:
        raise ValueError("curriculum provider normalization produced no rows")

    _enrich_relationships(rows)
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _normalize_page_payload(
    *,
    page_payload: dict[str, object],
    source_pdf: str,
    source_slug: str,
    ocr_model: str,
    provider_log_id: str,
    provider_page_id: int,
    row_index_start: int,
) -> list[dict[str, object]]:
    pruned = page_payload.get("prunedResult")
    parsing_res_list = pruned.get("parsing_res_list") if isinstance(pruned, dict) else None
    rows: list[dict[str, object]] = []

    if isinstance(parsing_res_list, list) and parsing_res_list:
        for block_offset, raw_block in enumerate(parsing_res_list, start=1):
            if not isinstance(raw_block, dict):
                continue
            row = _normalize_block(
                raw_block=raw_block,
                source_pdf=source_pdf,
                source_slug=source_slug,
                ocr_model=ocr_model,
                provider_log_id=provider_log_id,
                provider_page_id=provider_page_id,
                row_index=row_index_start + block_offset,
                fallback_block_index=block_offset,
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
            ocr_model=ocr_model,
            provider_log_id=provider_log_id,
            provider_page_id=provider_page_id,
            provider_block_id="markdown-fallback",
            row_index=row_index_start + 1,
            chunk_id=f"page-{provider_page_id:04d}-block-fallback",
            row_type="paragraph",
            block_role="markdown_fallback",
            heading_level=None,
            reading_order=1,
            bbox=None,
            text_raw=markdown_text,
            text_normalized=normalized_text,
            clean_text=normalized_text,
            html=None,
            table_cells=None,
            is_blank=False,
            title_candidate_score=0.0,
            section_hint=None,
        )
    ]


def _normalize_block(
    *,
    raw_block: dict[str, object],
    source_pdf: str,
    source_slug: str,
    ocr_model: str,
    provider_log_id: str,
    provider_page_id: int,
    row_index: int,
    fallback_block_index: int,
) -> dict[str, object]:
    block_label = str(raw_block.get("block_label") or "unknown").strip() or "unknown"
    block_content = raw_block.get("block_content")
    text_raw = str(block_content) if isinstance(block_content, str) else ""
    text_normalized = _normalize_text(text_raw)
    block_id = str(raw_block.get("block_id") or fallback_block_index)
    reading_order = raw_block.get("block_order")
    bbox = raw_block.get("block_bbox")
    bbox_value = list(bbox) if isinstance(bbox, list) else None
    row_type, block_role, heading_level = _classify_block(block_label=block_label, text=text_normalized)
    clean_text = _derive_clean_text(row_type=row_type, text=text_normalized)
    html = text_normalized if row_type == "table" and text_normalized else None
    table_cells = _extract_table_cells(html) if html else None
    title_candidate_score = 1.0 if row_type == "heading" else 0.0
    section_hint = _section_hint(text_normalized) if row_type == "heading" else None

    return _build_row(
        source_pdf=source_pdf,
        source_slug=source_slug,
        ocr_model=ocr_model,
        provider_log_id=provider_log_id,
        provider_page_id=provider_page_id,
        provider_block_id=block_id,
        row_index=row_index,
        chunk_id=f"page-{provider_page_id:04d}-block-{block_id}-{fallback_block_index:04d}",
        row_type=row_type,
        block_role=block_role,
        heading_level=heading_level,
        reading_order=reading_order if isinstance(reading_order, int) else None,
        bbox=bbox_value,
        text_raw=text_raw,
        text_normalized=text_normalized,
        clean_text=clean_text,
        html=html,
        table_cells=table_cells,
        is_blank=not bool(text_normalized),
        title_candidate_score=title_candidate_score,
        section_hint=section_hint,
    )


def _build_row(
    *,
    source_pdf: str,
    source_slug: str,
    ocr_model: str,
    provider_log_id: str,
    provider_page_id: int,
    provider_block_id: str,
    row_index: int,
    chunk_id: str,
    row_type: str,
    block_role: str,
    heading_level: int | None,
    reading_order: int | None,
    bbox: list[object] | None,
    text_raw: str | None,
    text_normalized: str,
    clean_text: str,
    html: str | None,
    table_cells: list[dict[str, object]] | None,
    is_blank: bool,
    title_candidate_score: float,
    section_hint: str | None,
) -> dict[str, object]:
    return {
        "schema_version": "curriculum_provider_rows_v1",
        "corpus": "curriculum",
        "collection": "curriculum_plan",
        "source_artifact_id": f"asset:{source_slug}",
        "source_pdf": source_pdf,
        "page_start": provider_page_id,
        "page_end": provider_page_id,
        "row_id": chunk_id,
        "row_index": row_index,
        "chunk_id": chunk_id,
        "ocr_provider": "paddleocr_async",
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
        "clean_text": clean_text,
        "html": html,
        "table_cells": table_cells,
        "is_blank": is_blank,
        "is_repeated_candidate": False,
        "title_candidate_score": title_candidate_score,
        "section_hint": section_hint,
        "owner_row_id": None,
        "relation_type": None,
        "continuation_group_id": None,
    }


def _classify_block(*, block_label: str, text: str) -> tuple[str, str, int | None]:
    if block_label == "table":
        return "table", "table", None
    if block_label == "figure_title":
        return "table_caption", "figure_title", None
    if block_label == "vision_footnote":
        return "note", "vision_footnote", None
    if block_label == "content":
        return "toc_entry", "content", None
    if block_label == "number":
        return "page_number", "number", None
    if block_label in {"image", "header_image"}:
        return "image", block_label, None
    if block_label == "footer":
        return "footer", "footer", None
    if block_label == "doc_title":
        return "heading", "doc_title", 1
    if block_label == "paragraph_title":
        return "heading", "paragraph_title", _infer_heading_level(text)
    if block_label == "text" and _looks_like_heading(text):
        return "heading", "text_heading_candidate", _infer_heading_level(text)
    return "paragraph", block_label, None


def _derive_clean_text(*, row_type: str, text: str) -> str:
    if row_type in {"page_number", "image", "footer"}:
        return ""
    return text


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
    normalized = unicodedata.normalize("NFKC", text or "")
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    lines = [" ".join(part for part in line.strip().split()) for line in normalized.split("\n")]
    compact = _repair_sentence_wraps([line for line in lines if line])
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
    if not html:
        return None
    row_matches = list(_TABLE_ROW_RE.finditer(html))
    if not row_matches:
        return None

    cells: list[dict[str, object]] = []
    occupied: dict[int, int] = {}
    cell_re = re.compile(r"<(td|th)\b([^>]*)>(.*?)</\1>", re.IGNORECASE | re.DOTALL)
    span_re = re.compile(r"""\b(rowspan|colspan)\s*=\s*["']?(\d+)["']?""", re.IGNORECASE)

    for row_number, row_match in enumerate(row_matches, start=1):
        current_occupied = {
            col: remaining - 1
            for col, remaining in occupied.items()
            if remaining > 1
        }
        col_number = 1
        row_cells = list(cell_re.finditer(row_match.group(1)))
        if not row_cells:
            occupied = current_occupied
            continue
        for cell_match in row_cells:
            while col_number in current_occupied:
                col_number += 1
            tag_name = cell_match.group(1).lower()
            attr_text = cell_match.group(2) or ""
            cell_html = cell_match.group(3) or ""
            text = _normalize_text(unescape(_TABLE_TAG_RE.sub(" ", cell_html)))
            spans = {match.group(1).lower(): int(match.group(2)) for match in span_re.finditer(attr_text)}
            rowspan = spans.get("rowspan", 1)
            colspan = spans.get("colspan", 1)
            cells.append(
                {
                    "row": row_number,
                    "col": col_number,
                    "text": text,
                    "rowspan": rowspan,
                    "colspan": colspan,
                    "is_header": tag_name == "th" or row_number == 1,
                }
            )
            if rowspan > 1:
                for occupied_col in range(col_number, col_number + colspan):
                    current_occupied[occupied_col] = rowspan
            col_number += colspan
        occupied = current_occupied
    return cells or None


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
            continuation_hint = any(_is_continuation_caption(str(caption.get("clean_text") or "")) for caption in pending_captions)

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
