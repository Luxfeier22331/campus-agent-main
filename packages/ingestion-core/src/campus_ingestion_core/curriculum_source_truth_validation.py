from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass

from campus_ingestion_core.source_truth_common import looks_like_cross_page_continuation

FORBIDDEN_SOURCE_TRUTH_FIELDS = frozenset(
    {"clean_text", "chunk_id", "doc_id", "document_id", "version_id", "semantic_confidence"}
)

_CN_SECTION_RE = re.compile(r"^[一二三四五六七八九十]+、")
_CN_SUBSECTION_RE = re.compile(r"^[（(][一二三四五六七八九十]+[)）]")
_NUMERIC_HEADING_RE = re.compile(r"^\d+[\.．、]")
_CHAPTER_RE = re.compile(r"^第[一二三四五六七八九十百千万〇零0-9]+[章节]")


@dataclass(frozen=True, slots=True)
class CurriculumSourceTruthValidationReport:
    total_rows: int
    row_type_counts: dict[str, int]
    forbidden_field_count: int
    heading_role_conflict_count: int
    page_number_leak_count: int
    footer_leak_count: int
    orphan_caption_count: int
    orphan_note_count: int
    broken_table_continuation_count: int
    cross_page_continuation_miss_count: int
    section_hint_missing_count: int
    parent_heading_hint_missing_count: int
    reading_order_gap_count: int
    passed: bool


def scan_curriculum_source_truth_rows(
    rows: list[dict[str, object]],
) -> CurriculumSourceTruthValidationReport:
    row_type_counts = Counter(str(row.get("row_type") or "") for row in rows)
    row_ids = {
        str(row.get("row_id") or "").strip() for row in rows if str(row.get("row_id") or "").strip()
    }
    forbidden_field_count = sum(
        len(FORBIDDEN_SOURCE_TRUTH_FIELDS & set(row.keys())) for row in rows
    )
    heading_role_conflict_count = sum(1 for row in rows if _has_heading_role_conflict(row))
    page_number_leak_count = sum(
        1
        for row in rows
        if str(row.get("block_role") or "") == "number"
        and str(row.get("row_type") or "") != "page_number"
    )
    footer_leak_count = sum(
        1
        for row in rows
        if str(row.get("block_role") or "") == "footer"
        and str(row.get("row_type") or "") != "footer"
    )
    orphan_caption_count = sum(
        1
        for row in rows
        if str(row.get("row_type") or "") == "table_caption"
        and not _has_valid_owner(row, row_ids=row_ids)
    )
    orphan_note_count = sum(
        1
        for row in rows
        if str(row.get("row_type") or "") == "note" and not _has_valid_owner(row, row_ids=row_ids)
    )
    broken_table_continuation_count = sum(
        1 for row in rows if _is_broken_table_continuation(row, row_ids=row_ids)
    )
    cross_page_continuation_miss_count = _count_cross_page_continuation_misses(rows)
    section_hint_missing_count = sum(1 for row in rows if _requires_section_hint(row))
    parent_heading_hint_missing_count = _count_parent_heading_hint_misses(rows)
    reading_order_gap_count = _count_reading_order_gaps(rows)
    passed = not any(
        (
            forbidden_field_count,
            heading_role_conflict_count,
            page_number_leak_count,
            footer_leak_count,
            orphan_caption_count,
            orphan_note_count,
            broken_table_continuation_count,
            cross_page_continuation_miss_count,
            section_hint_missing_count,
            parent_heading_hint_missing_count,
            reading_order_gap_count,
        )
    )
    return CurriculumSourceTruthValidationReport(
        total_rows=len(rows),
        row_type_counts=dict(sorted(row_type_counts.items())),
        forbidden_field_count=forbidden_field_count,
        heading_role_conflict_count=heading_role_conflict_count,
        page_number_leak_count=page_number_leak_count,
        footer_leak_count=footer_leak_count,
        orphan_caption_count=orphan_caption_count,
        orphan_note_count=orphan_note_count,
        broken_table_continuation_count=broken_table_continuation_count,
        cross_page_continuation_miss_count=cross_page_continuation_miss_count,
        section_hint_missing_count=section_hint_missing_count,
        parent_heading_hint_missing_count=parent_heading_hint_missing_count,
        reading_order_gap_count=reading_order_gap_count,
        passed=passed,
    )


