from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.campusrag_ingestion_sources import (
    build_source_observation,
    merge_equivalent_source_record,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry import DocumentRegistry

PHASE_09_ID = "phase-09-first-batch-regulation-promotion-write-gate"
PROVENANCE_HARDENING_SCHEMA_VERSION = (
    "collected_notice_regulation_first_batch_provenance_hardening.v1"
)


def harden_first_batch_regulation_registry_provenance(
    *,
    selection: Mapping[str, Any],
    registry: DocumentRegistry,
    execute: bool,
    generated_at: str | None = None,
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    updated_records: list[DocumentRegistryRecord] = []
    unchanged_target_document_ids: list[str] = []
    missing_target_document_ids: list[str] = []

    for entry in _selection_entries(selection):
        target_document_id = _required_text(entry.get("target_document_id"), "target_document_id")
        record = _latest_current_effective_record(registry, target_document_id)
        if record is None:
            missing_target_document_ids.append(target_document_id)
            continue
        source_channel = _entry_source_channel(entry)
        source_uri = _entry_source_uri(entry)
        if _record_primary_source_matches(
            record,
            source_channel=source_channel,
            source_uri=source_uri,
        ):
            unchanged_target_document_ids.append(target_document_id)
            continue
        candidate_observation = build_source_observation(
            source_channel=source_channel,
            source_uri=source_uri,
            raw_asset=record.raw_asset,
            is_primary=False,
            import_source="collected_notice_regulation_first_batch_promotion",
        )
        updated_record = merge_equivalent_source_record(
            existing=record,
            candidate_observation=candidate_observation,
            candidate_is_current=record.is_current,
            timestamp=timestamp,
        )
        if updated_record == record:
            unchanged_target_document_ids.append(target_document_id)
        else:
            updated_records.append(updated_record)

    if missing_target_document_ids:
        raise ValueError(
            "selected source registry records are missing: "
            + ", ".join(sorted(missing_target_document_ids))
        )
    if execute and updated_records:
        registry.upsert_many(tuple(updated_records))

    return {
        "schema_version": PROVENANCE_HARDENING_SCHEMA_VERSION,
        "generated_at": timestamp,
        "phase": PHASE_09_ID,
        "mode": "execute" if execute else "dry_run",
        "write_enabled": execute,
        "target": "regulation",
        "selected_target_document_ids": list(_selection_target_document_ids(selection)),
        "candidate_update_count": len(updated_records),
        "updated_record_count": len(updated_records) if execute else 0,
        "updated_target_document_ids": sorted(record.document_id for record in updated_records),
        "unchanged_target_document_ids": sorted(unchanged_target_document_ids),
    }


def _latest_current_effective_record(
    registry: DocumentRegistry,
    target_document_id: str,
) -> DocumentRegistryRecord | None:
    records = registry.latest_versions(target_document_id, revision_track="current-effective")
    if not records:
        return None
    current_records = [record for record in records if record.is_current]
    return current_records[0] if current_records else records[0]


def _entry_source_channel(entry: Mapping[str, Any]) -> str:
    source_scope = entry.get("source_scope")
    if isinstance(source_scope, Mapping):
        source_channel = str(source_scope.get("source_channel") or "").strip()
        if source_channel:
            return source_channel
    return "authenticated_notice_portal"


def _entry_source_uri(entry: Mapping[str, Any]) -> str:
    urls = [str(item).strip() for item in list(entry.get("source_urls") or ()) if str(item).strip()]
    if urls:
        return urls[0]
    notice_ids = [
        str(item).strip()
        for item in list(entry.get("source_notice_ids") or ())
        if str(item).strip()
    ]
    if notice_ids:
        return f"campusrag://authenticated_notice_portal/file-release/{notice_ids[0]}"
    return f"campusrag://regulation-promotion/{entry.get('target_document_id')}"


def _record_primary_source_matches(
    record: DocumentRegistryRecord,
    *,
    source_channel: str,
    source_uri: str,
) -> bool:
    if record.source_channel != source_channel or record.source_uri != source_uri:
        return False
    if not record.source_observations:
        return False
    return any(
        observation.is_primary
        and observation.source_channel == source_channel
        and observation.source_uri == source_uri
        for observation in record.source_observations
    )


def _selection_entries(selection: Mapping[str, Any]) -> tuple[dict[str, Any], ...]:
    return tuple(dict(item) for item in _mapping_rows(selection.get("entries")))


def _selection_target_document_ids(selection: Mapping[str, Any]) -> tuple[str, ...]:
    return tuple(str(entry["target_document_id"]) for entry in _selection_entries(selection))


def _mapping_rows(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _required_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required")
    return value.strip()


__all__ = [
    "PROVENANCE_HARDENING_SCHEMA_VERSION",
    "harden_first_batch_regulation_registry_provenance",
]
