from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.notice_derived_transport_schedule_models import (
    NoticeDerivedTransportScheduleObjectStore,
)
from campus_ingestion_core.notice_derived_transport_schedule_parsing import _clean_cell
from campus_ingestion_core.registry import DocumentRegistry


def _is_ready_transport_candidate(entry: NoticeConsumptionProjectionEntry) -> bool:
    return (
        entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
        and str(entry.role_metadata.get("service_status_candidate_kind") or "")
        == "transport_schedule"
    )


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
        if record is None:
            record = _resolve_schedule_ocr_child_record(
                registry=registry,
                document_id=document_id,
            )
        if record is not None:
            records.append(record)
    return tuple(records)


def _resolve_schedule_ocr_child_record(
    *,
    registry: DocumentRegistry,
    document_id: str,
) -> DocumentRegistryRecord | None:
    if not document_id.startswith("notice_attachment:") or document_id.endswith(":schedule-ocr"):
        return None
    return _resolve_registry_record(registry=registry, document_id=f"{document_id}:schedule-ocr")


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