def validate_curriculum_source_truth_rows(rows: list[dict[str, object]]) -> None:
    report = scan_curriculum_source_truth_rows(rows)
    if report.passed:
        return
    failures = {
        "forbidden_field_count": report.forbidden_field_count,
        "heading_role_conflict_count": report.heading_role_conflict_count,
        "page_number_leak_count": report.page_number_leak_count,
        "footer_leak_count": report.footer_leak_count,
        "orphan_caption_count": report.orphan_caption_count,
        "orphan_note_count": report.orphan_note_count,
        "broken_table_continuation_count": report.broken_table_continuation_count,
        "cross_page_continuation_miss_count": report.cross_page_continuation_miss_count,
        "section_hint_missing_count": report.section_hint_missing_count,
        "parent_heading_hint_missing_count": report.parent_heading_hint_missing_count,
        "reading_order_gap_count": report.reading_order_gap_count,
    }
    failure_summary = (
        ", ".join(f"{key}={value}" for key, value in failures.items() if value) or "unknown_failure"
    )
    raise ValueError(f"curriculum source truth validation failed: {failure_summary}")


def _has_heading_role_conflict(row: dict[str, object]) -> bool:
    row_type = str(row.get("row_type") or "")
    heading_level = row.get("heading_level")
    if row_type == "heading":
        return not isinstance(heading_level, int)
    return heading_level not in (None, "")


def _has_valid_owner(row: dict[str, object], *, row_ids: set[str]) -> bool:
    owner_row_id = str(row.get("owner_row_id") or "").strip()
    relation_type = str(row.get("relation_type") or "").strip()
    continuation_group_id = str(row.get("continuation_group_id") or "").strip()
    if not owner_row_id or owner_row_id not in row_ids:
        return False
    if not relation_type:
        return False
    return bool(continuation_group_id)


def _is_broken_table_continuation(row: dict[str, object], *, row_ids: set[str]) -> bool:
    if str(row.get("row_type") or "") != "table":
        return False
    if str(row.get("relation_type") or "") != "table_continuation":
        return False
    owner_row_id = str(row.get("owner_row_id") or "").strip()
    continuation_group_id = str(row.get("continuation_group_id") or "").strip()
    if not owner_row_id or owner_row_id not in row_ids:
        return True
    return not continuation_group_id or continuation_group_id != owner_row_id


def _count_cross_page_continuation_misses(rows: list[dict[str, object]]) -> int:
    paragraphs_by_page: dict[int, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        if bool(row.get("is_repeated_candidate")):
            continue
        if str(row.get("row_type") or "") != "paragraph":
            continue
        page = row.get("page_start")
        if isinstance(page, int):
            paragraphs_by_page[page].append(row)
    misses = 0
    for page in sorted(paragraphs_by_page):
        current_rows = paragraphs_by_page[page]
        next_rows = paragraphs_by_page.get(page + 1)
        if not current_rows or not next_rows:
            continue
        current = current_rows[-1]
        next_row = next_rows[0]
        current_text = str(current.get("text_normalized") or "").strip()
        next_text = str(next_row.get("text_normalized") or "").strip()
        if looks_like_cross_page_continuation(
            current_text=current_text,
            next_text=next_text,
        ) and (
            not bool(current.get("continues_to_next_page"))
            or not bool(next_row.get("continues_from_previous_page"))
        ):
            misses += 1
    return misses


def _requires_section_hint(row: dict[str, object]) -> bool:
    if str(row.get("row_type") or "") != "heading":
        return False
    text = str(row.get("text_normalized") or "").strip()
    if not text:
        return False
    if not (
        _CN_SECTION_RE.match(text)
        or _CN_SUBSECTION_RE.match(text)
        or _NUMERIC_HEADING_RE.match(text)
        or _CHAPTER_RE.match(text)
    ):
        return False
    return not str(row.get("section_hint") or "").strip()


def _count_parent_heading_hint_misses(rows: list[dict[str, object]]) -> int:
    seen_heading = False
    misses = 0
    for row in rows:
        if bool(row.get("is_repeated_candidate")):
            continue
        if str(row.get("row_type") or "") == "heading":
            seen_heading = True
            continue
        if str(row.get("row_type") or "") != "paragraph":
            continue
        list_level_hint = row.get("list_level_hint")
        if list_level_hint in (None, "", 0):
            continue
        if not seen_heading:
            continue
        if not str(row.get("parent_heading_hint") or "").strip():
            misses += 1
    return misses


def _count_reading_order_gaps(rows: list[dict[str, object]]) -> int:
    orders_by_page: dict[int, list[int]] = defaultdict(list)
    for row in rows:
        page = row.get("page_start")
        reading_order = row.get("reading_order")
        if isinstance(page, int) and isinstance(reading_order, int):
            orders_by_page[page].append(reading_order)
    gaps = 0
    for page_orders in orders_by_page.values():
        ordered = sorted(page_orders)
        previous: int | None = None
        seen: set[int] = set()
        for value in ordered:
            if value in seen:
                gaps += 1
                continue
            seen.add(value)
            if previous is not None and value != previous + 1:
                gaps += 1
            previous = value
    return gaps
