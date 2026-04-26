from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Protocol

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.notice_derived_transport_schedule_tables import (
    iter_notice_derived_transport_table_matrices,
)
from campus_ingestion_core.registry import DocumentRegistry
from campus_ingestion_core.transport_schedule_projection import (
    DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
    TRANSPORT_SCHEDULE_PROJECTION_SCHEMA_VERSION,
    TransportScheduleProjectionBuildResult,
    _calendar_matches,
    _date_range,
    validate_transport_schedule_projection_bundle,
)
from campus_ingestion_core.transport_schedule_projection_routes import (
    TRANSPORT_ROUTES,
    route_by_id,
    route_payload,
)

_SHANGHAI_TZ = timezone(timedelta(hours=8))
_TIME_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)")
_FULL_DATE_RE = re.compile(r"(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?")
_YEARLESS_EFFECTIVE_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})日(?:起|开始|执行|生效)")
_YEARLESS_SINGLE_DATE_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})日")
_YEARLESS_MULTI_DAY_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})[、,，](\d{1,2})日")
_CHINESE_DATE_RANGE_RE = re.compile(
    r"(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?\s*"
    r"(?:至|到|\-|—|~|～)\s*"
    r"(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?"
)
_ORDINAL_RE = re.compile(r"^\d+[\.、]?$")
_BODY_TEXT_SPLIT_RE = re.compile(r"[\n。；;]")
_ONE_OFF_DATE_HINTS = ("本周", "周末", "临时", "当天", "当日")
_SERVICE_STOP_KEYWORDS = ("停运", "暂停", "停止运营", "不运行")
_REJECTED_SOURCE_SCHEMA_VERSION = "transport_schedule_rejected_sources.v1"


class NoticeDerivedTransportScheduleObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class NoticeDerivedTransportScheduleRow:
    source_notice_id: str
    source_ref: str
    source_attachment_document_id: str
    weekday_scope: str
    route_direction: str
    route_id: str
    departure_time: str
    rider_type: str
    remarks: str
    effective_from: str
    schedule_scope: str
    service_date_ranges: tuple[tuple[str, str], ...]
    precedence: int


@dataclass(frozen=True, slots=True)
class NoticeDerivedTransportServiceException:
    source_notice_id: str
    source_ref: str
    route_id: str
    service_date: str
    service_status: str
    operational_comment: str
    effective_from: str
    schedule_scope: str
    service_date_ranges: tuple[tuple[str, str], ...]
    precedence: int


def extract_notice_derived_transport_schedule_rows(
    *,
    projection_entry: NoticeConsumptionProjectionEntry,
    registry: DocumentRegistry,
    object_store: NoticeDerivedTransportScheduleObjectStore,
    derived_bucket: str,
) -> tuple[NoticeDerivedTransportScheduleRow, ...]:
    if not _is_ready_transport_candidate(projection_entry):
        return ()
    source_ref = _source_ref(projection_entry)
    parent_record = _resolve_registry_record(
        registry=registry,
        document_id=projection_entry.source_notice_document_id,
    )
    parent_text = _read_record_text(
        record=parent_record,
        object_store=object_store,
        derived_bucket=derived_bucket,
    )
    attachment_records = _resolve_attachment_records(
        projection_entry=projection_entry,
        registry=registry,
    )
    rows: list[NoticeDerivedTransportScheduleRow] = _extract_rows_from_parent_text(
        parent_text=parent_text,
        projection_entry=projection_entry,
        source_ref=source_ref,
    )
    for attachment_record in attachment_records:
        document_units = _read_document_units(
            record=attachment_record,
            object_store=object_store,
            derived_bucket=derived_bucket,
        )
        for matrix in iter_notice_derived_transport_table_matrices(
            document_units,
            clean_cell=_clean_cell,
            coerce_int=_coerce_int,
            extract_times=_extract_times,
            resolve_route=_resolve_route,
        ):
            rows.extend(
                _extract_rows_from_table_matrix(
                    matrix=matrix,
                    projection_entry=projection_entry,
                    source_ref=source_ref,
                    source_attachment_document_id=attachment_record.document_id,
                    parent_text=parent_text,
                )
            )
    return tuple(rows)


