from __future__ import annotations

from typing import Any

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.notice_derived_service_status_models import (
    NoticeDerivedServiceStatusObjectStore,
)
from campus_ingestion_core.registry import DocumentRegistry


def _is_ready_service_status_candidate(entry: NoticeConsumptionProjectionEntry) -> bool:
    return (
        entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
    )


def _resolve_registry_record(
    *,
    registry: DocumentRegistry,
    document_id: str,
) -> DocumentRegistryRecord:
    current = registry.current_version(
        document_id,
        preferred_revision_tracks=("source-faithful", "semantic-enriched"),
    )
    if current is not None:
        return current
    latest = registry.latest_versions(document_id)
    if latest:
        return latest[0]
    raise ValueError(f"document registry record not found: {document_id}")


def _read_record_text(
    *,
    record: DocumentRegistryRecord,
    object_store: NoticeDerivedServiceStatusObjectStore,
    derived_bucket: str,
) -> str:
    key = str(record.canonical_markdown_object_key or "").strip()
    if not key:
        return ""
    return object_store.get_bytes(bucket=derived_bucket, key=key).decode("utf-8")


def _rejected_source(entry: NoticeConsumptionProjectionEntry) -> dict[str, Any]:
    metadata = dict(entry.role_metadata or {})
    return {
        "schema_version": "service_status_rejected_sources.v1",
        "source_notice_id": entry.source_notice_id,
        "source_ref": _source_ref(entry),
        "notice_family": str(metadata.get("notice_family") or "").strip(),
        "candidate_kind": str(
            metadata.get("service_status_candidate_kind") or "service_status"
        ).strip(),
        "reason": "missing_effective_window_or_status_signal",
        "missing_fields": ["effective_window_or_status_signal"],
        "extracted_signals": {
            "notice_title": str(metadata.get("notice_title") or "").strip(),
        },
    }


def _source_ref(entry: NoticeConsumptionProjectionEntry) -> str:
    return f"notice:muc_internal_portal:{entry.source_notice_id}"
