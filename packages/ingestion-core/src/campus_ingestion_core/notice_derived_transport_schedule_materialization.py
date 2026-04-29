from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Protocol

from campus_ingestion_core.internal_notice_schedule_body import (
    ScheduleNoticeBody,
    extract_schedule_from_notice_body,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.notice_derived_transport_schedule_body_materialization import (
    body_schedule_row_remarks,
    body_schedule_row_text,
    dedupe_transport_schedule_rows,
    resolve_body_schedule_service_date_ranges,
)
from campus_ingestion_core.notice_derived_transport_schedule_parsing import (
    _clean_cell,
    _coerce_int,
    _effective_until_for_ranges,
    _extract_table_departure_times,
    _extract_times,
    _is_header_row,
    _parse_datetime,
    _published_at,
    _resolve_effective_date,
    _resolve_remarks,
    _resolve_rider_type,
    _resolve_route,
    _resolve_schedule_scope,
    _resolve_segment_service_date_ranges,
    _resolve_service_date_ranges,
    _resolve_weekday_scope,
    _route_direction,
    _schedule_scope_precedence,
    _service_dates_for_row,
    _snapshot_id,
    _source_ref,
    _start_of_day,
    _text_segments,
)
from campus_ingestion_core.notice_derived_transport_schedule_support import (
    build_notice_derived_transport_rejected_sources,
    merge_operational_comments,
    merge_service_date_ranges,
    merge_unique_strings,
    reservation_open_time_segment,
)
from campus_ingestion_core.notice_derived_transport_schedule_tables import (
    iter_notice_derived_transport_table_matrices,
)
from campus_ingestion_core.registry import DocumentRegistry
from campus_ingestion_core.transport_schedule_projection import (
    DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
    TRANSPORT_SCHEDULE_PROJECTION_SCHEMA_VERSION,
    TransportScheduleProjectionBuildResult,
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
_YEARLESS_EFFECTIVE_RE = re.compile(
    r"(?<!\d)(?:[（(])?(\d{1,2})月(\d{1,2})日(?:[）)])?"
    r"(?:[（(][^）)]{1,12}[）)])?(?:起|开始|执行|生效)"
)
_YEARLESS_SINGLE_DATE_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})日")
_YEARLESS_MULTI_DAY_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})[、,，](\d{1,2})日")
_CHINESE_DATE_RANGE_RE = re.compile(
    r"(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?\s*"
    r"(?:至|到|\-|—|~|～)\s*"
    r"(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?"
)
_ORDINAL_RE = re.compile(r"^\d+[\.、]?$")
_BODY_TEXT_SPLIT_RE = re.compile(r"[\n。；;]")
_MARKDOWN_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+")
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


