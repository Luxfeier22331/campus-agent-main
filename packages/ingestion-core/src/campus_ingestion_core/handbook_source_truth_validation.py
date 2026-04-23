from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass

from campus_ingestion_core.handbook_cleanup_shared import RUNNING_HEADER_LINES
from campus_ingestion_core.source_truth_common import (
    detect_merged_cells,
    infer_table_column_count,
    infer_table_header_rows,
    infer_table_row_count,
    is_bottom_band,
    is_top_band,
    looks_like_cross_page_continuation,
)

FORBIDDEN_SOURCE_TRUTH_FIELDS = frozenset(
    {"clean_text", "chunk_id", "doc_id", "document_id", "version_id", "semantic_confidence"}
)
_REPEAT_SHORT_TEXT_MAX_LENGTH = 16
_REPEAT_STRUCTURAL_ROLES = frozenset({"header", "footer", "page_number"})


@dataclass(frozen=True, slots=True)
class HandbookSourceTruthValidationReport:
    total_rows: int
    row_type_counts: dict[str, int]
    forbidden_field_count: int
    heading_role_conflict_count: int
    page_number_leak_count: int
    repeat_candidate_miss_count: int
    repeat_metadata_conflict_count: int
    table_semantics_conflict_count: int
    table_fragment_miss_count: int
    cross_page_continuation_miss_count: int
    unknown_row_type_count: int
    passed: bool


def scan_handbook_source_truth_rows(
    rows: list[dict[str, object]],
) -> HandbookSourceTruthValidationReport:
    row_type_counts = Counter(str(row.get("row_type") or "") for row in rows)
    forbidden_field_count = sum(
        len(FORBIDDEN_SOURCE_TRUTH_FIELDS & set(row.keys())) for row in rows
    )
    heading_role_conflict_count = sum(1 for row in rows if _has_heading_role_conflict(row))
    page_number_leak_count = sum(1 for row in rows if _looks_like_page_number_leak(row))
    repeat_candidate_miss_count, repeat_metadata_conflict_count = _scan_repeat_candidate_state(
        rows
    )
    table_semantics_conflict_count = sum(1 for row in rows if _has_table_semantics_conflict(row))
    table_fragment_miss_count = _count_table_fragment_misses(rows)
    cross_page_continuation_miss_count = _count_cross_page_continuation_misses(rows)
    unknown_row_type_count = sum(
        1
        for row in rows
        if str(row.get("row_type") or "").strip() in {"", "unknown"}
        and not bool(row.get("is_blank"))
    )
    passed = not any(
        (
            forbidden_field_count,
            heading_role_conflict_count,
            page_number_leak_count,
            repeat_candidate_miss_count,
            repeat_metadata_conflict_count,
            table_semantics_conflict_count,
            table_fragment_miss_count,
            cross_page_continuation_miss_count,
            unknown_row_type_count,
        )
    )
    return HandbookSourceTruthValidationReport(
        total_rows=len(rows),
        row_type_counts=dict(sorted(row_type_counts.items())),
        forbidden_field_count=forbidden_field_count,
        heading_role_conflict_count=heading_role_conflict_count,
        page_number_leak_count=page_number_leak_count,
        repeat_candidate_miss_count=repeat_candidate_miss_count,
        repeat_metadata_conflict_count=repeat_metadata_conflict_count,
        table_semantics_conflict_count=table_semantics_conflict_count,
        table_fragment_miss_count=table_fragment_miss_count,
        cross_page_continuation_miss_count=cross_page_continuation_miss_count,
        unknown_row_type_count=unknown_row_type_count,
        passed=passed,
    )


def validate_handbook_source_truth_rows(rows: list[dict[str, object]]) -> None:
    report = scan_handbook_source_truth_rows(rows)
    if report.passed:
        return
    failures = {
        "forbidden_field_count": report.forbidden_field_count,
        "heading_role_conflict_count": report.heading_role_conflict_count,
        "page_number_leak_count": report.page_number_leak_count,
        "repeat_candidate_miss_count": report.repeat_candidate_miss_count,
        "repeat_metadata_conflict_count": report.repeat_metadata_conflict_count,
        "table_semantics_conflict_count": report.table_semantics_conflict_count,
        "table_fragment_miss_count": report.table_fragment_miss_count,
        "cross_page_continuation_miss_count": report.cross_page_continuation_miss_count,
        "unknown_row_type_count": report.unknown_row_type_count,
    }
    failure_summary = ", ".join(
        f"{key}={value}" for key, value in failures.items() if value
    ) or "unknown_failure"
    raise ValueError(f"handbook source truth validation failed: {failure_summary}")


def _has_heading_role_conflict(row: dict[str, object]) -> bool:
    row_type = str(row.get("row_type") or "")
    block_role = str(row.get("block_role") or "")
    heading_level = row.get("heading_level")
    if row_type == "heading":
        if block_role == "title":
            return not isinstance(heading_level, int)
        return heading_level not in (None, "") and not isinstance(heading_level, int)
    return heading_level not in (None, "")