def extract_notice_derived_transport_service_exceptions(
    *,
    projection_entry: NoticeConsumptionProjectionEntry,
    registry: DocumentRegistry,
    object_store: NoticeDerivedTransportScheduleObjectStore,
    derived_bucket: str,
) -> tuple[NoticeDerivedTransportServiceException, ...]:
    if not _is_ready_transport_candidate(projection_entry):
        return ()
    source_ref = _source_ref(projection_entry)
    parent_record = _resolve_registry_record(
        registry=registry,
        document_id=projection_entry.source_notice_document_id,
    )
    parent_text = _read_record_text(
        record=parent_record,
        object_store=object_store,
        derived_bucket=derived_bucket,
    )
    return tuple(
        _extract_exceptions_from_parent_text(
            parent_text=parent_text,
            projection_entry=projection_entry,
            source_ref=source_ref,
        )
    )


def build_notice_derived_transport_schedule_projection_bundle(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    registry: DocumentRegistry,
    object_store: NoticeDerivedTransportScheduleObjectStore,
    derived_bucket: str,
    generated_at: str,
    service_horizon_days: int = DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
) -> TransportScheduleProjectionBuildResult:
    anchor = _parse_datetime(generated_at, field_name="generated_at")
    if service_horizon_days <= 0:
        raise ValueError("service_horizon_days must be positive")
    rows: list[NoticeDerivedTransportScheduleRow] = []
    exceptions: list[NoticeDerivedTransportServiceException] = []
    entries_by_notice: dict[str, NoticeConsumptionProjectionEntry] = {}
    for entry in projection_entries:
        if not _is_ready_transport_candidate(entry):
            continue
        entries_by_notice[entry.source_notice_id] = entry
        rows.extend(
            extract_notice_derived_transport_schedule_rows(
                projection_entry=entry,
                registry=registry,
                object_store=object_store,
                derived_bucket=derived_bucket,
            )
        )
        exceptions.extend(
            extract_notice_derived_transport_service_exceptions(
                projection_entry=entry,
                registry=registry,
                object_store=object_store,
                derived_bucket=derived_bucket,
            )
        )
    rows_by_notice: dict[str, list[NoticeDerivedTransportScheduleRow]] = {}
    for row in rows:
        rows_by_notice.setdefault(row.source_notice_id, []).append(row)
    exceptions_by_notice: dict[str, list[NoticeDerivedTransportServiceException]] = {}
    for exception in exceptions:
        exceptions_by_notice.setdefault(exception.source_notice_id, []).append(exception)
    rejected_sources = _build_rejected_sources(
        entries_by_notice=entries_by_notice,
        rows_by_notice=rows_by_notice,
        exceptions_by_notice=exceptions_by_notice,
    )

    snapshots: list[dict[str, Any]] = []
    for notice_id, notice_rows in rows_by_notice.items():
        entry = entries_by_notice[notice_id]
        published_at = _published_at(entry)
        service_date_ranges = notice_rows[0].service_date_ranges
        snapshots.append(
            {
                "snapshot_id": _snapshot_id(
                    source_notice_id=notice_id,
                    published_at=published_at,
                ),
                "published_at": published_at,
                "effective_from": _start_of_day(notice_rows[0].effective_from),
                "effective_until": _effective_until_for_ranges(service_date_ranges),
                "source_ref": notice_rows[0].source_ref,
                "is_current": False,
                "schedule_scope": notice_rows[0].schedule_scope,
                "service_date_ranges": [
                    {"start_date": start_date, "end_date": end_date}
                    for start_date, end_date in service_date_ranges
                ],
                "precedence": notice_rows[0].precedence,
            }
        )
    for notice_id, notice_exceptions in exceptions_by_notice.items():
        if notice_id in rows_by_notice:
            continue
        entry = entries_by_notice[notice_id]
        published_at = _published_at(entry)
        service_date_ranges = notice_exceptions[0].service_date_ranges
        snapshots.append(
            {
                "snapshot_id": _snapshot_id(
                    source_notice_id=notice_id,
                    published_at=published_at,
                ),
                "published_at": published_at,
                "effective_from": _start_of_day(notice_exceptions[0].effective_from),
                "effective_until": _effective_until_for_ranges(service_date_ranges),
                "source_ref": notice_exceptions[0].source_ref,
                "is_current": False,
                "schedule_scope": notice_exceptions[0].schedule_scope,
                "service_date_ranges": [
                    {"start_date": start_date, "end_date": end_date}
                    for start_date, end_date in service_date_ranges
                ],
                "precedence": notice_exceptions[0].precedence,
            }
        )
    snapshots.sort(key=lambda item: str(item["published_at"]))
    if snapshots:
        current_candidates = [
            snapshot
            for snapshot in snapshots
            if snapshot.get("schedule_scope") == "baseline_revision"
        ]
        (current_candidates or snapshots)[-1]["is_current"] = True

    snapshot_id_by_notice = {
        snapshot["source_ref"].split(":")[-1]: snapshot["snapshot_id"] for snapshot in snapshots
    }
    scheduled_departures = _build_scheduled_departures(
        rows=rows,
        snapshot_id_by_notice=snapshot_id_by_notice,
        anchor=anchor,
        service_horizon_days=service_horizon_days,
    )
    service_exceptions = _build_transport_service_exceptions(
        exceptions=exceptions,
        snapshot_id_by_notice=snapshot_id_by_notice,
    )
    bundle = {
        "schema_version": TRANSPORT_SCHEDULE_PROJECTION_SCHEMA_VERSION,
        "service_status_records": [],
        "transport_schedule_snapshots": snapshots,
        "transport_routes": [route_payload(route) for route in TRANSPORT_ROUTES],
        "scheduled_departures": scheduled_departures,
        "transport_service_exceptions": service_exceptions,
    }
    validation_report = validate_transport_schedule_projection_bundle(bundle)
    return TransportScheduleProjectionBuildResult(
        bundle=bundle,
        validation_report=validation_report,
        rejected_source_records=rejected_sources,
    )


