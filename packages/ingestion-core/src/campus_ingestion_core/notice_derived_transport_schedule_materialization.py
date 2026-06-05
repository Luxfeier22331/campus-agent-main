from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from campus_ingestion_core.notice_consumption_projection import NoticeConsumptionProjectionEntry
from campus_ingestion_core.notice_derived_transport_schedule_body_materialization import (
    dedupe_transport_schedule_rows,
)
from campus_ingestion_core.notice_derived_transport_schedule_constants import (
    _BODY_TEXT_SPLIT_RE,
    _REJECTED_SOURCE_SCHEMA_VERSION,
)
from campus_ingestion_core.notice_derived_transport_schedule_models import (
    NoticeDerivedTransportOperationalNotice,
    NoticeDerivedTransportScheduleObjectStore,
    NoticeDerivedTransportScheduleRow,
    NoticeDerivedTransportServiceException,
)
from campus_ingestion_core.notice_derived_transport_schedule_operational import (
    _extract_operational_notices_from_parent_text,
)
from campus_ingestion_core.notice_derived_transport_schedule_parsing import (
    _clean_cell,
    _coerce_int,
    _effective_until_for_ranges,
    _extract_times,
    _parse_datetime,
    _published_at,
    _resolve_route,
    _snapshot_id,
    _source_ref,
    _start_of_day,
)
from campus_ingestion_core.notice_derived_transport_schedule_records import (
    _build_scheduled_departures,
    _build_transport_operational_notice_records,
    _build_transport_service_exceptions,
)
from campus_ingestion_core.notice_derived_transport_schedule_rows import (
    _extract_exceptions_from_parent_text,
    _extract_rows_from_body_schedule,
    _extract_rows_from_parent_text,
    _extract_rows_from_table_matrix,
)
from campus_ingestion_core.notice_derived_transport_schedule_sources import (
    _document_units_text_context,
    _is_ready_transport_candidate,
    _join_context_text,
    _read_document_units,
    _read_record_text,
    _resolve_attachment_records,
    _resolve_registry_record,
)
from campus_ingestion_core.notice_derived_transport_schedule_support import (
    build_notice_derived_transport_rejected_sources,
    merge_service_date_ranges,
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
    validate_transport_schedule_projection_bundle,
)
from campus_ingestion_core.transport_schedule_projection_routes import (
    TRANSPORT_ROUTES,
    route_payload,
)


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


def _parent_text_rejection_reason(parent_text: str) -> str:
    for segment in _BODY_TEXT_SPLIT_RE.split(str(parent_text or "")):
        if reservation_open_time_segment("".join(segment.split())):
            return "reservation_open_time_only"
    return ""


__all__ = [
    "NoticeDerivedTransportOperationalNotice",
    "NoticeDerivedTransportScheduleObjectStore",
    "NoticeDerivedTransportScheduleRow",
    "NoticeDerivedTransportServiceException",
    "_extract_rows_from_body_schedule",
    "_extract_rows_from_table_matrix",
    "build_notice_derived_transport_schedule_projection_bundle",
    "extract_notice_derived_transport_operational_notices",
    "extract_notice_derived_transport_schedule_rows",
    "extract_notice_derived_transport_service_exceptions",
]