def _looks_like_page_number_leak(row: dict[str, object]) -> bool:
    row_type = str(row.get("row_type") or "")
    if row_type == "page_number":
        return False
    block_role = str(row.get("block_role") or "")
    if block_role == "page_number":
        return True
    text = str(row.get("text_normalized") or "").strip()
    if not text.isdigit() or len(text) > 4:
        return False
    if block_role == "number":
        return True
    return is_bottom_band(bbox=_normalized_bbox(row))


def _scan_repeat_candidate_state(rows: list[dict[str, object]]) -> tuple[int, int]:
    rows_by_text: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        text = str(row.get("text_normalized") or "").strip()
        if text:
            rows_by_text[text].append(row)

    miss_count = 0
    metadata_conflict_count = 0
    for text, members in rows_by_text.items():
        if len({_coerce_int(row.get("page_start")) for row in members}) < 2:
            continue
        if not _is_repeat_sensitive_group(text=text, rows=members):
            continue
        expected_count = len(members)
        for row in members:
            if not bool(row.get("is_repeated_candidate")):
                miss_count += 1
                continue
            if (
                _coerce_int(row.get("repeat_frequency")) != expected_count
                or not str(row.get("repeat_cluster_id") or "").strip()
                or not str(row.get("repeat_position_band") or "").strip()
            ):
                metadata_conflict_count += 1
    return miss_count, metadata_conflict_count


def _is_repeat_sensitive_group(*, text: str, rows: list[dict[str, object]]) -> bool:
    if text in RUNNING_HEADER_LINES:
        return all(
            _is_margin_running_header_candidate(row) or _is_short_top_or_bottom_repeat_candidate(row)
            for row in rows
        )
    return all(_is_short_top_or_bottom_repeat_candidate(row) for row in rows)


def _is_margin_running_header_candidate(row: dict[str, object]) -> bool:
    reason = str(row.get("classification_reason") or "")
    return reason.startswith(("provider_label:aside_text", "provider_label:vertical_text"))


def _is_short_top_or_bottom_repeat_candidate(row: dict[str, object]) -> bool:
    text = str(row.get("text_normalized") or "").strip()
    if not text or len(text) > _REPEAT_SHORT_TEXT_MAX_LENGTH:
        return False
    block_role = str(row.get("block_role") or "")
    if block_role in _REPEAT_STRUCTURAL_ROLES:
        return True
    bbox = _normalized_bbox(row)
    return is_top_band(bbox=bbox) or is_bottom_band(bbox=bbox)


def _has_table_semantics_conflict(row: dict[str, object]) -> bool:
    if str(row.get("row_type") or "") != "table":
        return False
    table_cells = row.get("table_cells")
    html = str(row.get("html") or "")
    if table_cells in (None, []) and "<table" not in html.lower():
        return True
    expected_header_rows = infer_table_header_rows(table_cells)
    expected_row_count = infer_table_row_count(table_cells)
    expected_column_count = infer_table_column_count(table_cells)
    expected_has_merged_cells = detect_merged_cells(table_cells)
    return any(
        (
            row.get("table_header_rows") != expected_header_rows,
            row.get("table_row_count") != expected_row_count,
            row.get("table_column_count") != expected_column_count,
            row.get("table_has_merged_cells") != expected_has_merged_cells,
        )
    )


def _count_table_fragment_misses(rows: list[dict[str, object]]) -> int:
    misses = 0
    previous_table: dict[str, object] | None = None
    for row in rows:
        if str(row.get("row_type") or "") != "table":
            previous_table = (
                None if not bool(row.get("continues_from_previous_page")) else previous_table
            )
            continue
        if previous_table is not None and _should_share_table_fragment(previous_table, row):
            previous_fragment_id = str(previous_table.get("table_fragment_id") or "").strip()
            current_fragment_id = str(row.get("table_fragment_id") or "").strip()
            if not previous_fragment_id or previous_fragment_id != current_fragment_id:
                misses += 1
        previous_table = row
    return misses


def _should_share_table_fragment(
    previous_table: dict[str, object],
    current_table: dict[str, object],
) -> bool:
    previous_page = _coerce_int(previous_table.get("page_end"))
    current_page = _coerce_int(current_table.get("page_start"))
    if previous_page is None or current_page is None or current_page != previous_page + 1:
        return False
    if previous_table.get("table_column_count") != current_table.get("table_column_count"):
        return False
    return previous_table.get("table_header_rows") == current_table.get("table_header_rows")


def _count_cross_page_continuation_misses(rows: list[dict[str, object]]) -> int:
    paragraphs_by_page: dict[int, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        if bool(row.get("is_repeated_candidate")):
            continue
        if str(row.get("row_type") or "") not in {"paragraph", "list_item"}:
            continue
        page = _coerce_int(row.get("page_start"))
        if page is not None:
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


def _normalized_bbox(row: dict[str, object]) -> list[float] | None:
    bbox = row.get("bbox")
    if isinstance(bbox, list):
        return [float(value) for value in bbox if isinstance(value, (int, float))]
    return None


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