@dataclass(frozen=True, slots=True)
class NoticeDerivedTransportOperationalNotice:
    source_notice_id: str
    source_ref: str
    notice_kind: str
    route_ids: tuple[str, ...]
    effective_from: str
    effective_until: str
    operational_comment: str


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
    rows: list[NoticeDerivedTransportScheduleRow] = _extract_rows_from_body_schedule(
        parent_text=parent_text,
        projection_entry=projection_entry,
        source_ref=source_ref,
    )
    rows.extend(
        _extract_rows_from_parent_text(
            parent_text=parent_text,
            projection_entry=projection_entry,
            source_ref=source_ref,
        )
    )
    rows = dedupe_transport_schedule_rows(rows)
    for attachment_record in attachment_records:
        attachment_text = _read_record_text(
            record=attachment_record,
            object_store=object_store,
            derived_bucket=derived_bucket,
        )
        document_units = _read_document_units(
            record=attachment_record,
            object_store=object_store,
            derived_bucket=derived_bucket,
        )
        attachment_context_text = _join_context_text(
            parent_text,
            attachment_text,
            _document_units_text_context(document_units),
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
                    parent_text=attachment_context_text,
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


def extract_notice_derived_transport_operational_notices(
    *,
    projection_entry: NoticeConsumptionProjectionEntry,
    registry: DocumentRegistry,
    object_store: NoticeDerivedTransportScheduleObjectStore,
    derived_bucket: str,
) -> tuple[NoticeDerivedTransportOperationalNotice, ...]:
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
        _extract_operational_notices_from_parent_text(
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
    operational_notices: list[NoticeDerivedTransportOperationalNotice] = []
    entries_by_notice: dict[str, NoticeConsumptionProjectionEntry] = {}
    rejection_reason_by_notice: dict[str, str] = {}
    for entry in projection_entries:
        if not _is_ready_transport_candidate(entry):
            continue
        entries_by_notice[entry.source_notice_id] = entry
        parent_record = _resolve_registry_record(
            registry=registry,
            document_id=entry.source_notice_document_id,
        )
        parent_text = _read_record_text(
            record=parent_record,
            object_store=object_store,
            derived_bucket=derived_bucket,
        )
        rejection_reason = _parent_text_rejection_reason(parent_text)
        if rejection_reason:
            rejection_reason_by_notice[entry.source_notice_id] = rejection_reason
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
        operational_notices.extend(
            extract_notice_derived_transport_operational_notices(
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
    operational_notices_by_notice: dict[str, list[NoticeDerivedTransportOperationalNotice]] = {}
    for notice in operational_notices:
        operational_notices_by_notice.setdefault(notice.source_notice_id, []).append(notice)
    rejected_sources = build_notice_derived_transport_rejected_sources(
        entries_by_notice=entries_by_notice,
        rows_by_notice=rows_by_notice,
        exceptions_by_notice=exceptions_by_notice,
        source_ref=_source_ref,
        schema_version=_REJECTED_SOURCE_SCHEMA_VERSION,
        reason_by_notice=rejection_reason_by_notice,
    )
    rejected_sources = [
        record
        for record in rejected_sources
        if record.get("source_notice_id") not in operational_notices_by_notice
        and record.get("reason") != "reservation_open_time_only"
    ]

    snapshots: list[dict[str, Any]] = []
    for notice_id, notice_rows in rows_by_notice.items():
        entry = entries_by_notice[notice_id]
        published_at = _published_at(entry)
        service_date_ranges = merge_service_date_ranges(
            row.service_date_ranges for row in notice_rows
        )
        snapshots.append(
            {
                "snapshot_id": _snapshot_id(
                    source_notice_id=notice_id,
                    published_at=published_at,
                ),
                "published_at": published_at,
                "effective_from": _start_of_day(min(row.effective_from for row in notice_rows)),
                "effective_until": _effective_until_for_ranges(service_date_ranges),
                "source_ref": notice_rows[0].source_ref,
                "is_current": False,
                "schedule_scope": notice_rows[0].schedule_scope,
                "service_date_ranges": [
                    {"start_date": start_date, "end_date": end_date}
                    for start_date, end_date in service_date_ranges
                ],
                "precedence": max(row.precedence for row in notice_rows),
            }
        )
    for notice_id, notice_exceptions in exceptions_by_notice.items():
        if notice_id in rows_by_notice:
            continue
        entry = entries_by_notice[notice_id]
        published_at = _published_at(entry)
        service_date_ranges = merge_service_date_ranges(
            exception.service_date_ranges for exception in notice_exceptions
        )
        snapshots.append(
            {
                "snapshot_id": _snapshot_id(
                    source_notice_id=notice_id,
                    published_at=published_at,
                ),
                "published_at": published_at,
                "effective_from": _start_of_day(
                    min(exception.effective_from for exception in notice_exceptions)
                ),
                "effective_until": _effective_until_for_ranges(service_date_ranges),
                "source_ref": notice_exceptions[0].source_ref,
                "is_current": False,
                "schedule_scope": notice_exceptions[0].schedule_scope,
                "service_date_ranges": [
                    {"start_date": start_date, "end_date": end_date}
                    for start_date, end_date in service_date_ranges
                ],
                "precedence": max(exception.precedence for exception in notice_exceptions),
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
    current_unbounded_notice_ids = {
        str(snapshot["source_ref"]).split(":")[-1]
        for snapshot in snapshots
        if bool(snapshot.get("is_current")) and not snapshot.get("service_date_ranges")
    }
    scheduled_departures = _build_scheduled_departures(
        rows=rows,
        snapshot_id_by_notice=snapshot_id_by_notice,
        current_unbounded_notice_ids=current_unbounded_notice_ids,
        anchor=anchor,
        service_horizon_days=service_horizon_days,
    )
    service_exceptions = _build_transport_service_exceptions(
        exceptions=exceptions,
        snapshot_id_by_notice=snapshot_id_by_notice,
    )
    operational_notice_records = _build_transport_operational_notice_records(
        operational_notices,
    )
    bundle = {
        "schema_version": TRANSPORT_SCHEDULE_PROJECTION_SCHEMA_VERSION,
        "service_status_records": [],
        "transport_schedule_snapshots": snapshots,
        "transport_routes": [route_payload(route) for route in TRANSPORT_ROUTES],
        "scheduled_departures": scheduled_departures,
        "transport_service_exceptions": service_exceptions,
        "transport_operational_notices": operational_notice_records,
        "transport_rejected_sources": rejected_sources,
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


def _parent_text_rejection_reason(parent_text: str) -> str:
    for segment in _BODY_TEXT_SPLIT_RE.split(str(parent_text or "")):
        if reservation_open_time_segment("".join(segment.split())):
            return "reservation_open_time_only"
    return ""


def _extract_operational_notices_from_parent_text(
    *,
    parent_text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
) -> list[NoticeDerivedTransportOperationalNotice]:
    notices: list[NoticeDerivedTransportOperationalNotice] = []
    for segment in _text_segments(parent_text):
        if _MARKDOWN_HEADING_RE.match(segment):
            continue
        notice_kind = _operational_notice_kind(segment)
        if not notice_kind:
            continue
        route_ids = _operational_notice_route_ids(segment)
        if not route_ids:
            continue
        effective_from = _start_of_day(
            _resolve_effective_date(
                text=segment,
                release_time=projection_entry.source_notice_release_time,
            )
        )
        notices.append(
            NoticeDerivedTransportOperationalNotice(
                source_notice_id=projection_entry.source_notice_id,
                source_ref=source_ref,
                notice_kind=notice_kind,
                route_ids=route_ids,
                effective_from=effective_from,
                effective_until="",
                operational_comment=_clean_cell(segment),
            )
        )
    return notices


def _operational_notice_kind(segment: str) -> str:
    compact = "".join(str(segment or "").split())
    if not compact:
        return ""
    if not any(keyword in compact for keyword in ("调整", "更改", "变更", "迁至", "改为")):
        return ""
    if any(
        keyword in compact
        for keyword in ("乘车点", "乘车地点", "发车地点", "候车点", "站点", "上车点", "下车点")
    ):
        return "boarding_point_change"
    return ""


def _operational_notice_route_ids(segment: str) -> tuple[str, ...]:
    route = _resolve_route(segment)
    if route is not None:
        return (route.route_id,)
    compact = "".join(str(segment or "").split())
    if "通勤" in compact and "丰台" in compact:
        return ("route:fengtai-to-haidian",)
    if "通勤" in compact and "海淀" in compact:
        return ("route:haidian-to-fengtai",)
    if "接驳" in compact or "地铁" in compact:
        return ("route:subway-shuttle",)
    return ()


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


def _document_units_text_context(units: Sequence[Mapping[str, Any]]) -> str:
    parts: list[str] = []
    for unit in units:
        for key in ("title", "clean_text", "text", "raw_text"):
            value = unit.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(_clean_cell(value))
    return _join_context_text(*parts)


def _join_context_text(*parts: str) -> str:
    return "\n".join(dict.fromkeys(part for part in parts if part.strip()))


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
    parent_service_date_ranges = _resolve_service_date_ranges(
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
        service_date_ranges = _resolve_table_row_service_date_ranges(
            row_text=row_text,
            parent_service_date_ranges=parent_service_date_ranges,
            release_time=projection_entry.source_notice_release_time,
        )
        schedule_scope = _resolve_schedule_scope(
            parent_text=parent_text,
            row_text=row_text,
            service_date_ranges=service_date_ranges,
        )
        weekday_scope = _resolve_weekday_scope(row_text, route.default_calendar)
        rider_type = _resolve_rider_type(row_text)
        effective_from = (
            service_date_ranges[0][0]
            if service_date_ranges
            else _resolve_effective_date(
                text=f"{parent_text}\n{row_text}",
                release_time=projection_entry.source_notice_release_time,
            )
        )
        remarks = _resolve_remarks(row)
        for departure_time in _extract_table_departure_times(row, row_text):
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


def _resolve_table_row_service_date_ranges(
    *,
    row_text: str,
    parent_service_date_ranges: tuple[tuple[str, str], ...],
    release_time: str | None,
) -> tuple[tuple[str, str], ...]:
    row_ranges = _resolve_service_date_ranges(text=row_text, release_time=release_time)
    if row_ranges:
        return row_ranges
    if _looks_like_open_ended_effective_date(row_text):
        return parent_service_date_ranges
    row_single_dates = _resolve_segment_service_date_ranges(
        text=row_text,
        release_time=release_time,
        allow_open_ended_effective_date=True,
    )
    return row_single_dates or parent_service_date_ranges


def _looks_like_open_ended_effective_date(row_text: str) -> bool:
    compact = "".join(str(row_text or "").split())
    return any(marker in compact for marker in ("日起", "日开始", "日执行", "日生效"))


def _extract_rows_from_parent_text(
    *,
    parent_text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
) -> list[NoticeDerivedTransportScheduleRow]:
    rows: list[NoticeDerivedTransportScheduleRow] = []
    for segment in _text_segments(parent_text):
        if reservation_open_time_segment(segment):
            continue
        if _contains_service_stop(segment):
            continue
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


def _extract_rows_from_body_schedule(
    *,
    parent_text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
) -> list[NoticeDerivedTransportScheduleRow]:
    extraction = extract_schedule_from_notice_body(
        ScheduleNoticeBody(
            notice_id=projection_entry.source_notice_id,
            notice_title=str(projection_entry.role_metadata.get("notice_title") or ""),
            release_time=projection_entry.source_notice_release_time,
            organization=str(projection_entry.role_metadata.get("organization_name") or ""),
            context_before=parent_text,
            context_after="",
        )
    )
    if extraction.status != "extracted":
        return []
    service_date_ranges = resolve_body_schedule_service_date_ranges(
        extraction_service_window=extraction.service_window,
        parent_text=parent_text,
        release_time=projection_entry.source_notice_release_time,
    )
    rows: list[NoticeDerivedTransportScheduleRow] = []
    for body_row in extraction.rows:
        row_text = body_schedule_row_text(body_row)
        route = _resolve_route(str(body_row.get("route_text") or row_text))
        if route is None:
            continue
        effective_from = (
            service_date_ranges[0][0]
            if service_date_ranges
            else _resolve_effective_date(
                text=f"{parent_text}\n{row_text}",
                release_time=projection_entry.source_notice_release_time,
            )
        )
        schedule_scope = _resolve_schedule_scope(
            parent_text=parent_text,
            row_text=row_text,
            service_date_ranges=service_date_ranges,
        )
        rows.append(
            NoticeDerivedTransportScheduleRow(
                source_notice_id=projection_entry.source_notice_id,
                source_ref=source_ref,
                source_attachment_document_id=projection_entry.source_notice_document_id,
                weekday_scope=_resolve_weekday_scope(
                    f"{parent_text}\n{row_text}", route.default_calendar
                ),
                route_direction=_route_direction(route.route_id),
                route_id=route.route_id,
                departure_time=str(body_row["departure_time"]),
                rider_type=_resolve_rider_type(f"{parent_text}\n{row_text}"),
                remarks=body_schedule_row_remarks(body_row),
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
        if _MARKDOWN_HEADING_RE.match(segment):
            continue
        for clause in _service_stop_clauses(segment):
            route = _resolve_route(clause)
            if route is None:
                continue
            service_date_ranges = _resolve_segment_service_date_ranges(
                text=clause,
                release_time=projection_entry.source_notice_release_time,
                allow_open_ended_effective_date=True,
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
                            operational_comment=_clean_cell(clause),
                            effective_from=start_date,
                            schedule_scope="exception_status",
                            service_date_ranges=((start_date, end_date),),
                            precedence=_schedule_scope_precedence("exception_status"),
                        )
                    )
    return exceptions


def _contains_service_stop(segment: str) -> bool:
    return any(keyword in segment for keyword in _SERVICE_STOP_KEYWORDS)


def _service_stop_clauses(segment: str) -> tuple[str, ...]:
    clauses: list[str] = []
    date_context = ""
    for raw_clause in re.split(r"[，,]", segment):
        clause = _clean_cell(raw_clause)
        if not clause:
            continue
        if _clause_contains_date(clause):
            date_context = clause
        if not _contains_service_stop(clause):
            continue
        if "正常运营" in clause or "正常运行" in clause:
            continue
        if not _clause_contains_date(clause) and date_context:
            clause = _clean_cell(f"{date_context} {clause}")
        clauses.append(clause)
    return tuple(clauses)


def _clause_contains_date(clause: str) -> bool:
    return bool(
        _FULL_DATE_RE.search(clause)
        or _YEARLESS_SINGLE_DATE_RE.search(clause)
        or _CHINESE_DATE_RANGE_RE.search(clause)
    )


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