def _is_ready_transport_candidate(entry: NoticeConsumptionProjectionEntry) -> bool:
    return (
        entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
        and str(entry.role_metadata.get("service_status_candidate_kind") or "")
        == "transport_schedule"
    )


def _build_rejected_sources(
    *,
    entries_by_notice: Mapping[str, NoticeConsumptionProjectionEntry],
    rows_by_notice: Mapping[str, Sequence[NoticeDerivedTransportScheduleRow]],
    exceptions_by_notice: Mapping[str, Sequence[NoticeDerivedTransportServiceException]],
) -> list[dict[str, Any]]:
    rejected: list[dict[str, Any]] = []
    for notice_id, entry in sorted(entries_by_notice.items()):
        if rows_by_notice.get(notice_id) or exceptions_by_notice.get(notice_id):
            continue
        rejected.append(
            {
                "schema_version": _REJECTED_SOURCE_SCHEMA_VERSION,
                "source_notice_id": notice_id,
                "source_ref": _source_ref(entry),
                "reason": "no_supported_transport_schedule_rows",
                "candidate_kind": str(
                    entry.role_metadata.get("service_status_candidate_kind") or "transport_schedule"
                ),
            }
        )
    return rejected


def _resolve_attachment_records(
    *,
    projection_entry: NoticeConsumptionProjectionEntry,
    registry: DocumentRegistry,
) -> tuple[DocumentRegistryRecord, ...]:
    document_ids = tuple(
        str(item).strip()
        for item in projection_entry.role_metadata.get("attachment_document_ids") or ()
        if str(item).strip()
    )
    records: list[DocumentRegistryRecord] = []
    for document_id in document_ids:
        record = _resolve_registry_record(registry=registry, document_id=document_id)
        if record is not None:
            records.append(record)
    return tuple(records)


