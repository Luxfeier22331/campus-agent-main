from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from campus_ingestion_core.notice_derived_transport_schedule_models import (
    NoticeDerivedTransportOperationalNotice,
    NoticeDerivedTransportScheduleRow,
    NoticeDerivedTransportServiceException,
)
from campus_ingestion_core.notice_derived_transport_schedule_parsing import _service_dates_for_row
from campus_ingestion_core.notice_derived_transport_schedule_support import (
    merge_operational_comments,
    merge_unique_strings,
)
from campus_ingestion_core.transport_schedule_projection_routes import route_by_id


def _build_scheduled_departures(
    *,
    rows: Sequence[NoticeDerivedTransportScheduleRow],
    snapshot_id_by_notice: Mapping[str, str],
    current_unbounded_notice_ids: set[str],
    anchor: datetime,
    service_horizon_days: int,
) -> list[dict[str, Any]]:
    departures_by_key: dict[
        tuple[str, str, tuple[str, ...], str, str, str],
        dict[str, Any],
    ] = {}
    anchor_date = anchor.date()
    for row in rows:
        if row.schedule_scope == "exception_status":
            continue
        if not row.service_date_ranges and row.source_notice_id not in current_unbounded_notice_ids:
            continue
        snapshot_id = snapshot_id_by_notice.get(row.source_notice_id)
        if not snapshot_id:
            continue
        route = route_by_id(row.route_id)
        service_dates = _service_dates_for_row(
            row=row,
            anchor_date=anchor_date,
            service_horizon_days=service_horizon_days,
        )
        if not service_dates:
            continue
        operational_comment = "；".join(
            item
            for item in (
                f"乘车人员：{row.rider_type}" if row.rider_type else "",
                row.remarks,
            )
            if item
        )
        key = (
            snapshot_id,
            route.route_id,
            tuple(service_dates),
            row.departure_time,
            route.origin_stop_id,
            route.destination_stop_id,
        )
        existing = departures_by_key.get(key)
        if existing is not None:
            existing["related_notice_refs"] = merge_unique_strings(
                existing["related_notice_refs"],
                (row.source_ref,),
            )
            existing["operational_comment"] = merge_operational_comments(
                str(existing["operational_comment"]),
                operational_comment,
            )
            continue
        departures_by_key[key] = {
            "snapshot_id": snapshot_id,
            "route_id": route.route_id,
            "service_dates": service_dates,
            "departure_time": row.departure_time,
            "arrival_time": "",
            "origin_stop_id": route.origin_stop_id,
            "destination_stop_id": route.destination_stop_id,
            "related_notice_refs": [row.source_ref],
            "operational_comment": operational_comment,
        }
    return sorted(
        departures_by_key.values(),
        key=lambda item: (
            str(item["route_id"]),
            str(item["departure_time"]),
            tuple(item["related_notice_refs"]),
        ),
    )


def _build_transport_service_exceptions(
    *,
    exceptions: Sequence[NoticeDerivedTransportServiceException],
    snapshot_id_by_notice: Mapping[str, str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for exception in exceptions:
        snapshot_id = snapshot_id_by_notice.get(exception.source_notice_id)
        if not snapshot_id:
            continue
        key = (
            snapshot_id,
            exception.route_id,
            exception.service_date,
            exception.service_status,
        )
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "snapshot_id": snapshot_id,
                "route_id": exception.route_id,
                "service_date": exception.service_date,
                "service_status": exception.service_status,
                "related_notice_refs": [exception.source_ref],
                "operational_comment": exception.operational_comment,
            }
        )
    return sorted(
        rows,
        key=lambda item: (
            str(item["service_date"]),
            str(item["route_id"]),
            tuple(item["related_notice_refs"]),
        ),
    )


def _build_transport_operational_notice_records(
    operational_notices: Sequence[NoticeDerivedTransportOperationalNotice],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for notice in operational_notices:
        key = (notice.source_notice_id, notice.notice_kind, ",".join(notice.route_ids))
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "notice_id": notice.source_notice_id,
                "source_ref": notice.source_ref,
                "notice_kind": notice.notice_kind,
                "route_ids": list(notice.route_ids),
                "effective_from": notice.effective_from,
                "effective_until": notice.effective_until,
                "operational_comment": notice.operational_comment,
            }
        )
    return sorted(
        rows,
        key=lambda item: (
            str(item["effective_from"]),
            str(item["notice_id"]),
            str(item["notice_kind"]),
        ),
    )
