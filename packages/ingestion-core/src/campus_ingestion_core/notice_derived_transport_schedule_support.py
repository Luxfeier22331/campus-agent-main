from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import date, timedelta
from typing import Any


def build_notice_derived_transport_rejected_sources(
    *,
    entries_by_notice: Mapping[str, Any],
    rows_by_notice: Mapping[str, Sequence[Any]],
    exceptions_by_notice: Mapping[str, Sequence[Any]],
    source_ref: Callable[[Any], str],
    schema_version: str,
) -> list[dict[str, Any]]:
    rejected: list[dict[str, Any]] = []
    for notice_id, entry in sorted(entries_by_notice.items()):
        if rows_by_notice.get(notice_id) or exceptions_by_notice.get(notice_id):
            continue
        rejected.append(
            {
                "schema_version": schema_version,
                "source_notice_id": notice_id,
                "source_ref": source_ref(entry),
                "reason": "no_supported_transport_schedule_rows",
                "candidate_kind": str(
                    entry.role_metadata.get("service_status_candidate_kind") or "transport_schedule"
                ),
            }
        )
    return rejected


def merge_service_date_ranges(
    ranges_by_item: Iterable[tuple[tuple[str, str], ...]],
) -> tuple[tuple[str, str], ...]:
    ranges_by_item = tuple(ranges_by_item)
    if not ranges_by_item:
        return ()
    if any(not ranges for ranges in ranges_by_item):
        return ()
    intervals = sorted(
        (date.fromisoformat(start_date), date.fromisoformat(end_date))
        for ranges in ranges_by_item
        for start_date, end_date in ranges
    )
    merged: list[tuple[date, date]] = []
    for start_date, end_date in intervals:
        if not merged or start_date > merged[-1][1] + timedelta(days=1):
            merged.append((start_date, end_date))
            continue
        if end_date > merged[-1][1]:
            merged[-1] = (merged[-1][0], end_date)
    return tuple((start.isoformat(), end.isoformat()) for start, end in merged)


def merge_unique_strings(
    existing: Sequence[str],
    incoming: Sequence[str],
) -> list[str]:
    values: list[str] = []
    for value in (*existing, *incoming):
        text = str(value).strip()
        if text and text not in values:
            values.append(text)
    return values


def merge_operational_comments(existing: str, incoming: str) -> str:
    values: list[str] = []
    for text in (existing, incoming):
        for part in str(text).split("；"):
            value = part.strip()
            if value and value not in values:
                values.append(value)
    return "；".join(values)


def reservation_open_time_segment(segment: str) -> bool:
    return "预约" in segment and any(
        keyword in segment for keyword in ("开放", "释放", "可预约资源", "系统")
    )


__all__ = (
    "build_notice_derived_transport_rejected_sources",
    "merge_operational_comments",
    "merge_service_date_ranges",
    "merge_unique_strings",
    "reservation_open_time_segment",
)