def _resolve_registry_record(
    *,
    registry: DocumentRegistry,
    document_id: str,
) -> DocumentRegistryRecord | None:
    record = registry.current_version(
        document_id,
        preferred_revision_tracks=("source-faithful",),
    )
    if record is not None:
        return record
    versions = registry.list_versions(document_id, revision_track="source-faithful")
    if versions:
        return versions[0]
    versions = registry.list_versions(document_id)
    return versions[0] if versions else None


def _read_record_text(
    *,
    record: DocumentRegistryRecord | None,
    object_store: NoticeDerivedTransportScheduleObjectStore,
    derived_bucket: str,
) -> str:
    if record is None or not record.canonical_markdown_object_key:
        return ""
    try:
        return object_store.get_bytes(
            bucket=derived_bucket,
            key=record.canonical_markdown_object_key,
        ).decode("utf-8")
    except KeyError:
        return ""


def _read_document_units(
    *,
    record: DocumentRegistryRecord,
    object_store: NoticeDerivedTransportScheduleObjectStore,
    derived_bucket: str,
) -> tuple[dict[str, Any], ...]:
    if not record.document_units_object_key:
        return ()
    payload = object_store.get_bytes(
        bucket=derived_bucket,
        key=record.document_units_object_key,
    )
    units: list[dict[str, Any]] = []
    for line in payload.decode("utf-8").splitlines():
        if not line.strip():
            continue
        unit = json.loads(line)
        if isinstance(unit, dict):
            units.append(dict(unit))
    return tuple(units)


def _extract_rows_from_table_matrix(
    *,
    matrix: tuple[tuple[str, ...], ...],
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
    source_attachment_document_id: str,
    parent_text: str,
) -> list[NoticeDerivedTransportScheduleRow]:
    filled_rows = _fill_down_context(matrix)
    extracted: list[NoticeDerivedTransportScheduleRow] = []
    service_date_ranges = _resolve_service_date_ranges(
        text=parent_text,
        release_time=projection_entry.source_notice_release_time,
    )
    for row in filled_rows:
        row_text = " ".join(cell for cell in row if cell)
        if not row_text or _is_header_row(row_text):
            continue
        route = _resolve_route(row_text)
        if route is None:
            continue
        schedule_scope = _resolve_schedule_scope(
            parent_text=parent_text,
            row_text=row_text,
            service_date_ranges=service_date_ranges,
        )
        weekday_scope = _resolve_weekday_scope(row_text, route.default_calendar)
        rider_type = _resolve_rider_type(row_text)
        effective_from = _resolve_effective_date(
            text=f"{parent_text}\n{row_text}",
            release_time=projection_entry.source_notice_release_time,
        )
        remarks = _resolve_remarks(row)
        for departure_time in _extract_times(row_text):
            extracted.append(
                NoticeDerivedTransportScheduleRow(
                    source_notice_id=projection_entry.source_notice_id,
                    source_ref=source_ref,
                    source_attachment_document_id=source_attachment_document_id,
                    weekday_scope=weekday_scope,
                    route_direction=_route_direction(route.route_id),
                    route_id=route.route_id,
                    departure_time=departure_time,
                    rider_type=rider_type,
                    remarks=remarks,
                    effective_from=effective_from,
                    schedule_scope=schedule_scope,
                    service_date_ranges=service_date_ranges,
                    precedence=_schedule_scope_precedence(schedule_scope),
                )
            )
    return extracted


