from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol

from campus_ingestion_core.notice_derived_transport_schedule_parsing import (
    _clean_cell,
    _resolve_segment_service_date_ranges,
    _resolve_service_date_ranges,
)


class TransportScheduleRowForDedupe(Protocol):
    source_notice_id: str
    source_attachment_document_id: str
    route_id: str
    departure_time: str
    rider_type: str
    schedule_scope: str
    service_date_ranges: tuple[tuple[str, str], ...]


def dedupe_transport_schedule_rows[TTransportScheduleRow: TransportScheduleRowForDedupe](
    rows: list[TTransportScheduleRow],
) -> list[TTransportScheduleRow]:
    deduped: list[TTransportScheduleRow] = []
    seen: set[tuple[object, ...]] = set()
    for row in rows:
        key = (
            row.source_notice_id,
            row.source_attachment_document_id,
            row.route_id,
            row.departure_time,
            row.rider_type,
            row.schedule_scope,
            row.service_date_ranges,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def resolve_body_schedule_service_date_ranges(
    *,
    extraction_service_window: str,
    parent_text: str,
    release_time: str | None,
) -> tuple[tuple[str, str], ...]:
    if extraction_service_window:
        ranged = _resolve_service_date_ranges(
            text=extraction_service_window,
            release_time=release_time,
        )
        if ranged:
            return ranged
        return _resolve_segment_service_date_ranges(
            text=extraction_service_window,
            release_time=release_time,
            allow_open_ended_effective_date=True,
        )
    return _resolve_segment_service_date_ranges(
        text=parent_text,
        release_time=release_time,
        allow_open_ended_effective_date=False,
    )


def body_schedule_row_text(row: Mapping[str, str]) -> str:
    return _clean_cell(
        " ".join(
            item
            for item in (
                row.get("route_text", ""),
                row.get("direction_label", ""),
                row.get("sequence_label", ""),
                row.get("departure_time", ""),
                row.get("boarding_location", ""),
            )
            if item
        )
    )


def body_schedule_row_remarks(row: Mapping[str, str]) -> str:
    return "；".join(
        dict.fromkeys(
            item
            for item in (
                row.get("sequence_label", ""),
                f"乘车地点：{row.get('boarding_location', '')}"
                if row.get("boarding_location")
                else "",
            )
            if item
        )
    )