def _extract_rows_from_parent_text(
    *,
    parent_text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
) -> list[NoticeDerivedTransportScheduleRow]:
    rows: list[NoticeDerivedTransportScheduleRow] = []
    for segment in _text_segments(parent_text):
        if not _extract_times(segment):
            continue
        route = _resolve_route(segment)
        if route is None:
            continue
        service_date_ranges = _resolve_segment_service_date_ranges(
            text=segment,
            release_time=projection_entry.source_notice_release_time,
            allow_open_ended_effective_date=False,
        )
        effective_from = (
            service_date_ranges[0][0]
            if service_date_ranges
            else _resolve_effective_date(
                text=f"{parent_text}\n{segment}",
                release_time=projection_entry.source_notice_release_time,
            )
        )
        schedule_scope = _resolve_schedule_scope(
            parent_text=parent_text,
            row_text=segment,
            service_date_ranges=service_date_ranges,
        )
        for departure_time in _extract_times(segment):
            rows.append(
                NoticeDerivedTransportScheduleRow(
                    source_notice_id=projection_entry.source_notice_id,
                    source_ref=source_ref,
                    source_attachment_document_id=projection_entry.source_notice_document_id,
                    weekday_scope=_resolve_weekday_scope(segment, route.default_calendar),
                    route_direction=_route_direction(route.route_id),
                    route_id=route.route_id,
                    departure_time=departure_time,
                    rider_type=_resolve_rider_type(segment),
                    remarks=_clean_cell(segment),
                    effective_from=effective_from,
                    schedule_scope=schedule_scope,
                    service_date_ranges=service_date_ranges,
                    precedence=_schedule_scope_precedence(schedule_scope),
                )
            )
    return rows


def _extract_exceptions_from_parent_text(
    *,
    parent_text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
) -> list[NoticeDerivedTransportServiceException]:
    exceptions: list[NoticeDerivedTransportServiceException] = []
    for segment in _text_segments(parent_text):
        if not any(keyword in segment for keyword in _SERVICE_STOP_KEYWORDS):
            continue
        route = _resolve_route(segment)
        if route is None:
            continue
        service_date_ranges = _resolve_segment_service_date_ranges(
            text=segment,
            release_time=projection_entry.source_notice_release_time,
            allow_open_ended_effective_date=True,
        )
        if not service_date_ranges:
            service_date_ranges = _resolve_service_date_ranges(
                text=parent_text,
                release_time=projection_entry.source_notice_release_time,
            )
        if not service_date_ranges:
            continue
        for start_date, end_date in service_date_ranges:
            for service_date in _date_range(
                date.fromisoformat(start_date),
                (date.fromisoformat(end_date) - date.fromisoformat(start_date)).days + 1,
            ):
                exceptions.append(
                    NoticeDerivedTransportServiceException(
                        source_notice_id=projection_entry.source_notice_id,
                        source_ref=source_ref,
                        route_id=route.route_id,
                        service_date=service_date.isoformat(),
                        service_status="temporarily_suspended",
                        operational_comment=_clean_cell(segment),
                        effective_from=start_date,
                        schedule_scope="exception_status",
                        service_date_ranges=((start_date, end_date),),
                        precedence=_schedule_scope_precedence("exception_status"),
                    )
                )
    return exceptions


def _fill_down_context(
    matrix: tuple[tuple[str, ...], ...],
) -> tuple[tuple[str, ...], ...]:
    max_width = max((len(row) for row in matrix), default=0)
    previous = ["" for _index in range(max_width)]
    last_route_context: tuple[str, ...] | None = None
    filled: list[tuple[str, ...]] = []
    for raw_row in matrix:
        row = list(raw_row) + ["" for _index in range(max_width - len(raw_row))]
        next_row: list[str] = []
        for index, cell in enumerate(row):
            normalized = _clean_cell(cell)
            if normalized:
                previous[index] = normalized
                next_row.append(normalized)
            elif index <= 1:
                next_row.append(previous[index])
            else:
                next_row.append("")
        normalized_row = tuple(next_row)
        if (
            last_route_context is not None
            and _extract_times(" ".join(normalized_row))
            and _resolve_route(" ".join(normalized_row)) is None
        ):
            normalized_row = _normalize_left_shifted_continuation_row(
                row=normalized_row,
                context=last_route_context,
                max_width=max_width,
            )
        if _resolve_route(" ".join(normalized_row)) is not None:
            last_route_context = normalized_row
        filled.append(normalized_row)
    return tuple(filled)


def _normalize_left_shifted_continuation_row(
    *,
    row: tuple[str, ...],
    context: tuple[str, ...],
    max_width: int,
) -> tuple[str, ...]:
    cells = [cell for cell in row if cell and not _ORDINAL_RE.fullmatch(cell)]
    time_cell = next((cell for cell in cells if _extract_times(cell)), "")
    rider_cell = next(
        (cell for cell in cells if cell != time_cell and _resolve_rider_type(cell)),
        "",
    )
    remarks = "；".join(
        cell for cell in cells if cell not in {time_cell, rider_cell} and not _extract_times(cell)
    )
    normalized = [
        context[0] if len(context) > 0 else "",
        context[1] if len(context) > 1 else "",
        context[2] if len(context) > 2 else "",
        time_cell,
        rider_cell,
        remarks,
    ]
    return tuple(normalized[:max_width] + ["" for _index in range(max_width - len(normalized))])


def _build_scheduled_departures(
    *,
    rows: Sequence[NoticeDerivedTransportScheduleRow],
    snapshot_id_by_notice: Mapping[str, str],
    anchor: datetime,
    service_horizon_days: int,
) -> list[dict[str, Any]]:
    departures: list[dict[str, Any]] = []
    seen: set[tuple[str, str, tuple[str, ...], str, str, str, tuple[str, ...], str]] = set()
    anchor_date = anchor.date()
    for row in rows:
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
            (row.source_ref,),
            operational_comment,
        )
        if key in seen:
            continue
        seen.add(key)
        departures.append(
            {
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
        )
    return sorted(
        departures,
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


def _service_dates_for_row(
    *,
    row: NoticeDerivedTransportScheduleRow,
    anchor_date: date,
    service_horizon_days: int,
) -> list[str]:
    effective = date.fromisoformat(row.effective_from)
    horizon_dates = tuple(_date_range(max(anchor_date, effective), service_horizon_days))
    if not row.service_date_ranges:
        return [
            candidate.isoformat()
            for candidate in horizon_dates
            if _calendar_matches(candidate, row.weekday_scope)
        ]
    service_dates: list[str] = []
    for start_text, end_text in row.service_date_ranges:
        start_date = max(date.fromisoformat(start_text), effective)
        end_date = date.fromisoformat(end_text)
        if end_date < start_date:
            continue
        for candidate in _date_range(start_date, (end_date - start_date).days + 1):
            if candidate >= anchor_date and candidate not in horizon_dates:
                continue
            if _calendar_matches(candidate, row.weekday_scope):
                service_dates.append(candidate.isoformat())
    return sorted(dict.fromkeys(service_dates))


def _source_ref(entry: NoticeConsumptionProjectionEntry) -> str:
    parts = str(entry.source_notice_document_id or "").split(":")
    if len(parts) == 3 and parts[0] == "notice":
        return entry.source_notice_document_id
    return f"notice:muc_internal_portal:{entry.source_notice_id}"


def _published_at(entry: NoticeConsumptionProjectionEntry) -> str:
    return _parse_datetime(
        entry.source_notice_release_time or entry.updated_at,
        field_name="source_notice_release_time",
    ).isoformat()


def _snapshot_id(*, source_notice_id: str, published_at: str) -> str:
    published_date = _parse_datetime(published_at, field_name="published_at").date().isoformat()
    return f"snapshot:transport-schedule:{published_date}:{source_notice_id}"


def _start_of_day(value: str) -> str:
    return datetime.combine(date.fromisoformat(value), time.min, _SHANGHAI_TZ).isoformat()


def _effective_until_for_ranges(service_date_ranges: tuple[tuple[str, str], ...]) -> str:
    if not service_date_ranges:
        return ""
    latest_end = max(date.fromisoformat(end_date) for _start_date, end_date in service_date_ranges)
    return datetime.combine(latest_end + timedelta(days=1), time.min, _SHANGHAI_TZ).isoformat()


def _resolve_schedule_scope(
    *,
    parent_text: str,
    row_text: str,
    service_date_ranges: tuple[tuple[str, str], ...],
) -> str:
    combined = f"{parent_text}\n{row_text}"
    if any(keyword in combined for keyword in ("停运", "暂停", "不运行")):
        return "exception_status"
    if service_date_ranges:
        if any(keyword in combined for keyword in ("调整", "变更", "优化")):
            return "temporary_period_revision"
        return "temporary_period"
    return "baseline_revision"


def _schedule_scope_precedence(schedule_scope: str) -> int:
    return {
        "exception_status": 400,
        "temporary_period_revision": 300,
        "temporary_period": 250,
        "baseline_revision": 100,
    }.get(schedule_scope, 0)


def _resolve_service_date_ranges(
    *,
    text: str,
    release_time: str | None,
) -> tuple[tuple[str, str], ...]:
    release_year = _parse_datetime(
        release_time or datetime.now(_SHANGHAI_TZ).isoformat(),
        field_name="source_notice_release_time",
    ).year
    ranges: list[tuple[str, str]] = []
    for match in _CHINESE_DATE_RANGE_RE.finditer(text):
        start_year = int(match.group(1) or release_year)
        end_year = int(match.group(4) or start_year)
        start_date = date(start_year, int(match.group(2)), int(match.group(3)))
        end_date = date(end_year, int(match.group(5)), int(match.group(6)))
        if end_date < start_date and match.group(4) is None:
            end_date = date(start_year + 1, end_date.month, end_date.day)
        ranges.append((start_date.isoformat(), end_date.isoformat()))
    return tuple(dict.fromkeys(ranges))


def _resolve_segment_service_date_ranges(
    *,
    text: str,
    release_time: str | None,
    allow_open_ended_effective_date: bool,
) -> tuple[tuple[str, str], ...]:
    ranges = list(_resolve_service_date_ranges(text=text, release_time=release_time))
    release_year = _parse_datetime(
        release_time or datetime.now(_SHANGHAI_TZ).isoformat(),
        field_name="source_notice_release_time",
    ).year
    for match in _FULL_DATE_RE.finditer(text):
        value = date(int(match.group(1)), int(match.group(2)), int(match.group(3))).isoformat()
        ranges.append((value, value))
    for match in _YEARLESS_MULTI_DAY_RE.finditer(text):
        month = int(match.group(1))
        for day_text in (match.group(2), match.group(3)):
            value = date(release_year, month, int(day_text)).isoformat()
            ranges.append((value, value))
    should_use_yearless_single_date = allow_open_ended_effective_date or any(
        hint in text for hint in _ONE_OFF_DATE_HINTS
    )
    if should_use_yearless_single_date:
        for match in _YEARLESS_SINGLE_DATE_RE.finditer(text):
            value = date(release_year, int(match.group(1)), int(match.group(2))).isoformat()
            ranges.append((value, value))
    return tuple(dict.fromkeys(ranges))


def _resolve_effective_date(*, text: str, release_time: str | None) -> str:
    full_date = _first_full_date(text)
    if full_date is not None:
        return full_date.isoformat()
    release_year = _parse_datetime(
        release_time or datetime.now(_SHANGHAI_TZ).isoformat(),
        field_name="source_notice_release_time",
    ).year
    yearless_match = _YEARLESS_EFFECTIVE_RE.search(text)
    if yearless_match is not None:
        return date(
            release_year,
            int(yearless_match.group(1)),
            int(yearless_match.group(2)),
        ).isoformat()
    return (
        _parse_datetime(
            release_time or datetime.now(_SHANGHAI_TZ).isoformat(),
            field_name="source_notice_release_time",
        )
        .date()
        .isoformat()
    )


def _first_full_date(value: str) -> date | None:
    match = _FULL_DATE_RE.search(value)
    if match is None:
        return None
    return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))


def _resolve_route(row_text: str):
    compact = "".join(row_text.split())
    fengtai_index = compact.find("丰台")
    wukesong_index = compact.find("五棵松")
    if fengtai_index >= 0 and wukesong_index >= 0:
        if fengtai_index < wukesong_index:
            return route_by_id("route:fengtai-to-wukesong-subway")
        return route_by_id("route:wukesong-subway-to-fengtai")
    haidian_index = compact.find("海淀")
    if haidian_index >= 0 and fengtai_index >= 0:
        if haidian_index < fengtai_index:
            return route_by_id("route:haidian-to-fengtai")
        return route_by_id("route:fengtai-to-haidian")
    if "接驳" in compact or "地铁" in compact:
        return route_by_id("route:subway-shuttle")
    return None


def _route_direction(route_id: str) -> str:
    return {
        "route:haidian-to-fengtai": "haidian_to_fengtai",
        "route:fengtai-to-haidian": "fengtai_to_haidian",
        "route:subway-shuttle": "subway_shuttle",
        "route:fengtai-to-wukesong-subway": "fengtai_to_wukesong_subway",
        "route:wukesong-subway-to-fengtai": "wukesong_subway_to_fengtai",
    }.get(route_id, route_id)


def _resolve_weekday_scope(row_text: str, default_calendar: str) -> str:
    if any(keyword in row_text for keyword in ("工作日", "周一至周五", "星期一至星期五")):
        return "weekdays"
    if any(keyword in row_text for keyword in ("周末", "周六", "周日", "星期六", "星期日")):
        return "weekends"
    if any(keyword in row_text for keyword in ("每日", "每天", "周一至周日")):
        return "daily"
    return default_calendar


def _resolve_rider_type(row_text: str) -> str:
    if "师生" in row_text:
        return "师生"
    if "学生" in row_text:
        return "学生"
    if "教师" in row_text or "教职工" in row_text:
        return "教师"
    return ""


def _resolve_remarks(row: Sequence[str]) -> str:
    values = [
        cell
        for cell in row
        if cell
        and not _TIME_RE.fullmatch(cell)
        and cell not in {"工作日", "周末", "每日", "每天"}
        and "校区" not in cell
        and "东门" not in cell
        and "南门" not in cell
        and cell not in {"学生", "教师", "师生", "教职工"}
    ]
    return "；".join(dict.fromkeys(values))


def _extract_times(value: str) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            f"{int(match.group(1)):02d}:{match.group(2)}" for match in _TIME_RE.finditer(value)
        )
    )


def _is_header_row(value: str) -> bool:
    return "发车时间" in value or ("运行方向" in value and "乘车" in value)


def _text_segments(value: str) -> tuple[str, ...]:
    return tuple(
        segment
        for segment in (_clean_cell(item) for item in _BODY_TEXT_SPLIT_RE.split(value))
        if segment
    )


def _parse_datetime(value: object, *, field_name: str) -> datetime:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    candidates = [normalized.replace("Z", "+00:00")]
    if " " in normalized and "T" not in normalized:
        candidates.append(normalized.replace(" ", "T"))
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=_SHANGHAI_TZ)
            return parsed.astimezone(_SHANGHAI_TZ)
        except ValueError:
            pass
    for layout in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d %H:%M", "%Y/%m/%d"):
        try:
            return datetime.strptime(normalized, layout).replace(tzinfo=_SHANGHAI_TZ)
        except ValueError:
            pass
    raise ValueError(f"{field_name} must be an ISO datetime or local date/time")


def _clean_cell(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("：", ":")).strip()


def _coerce_int(value: object) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


__all__ = [
    "NoticeDerivedTransportScheduleObjectStore",
    "NoticeDerivedTransportScheduleRow",
    "NoticeDerivedTransportServiceException",
    "build_notice_derived_transport_schedule_projection_bundle",
    "extract_notice_derived_transport_schedule_rows",
    "extract_notice_derived_transport_service_exceptions",
]
