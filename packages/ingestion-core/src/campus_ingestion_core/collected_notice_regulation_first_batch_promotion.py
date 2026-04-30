from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.campusrag_ingestion_sources import (
    build_source_observation,
    merge_equivalent_source_record,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    collect_import_document_stats,
)
from campus_ingestion_core.collected_notice_regulation_first_batch_documents import (
    build_document_import_input,
)
from campus_ingestion_core.collected_notice_regulation_first_batch_evidence import (
    write_phase09_evidence_files,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.settings import ObjectStoreSettings

PHASE_09_ID = "phase-09-first-batch-regulation-promotion-write-gate"
FIRST_BATCH_SELECTION_SCHEMA_VERSION = "collected_notice_regulation_first_batch_selection.v1"
ADMISSION_PREFLIGHT_SCHEMA_VERSION = (
    "collected_notice_regulation_first_batch_admission_preflight.v1"
)
MATERIALIZATION_EXECUTE_SCHEMA_VERSION = (
    "collected_notice_regulation_first_batch_materialization.v1"
)
SOURCE_TRACE_SCHEMA_VERSION = "collected_notice_regulation_first_batch_source_to_target_trace.v1"
SERVING_CLOSED_SCHEMA_VERSION = "collected_notice_regulation_first_batch_serving_closed.v1"
PROVENANCE_HARDENING_SCHEMA_VERSION = (
    "collected_notice_regulation_first_batch_provenance_hardening.v1"
)

DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS = ("594", "483", "485", "487", "493", "509", "564", "620")
INSTITUTIONAL_TARGET_COLLECTION = "institutional_rules"
SCOPED_TARGET_COLLECTION = "scoped_rules"
TARGET_COLLECTIONS = (INSTITUTIONAL_TARGET_COLLECTION, SCOPED_TARGET_COLLECTION)
TARGET_SCOPES = (
    ("regulations", INSTITUTIONAL_TARGET_COLLECTION),
    ("regulations", SCOPED_TARGET_COLLECTION),
)

_TARGET_PARSER_VERSION = "collected_notice_regulation_first_batch_promotion_v1"


class FirstBatchPromotionObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


def build_first_batch_regulation_selection_from_paths(
    *,
    candidate_audit_path: Path,
    consistency_report_path: Path,
    institutional_materialization_path: Path,
    scoped_materialization_path: Path,
    selected_notice_ids: Sequence[str] = DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS,
    generated_at: str | None = None,
) -> dict[str, Any]:
    return build_first_batch_regulation_selection(
        candidate_audit=_load_json_object(candidate_audit_path),
        consistency_report=_load_json_object(consistency_report_path),
        institutional_materialization=_load_json_object(institutional_materialization_path),
        scoped_materialization=_load_json_object(scoped_materialization_path),
        selected_notice_ids=selected_notice_ids,
        generated_at=generated_at,
        evidence_refs={
            "candidate_audit": str(candidate_audit_path),
            "consistency_report": str(consistency_report_path),
            "institutional_materialization": str(institutional_materialization_path),
            "scoped_materialization": str(scoped_materialization_path),
        },
    )


def build_first_batch_regulation_selection(
    *,
    candidate_audit: Mapping[str, Any],
    consistency_report: Mapping[str, Any],
    institutional_materialization: Mapping[str, Any],
    scoped_materialization: Mapping[str, Any],
    selected_notice_ids: Sequence[str] = DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS,
    generated_at: str | None = None,
    evidence_refs: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    selected_ids = _normalize_notice_ids(selected_notice_ids)
    if not selected_ids:
        raise ValueError("first-batch selected notice ids are required")
    _assert_consistency_report_allows_promotion(consistency_report)
    materialization_by_collection = _assert_materialization_reports_closed(
        institutional_materialization=institutional_materialization,
        scoped_materialization=scoped_materialization,
    )
    candidate_by_notice = _index_candidates_by_notice(candidate_audit)
    selected_entries = [
        _build_selection_entry(
            source_notice_id=source_notice_id,
            candidate=candidate_by_notice.get(source_notice_id),
            documents_by_collection=materialization_by_collection,
        )
        for source_notice_id in selected_ids
    ]
    materialized_notice_ids = _materialized_source_notice_ids(materialization_by_collection)
    if set(materialized_notice_ids) != set(selected_ids):
        raise ValueError(
            "materialization dry-run selected notice ids must exactly match first-batch "
            f"selection: materialized={materialized_notice_ids}, selected={selected_ids}"
        )
    counts_by_collection = Counter(str(entry["target_collection"]) for entry in selected_entries)
    blocked_counts = _blocked_counts(candidate_audit)
    return {
        "schema_version": FIRST_BATCH_SELECTION_SCHEMA_VERSION,
        "generated_at": timestamp,
        "phase": PHASE_09_ID,
        "mode": "admission_preflight",
        "write_enabled": False,
        "target": "regulation",
        "selected_notice_ids": list(selected_ids),
        "selected_count": len(selected_entries),
        "selected_counts_by_collection": dict(sorted(counts_by_collection.items())),
        "selected_target_document_ids": [
            str(entry["target_document_id"]) for entry in selected_entries
        ],
        "blocked_counts": blocked_counts,
        "entries": selected_entries,
        "evidence_refs": dict(evidence_refs or {}),
        "upstream_consistency": {
            "verdict": consistency_report.get("verdict"),
            "counts": dict(consistency_report.get("counts") or {}),
        },
        "query_serving_opened": False,
        "rag_release_opened": False,
        "scope_write_mode": "upsert_selected_preserve_unselected",
    }


def build_admission_preflight_report(
    *,
    selection: Mapping[str, Any],
    generated_at: str | None = None,
) -> dict[str, Any]:
    entries = _selection_entries(selection)
    selected_ids = tuple(str(entry["source_notice_id"]) for entry in entries)
    return {
        "schema_version": ADMISSION_PREFLIGHT_SCHEMA_VERSION,
        "generated_at": generated_at or utc_now(),
        "phase": PHASE_09_ID,
        "mode": "admission_preflight",
        "target": "regulation",
        "verdict": "passed",
        "write_enabled": False,
        "selected_notice_ids": list(selected_ids),
        "selected_count": len(selected_ids),
        "selected_target_document_ids": [str(entry["target_document_id"]) for entry in entries],
        "checked_invariants": [
            "selected_ids_exact_match",
            "selected_candidates_downstream_admitted",
            "selected_candidates_owner_text_ready",
            "normalization_consistency_passed",
            "query_serving_closed",
            "rag_release_closed",
        ],
        "query_serving_opened": False,
        "rag_release_opened": False,
    }


def materialize_first_batch_regulation_selection(
    *,
    selection: Mapping[str, Any],
    institutional_materialization: Mapping[str, Any],
    scoped_materialization: Mapping[str, Any],
    registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    object_store: FirstBatchPromotionObjectStore,
    execute: bool,
    env: Mapping[str, str],
    generated_at: str | None = None,
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    materialization_by_collection = _assert_materialization_reports_closed(
        institutional_materialization=institutional_materialization,
        scoped_materialization=scoped_materialization,
    )
    _assert_selection_matches_materialization(
        selection=selection,
        documents_by_collection=materialization_by_collection,
    )
    selected_documents = _selected_documents_from_selection(
        selection=selection,
        documents_by_collection=materialization_by_collection,
    )
    readable_ref_count = _assert_source_refs_readable(
        documents=selected_documents,
        object_store=object_store,
    )
    _assert_no_unexpected_target_collisions(
        selection=selection,
        registry=registry,
        object_store=object_store,
        bucket_derived=ObjectStoreSettings.from_env(dict(env)).bucket_derived,
    )
    preflight_counts = _target_scope_counts(registry)
    if not execute:
        return {
            "schema_version": MATERIALIZATION_EXECUTE_SCHEMA_VERSION,
            "generated_at": timestamp,
            "phase": PHASE_09_ID,
            "mode": "dry_run",
            "write_enabled": False,
            "target": "regulation",
            "selected_notice_ids": list(_selection_notice_ids(selection)),
            "selected_target_document_ids": list(_selection_target_document_ids(selection)),
            "readable_source_ref_count": readable_ref_count,
            "materialized_document_count": 0,
            "created_document_ids": [],
            "updated_document_ids": [],
            "skipped_document_ids": [],
            "target_scope_preflight_document_counts": preflight_counts,
            "target_scope_postflight_document_counts": preflight_counts,
            "query_serving_opened": False,
            "rag_release_opened": False,
        }

    settings = ObjectStoreSettings.from_env(dict(env))
    stats_by_collection: dict[str, dict[str, Any]] = {}
    for collection in TARGET_COLLECTIONS:
        documents = [
            build_document_import_input(document)
            for document in selected_documents
            if str(document.get("target_collection") or "") == collection
        ]
        selected_target_ids = tuple(str(document.metadata["document_id"]) for document in documents)
        runtime_profile = load_runtime_profile("regulations", collection)
        stats = collect_import_document_stats(
            documents=documents,
            registry=registry,
            raw_asset_registry=raw_asset_registry,
            writer=object_store,
            object_store=settings,
            parser_version=_TARGET_PARSER_VERSION,
            embedding_model=_read_embedding_model_name(env),
            cleaning_policy_version=runtime_profile.cleaning_policy_version,
            default_visibility_scope=None,
            scope_refresh=("regulations", collection),
            scope_refresh_preserve_existing=(
                lambda record, selected=set(selected_target_ids): record.document_id not in selected
            ),
        )
        stats_by_collection[collection] = asdict(stats)
    postflight_counts = _target_scope_counts(registry)
    created_ids = _flatten_stats_ids(stats_by_collection, "created_document_ids")
    updated_ids = _flatten_stats_ids(stats_by_collection, "updated_document_ids")
    skipped_ids = _flatten_stats_ids(stats_by_collection, "skipped_document_ids")
    errors = [
        error for stats in stats_by_collection.values() for error in list(stats.get("errors") or ())
    ]
    if errors:
        raise ValueError("first-batch materialization failed: " + "; ".join(errors))
    return {
        "schema_version": MATERIALIZATION_EXECUTE_SCHEMA_VERSION,
        "generated_at": timestamp,
        "phase": PHASE_09_ID,
        "mode": "execute",
        "write_enabled": True,
        "target": "regulation",
        "selected_notice_ids": list(_selection_notice_ids(selection)),
        "selected_target_document_ids": list(_selection_target_document_ids(selection)),
        "readable_source_ref_count": readable_ref_count,
        "materialized_document_count": len(created_ids) + len(updated_ids) + len(skipped_ids),
        "created_document_ids": created_ids,
        "updated_document_ids": updated_ids,
        "skipped_document_ids": skipped_ids,
        "stats_by_collection": stats_by_collection,
        "target_scope_preflight_document_counts": preflight_counts,
        "target_scope_postflight_document_counts": postflight_counts,
        "source_to_target_trace": build_source_to_target_trace(
            selection=selection,
            generated_at=timestamp,
        ),
        "query_serving_opened": False,
        "rag_release_opened": False,
    }


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
            "selected target registry records are missing: "
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


def build_source_to_target_trace(
    *,
    selection: Mapping[str, Any],
    generated_at: str | None = None,
) -> dict[str, Any]:
    entries = [
        {
            "source_notice_id": entry["source_notice_id"],
            "source_document_ids": list(entry.get("source_document_ids") or ()),
            "target_collection": entry["target_collection"],
            "target_surface": entry["target_surface"],
            "target_document_id": entry["target_document_id"],
            "title": entry["title"],
        }
        for entry in _selection_entries(selection)
    ]
    return {
        "schema_version": SOURCE_TRACE_SCHEMA_VERSION,
        "generated_at": generated_at or utc_now(),
        "phase": PHASE_09_ID,
        "mode": "execute_trace",
        "write_enabled": False,
        "target": "regulation",
        "entry_count": len(entries),
        "entries": entries,
    }


def build_serving_closed_assertion(*, generated_at: str | None = None) -> dict[str, Any]:
    return {
        "schema_version": SERVING_CLOSED_SCHEMA_VERSION,
        "generated_at": generated_at or utc_now(),
        "phase": PHASE_09_ID,
        "query_serving_opened": False,
        "rag_release_opened": False,
        "qdrant_alias_opened": False,
        "public_chat_citation_opened": False,
    }


def _assert_consistency_report_allows_promotion(report: Mapping[str, Any]) -> None:
    if str(report.get("mode") or "") != "dry_run":
        raise ValueError("consistency report mode must be dry_run")
    if report.get("write_enabled") is not False:
        raise ValueError("consistency report must prove write_enabled=false")
    if str(report.get("verdict") or "") != "passed":
        raise ValueError("consistency report verdict must be passed")
    counts = report.get("counts")
    if not isinstance(counts, Mapping):
        raise ValueError("consistency report counts are required")
    for key in (
        "duplicate_target_document_id_count",
        "normalization_failed_document_count",
        "normalization_flagged_document_count",
    ):
        if int(counts.get(key) or 0) != 0:
            raise ValueError(f"consistency report must have {key}=0")


def _assert_materialization_reports_closed(
    *,
    institutional_materialization: Mapping[str, Any],
    scoped_materialization: Mapping[str, Any],
) -> dict[str, tuple[dict[str, Any], ...]]:
    reports = {
        INSTITUTIONAL_TARGET_COLLECTION: institutional_materialization,
        SCOPED_TARGET_COLLECTION: scoped_materialization,
    }
    grouped: dict[str, tuple[dict[str, Any], ...]] = {}
    for collection, report in reports.items():
        _assert_materialization_report_closed(report=report, expected_collection=collection)
        grouped[collection] = tuple(
            dict(document) for document in _mapping_rows(report.get("documents"))
        )
    return grouped


def _assert_materialization_report_closed(
    *,
    report: Mapping[str, Any],
    expected_collection: str,
) -> None:
    if str(report.get("mode") or "") != "dry_run":
        raise ValueError(f"{expected_collection} materialization report mode must be dry_run")
    if report.get("write_enabled") is not False:
        raise ValueError(f"{expected_collection} materialization report must be no-write")
    if report.get("current_promotion_enabled") is not False:
        raise ValueError(f"{expected_collection} current promotion must stay disabled")
    if report.get("release_publish_enabled") is not False:
        raise ValueError(f"{expected_collection} release publish must stay closed")
    if report.get("query_serving_enabled") is not False:
        raise ValueError(f"{expected_collection} query serving must stay closed")
    if str(report.get("target_collection") or "") != expected_collection:
        raise ValueError(f"{expected_collection} materialization report collection mismatch")
    documents = tuple(_mapping_rows(report.get("documents")))
    if int(report.get("document_count") or 0) != len(documents):
        raise ValueError(f"{expected_collection} materialization document_count mismatch")
    for document in documents:
        boundary = document.get("no_write_boundary")
        if isinstance(boundary, Mapping):
            if boundary.get("release_publish_enabled") is not False:
                raise ValueError(f"{expected_collection} release publish must stay closed")
            if boundary.get("query_serving_enabled") is not False:
                raise ValueError(f"{expected_collection} query serving must stay closed")


def _build_selection_entry(
    *,
    source_notice_id: str,
    candidate: Mapping[str, Any] | None,
    documents_by_collection: Mapping[str, Sequence[Mapping[str, Any]]],
) -> dict[str, Any]:
    if candidate is None:
        raise ValueError(
            f"selected source_notice_id {source_notice_id} missing from candidate audit"
        )
    if str(candidate.get("consumption_class") or "") != "downstream_admitted":
        raise ValueError(f"selected {source_notice_id} must be downstream_admitted")
    if str(candidate.get("owner_text_status") or "") != "ready":
        raise ValueError(f"selected {source_notice_id} must have owner_text_status=ready")
    regulation_class = str(candidate.get("regulation_admission_class") or "")
    if regulation_class in {"needs_multimodal", "manual_review"}:
        raise ValueError(f"selected {source_notice_id} cannot be {regulation_class}")
    target_collection = str(candidate.get("target_collection") or "")
    if target_collection not in TARGET_COLLECTIONS:
        raise ValueError(f"selected {source_notice_id} target_collection is not supported")
    matches = [
        document
        for document in documents_by_collection[target_collection]
        if source_notice_id in {str(item) for item in document.get("source_notice_ids") or ()}
    ]
    if len(matches) != 1:
        raise ValueError(
            f"selected {source_notice_id} must map to exactly one dry-run target document"
        )
    document = matches[0]
    target_document_id = _required_text(document.get("target_document_id"), "target_document_id")
    target_identity_preview = str(candidate.get("target_identity_preview") or "")
    if target_identity_preview and target_identity_preview != target_document_id:
        raise ValueError(f"selected {source_notice_id} target identity mismatch")
    return {
        "source_notice_id": source_notice_id,
        "source_document_ids": [
            str(item) for item in document.get("source_document_ids") or () if str(item)
        ],
        "target_collection": target_collection,
        "target_surface": f"regulations/{target_collection}",
        "target_document_id": target_document_id,
        "target_identity_preview": target_identity_preview or target_document_id,
        "title": _required_text(document.get("title"), "title"),
        "issuing_org": str(document.get("issuing_org") or candidate.get("issuing_org") or ""),
        "owner_text_status": str(candidate.get("owner_text_status") or ""),
        "regulation_admission_class": regulation_class,
        "source_object_refs": list(document.get("source_object_refs") or ()),
        "owner_text_refs": _owner_text_refs(document),
        "source_urls": list(document.get("source_urls") or ()),
        "source_scope": dict(document.get("source_scope") or {}),
    }


def _assert_selection_matches_materialization(
    *,
    selection: Mapping[str, Any],
    documents_by_collection: Mapping[str, Sequence[Mapping[str, Any]]],
) -> None:
    selected_ids = set(_selection_notice_ids(selection))
    materialized_ids = set(_materialized_source_notice_ids(documents_by_collection))
    if selected_ids != materialized_ids:
        raise ValueError(
            "selection notice ids must match materialization documents: "
            f"selection={sorted(selected_ids)}, materialization={sorted(materialized_ids)}"
        )
    selected_target_ids = set(_selection_target_document_ids(selection))
    materialized_target_ids = {
        str(document.get("target_document_id") or "")
        for documents in documents_by_collection.values()
        for document in documents
    }
    if selected_target_ids != materialized_target_ids:
        raise ValueError(
            "selection target document ids must match materialization documents: "
            f"selection={sorted(selected_target_ids)}, materialization={sorted(materialized_target_ids)}"
        )


def _selected_documents_from_selection(
    *,
    selection: Mapping[str, Any],
    documents_by_collection: Mapping[str, Sequence[Mapping[str, Any]]],
) -> tuple[dict[str, Any], ...]:
    selected_target_ids = set(_selection_target_document_ids(selection))
    documents = [
        dict(document)
        for collection_docs in documents_by_collection.values()
        for document in collection_docs
        if str(document.get("target_document_id") or "") in selected_target_ids
    ]
    return tuple(
        sorted(
            documents,
            key=lambda document: (
                str(document.get("target_collection") or ""),
                str(document.get("target_document_id") or ""),
            ),
        )
    )


def _assert_source_refs_readable(
    *,
    documents: Sequence[Mapping[str, Any]],
    object_store: FirstBatchPromotionObjectStore,
) -> int:
    refs = _unique_object_refs(
        ref for document in documents for ref in _document_source_refs(document)
    )
    for ref in refs:
        object_store.get_bytes(
            bucket=_required_text(ref.get("bucket"), "source_ref.bucket"),
            key=_required_text(ref.get("key"), "source_ref.key"),
        )
    return len(refs)


def _assert_no_unexpected_target_collisions(
    *,
    selection: Mapping[str, Any],
    registry: DocumentRegistry,
    object_store: FirstBatchPromotionObjectStore,
    bucket_derived: str,
) -> None:
    allowed_by_target = {
        str(entry["target_document_id"]): {
            "notice_ids": {str(entry["source_notice_id"])},
            "document_ids": {str(item) for item in entry.get("source_document_ids") or ()},
        }
        for entry in _selection_entries(selection)
    }
    for corpus, collection in TARGET_SCOPES:
        for record in registry.list_by_scope(corpus, collection):
            allowed = allowed_by_target.get(record.document_id)
            if allowed is None:
                continue
            provenance = _load_existing_record_provenance(
                record=record,
                object_store=object_store,
                bucket_derived=bucket_derived,
            )
            if not (
                allowed["notice_ids"].intersection(provenance["notice_ids"])
                or allowed["document_ids"].intersection(provenance["document_ids"])
            ):
                raise ValueError(
                    "unexpected existing target collision for selected target document id: "
                    f"{record.document_id}"
                )


def _target_scope_counts(registry: DocumentRegistry) -> dict[str, int]:
    return {
        f"{corpus}/{collection}": len(registry.list_by_scope(corpus, collection))
        for corpus, collection in TARGET_SCOPES
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


def _load_existing_record_provenance(
    *,
    record: DocumentRegistryRecord,
    object_store: FirstBatchPromotionObjectStore,
    bucket_derived: str,
) -> dict[str, set[str]]:
    notice_ids: set[str] = set()
    document_ids: set[str] = set()
    _collect_ids_from_text(record.source_uri, notice_ids=notice_ids, document_ids=document_ids)
    for observation in record.source_observations:
        _collect_ids_from_text(
            observation.source_uri,
            notice_ids=notice_ids,
            document_ids=document_ids,
        )
    if not record.document_units_object_key:
        return {"notice_ids": notice_ids, "document_ids": document_ids}
    try:
        payload = object_store.get_bytes(
            bucket=bucket_derived,
            key=record.document_units_object_key,
        )
    except Exception:
        return {"notice_ids": notice_ids, "document_ids": document_ids}
    for line in payload.decode("utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, Mapping):
            continue
        metadata = row.get("metadata")
        if isinstance(metadata, Mapping):
            notice_ids.update(str(item) for item in metadata.get("source_notice_ids") or ())
            document_ids.update(str(item) for item in metadata.get("source_document_ids") or ())
            for key in (
                "source_notice_document_id",
                "semantic_owner_document_id",
                "source_attachment_document_id",
            ):
                value = str(metadata.get(key) or "")
                if value:
                    document_ids.add(value)
    return {"notice_ids": notice_ids, "document_ids": document_ids}


def _collect_ids_from_text(
    value: str,
    *,
    notice_ids: set[str],
    document_ids: set[str],
) -> None:
    if not value:
        return
    for match in re.finditer(r"(?<![A-Za-z0-9])([0-9]{3,8})(?![A-Za-z0-9])", value):
        notice_ids.add(match.group(1))
    if "file-release:" in value or "notice:" in value:
        document_ids.add(value)


def _document_source_refs(document: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    refs: list[Mapping[str, Any]] = []
    refs.extend(ref for ref in _mapping_rows(document.get("source_object_refs")))
    refs.extend(_owner_text_refs(document))
    return refs


def _owner_text_refs(document: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    recovery = document.get("owner_text_recovery")
    if not isinstance(recovery, Mapping):
        return []
    written_refs = recovery.get("written_refs")
    if not isinstance(written_refs, Mapping):
        return []
    return [dict(ref) for ref in written_refs.values() if isinstance(ref, Mapping)]


def _unique_object_refs(refs: Sequence[Mapping[str, Any]]) -> tuple[Mapping[str, Any], ...]:
    by_key: dict[tuple[str, str], Mapping[str, Any]] = {}
    for ref in refs:
        bucket = str(ref.get("bucket") or "").strip()
        key = str(ref.get("key") or "").strip()
        if bucket and key:
            by_key[(bucket, key)] = ref
    return tuple(by_key[key] for key in sorted(by_key))


def _materialized_source_notice_ids(
    documents_by_collection: Mapping[str, Sequence[Mapping[str, Any]]],
) -> tuple[str, ...]:
    return _normalize_notice_ids(
        str(source_notice_id)
        for documents in documents_by_collection.values()
        for document in documents
        for source_notice_id in document.get("source_notice_ids") or ()
    )


def _selection_notice_ids(selection: Mapping[str, Any]) -> tuple[str, ...]:
    return tuple(str(entry["source_notice_id"]) for entry in _selection_entries(selection))


def _selection_target_document_ids(selection: Mapping[str, Any]) -> tuple[str, ...]:
    return tuple(str(entry["target_document_id"]) for entry in _selection_entries(selection))


def _selection_entries(selection: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    return tuple(_mapping_rows(selection.get("entries")))


def _index_candidates_by_notice(candidate_audit: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    rows = tuple(_mapping_rows(candidate_audit.get("candidates")))
    indexed = {
        str(row.get("source_notice_id") or "").strip(): row
        for row in rows
        if str(row.get("source_notice_id") or "").strip()
    }
    if len(indexed) != len(rows):
        raise ValueError("candidate audit contains duplicate or missing source_notice_id")
    return indexed


def _blocked_counts(candidate_audit: Mapping[str, Any]) -> dict[str, int]:
    counts = Counter(
        str(row.get("regulation_admission_class") or row.get("consumption_class") or "")
        for row in _mapping_rows(candidate_audit.get("candidates"))
    )
    return {
        key: counts.get(key, 0)
        for key in ("manual_review", "needs_multimodal")
        if counts.get(key, 0)
    }


def _mapping_rows(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _normalize_notice_ids(values: Sequence[str] | Any) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


def _flatten_stats_ids(stats_by_collection: Mapping[str, Mapping[str, Any]], key: str) -> list[str]:
    return sorted(
        {
            str(item)
            for stats in stats_by_collection.values()
            for item in list(stats.get(key) or ())
            if str(item)
        }
    )


def _required_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required")
    return value.strip()


def _read_embedding_model_name(env: Mapping[str, str]) -> str:
    return (
        str(env.get("EMBEDDING_MODEL") or env.get("INGESTION_EMBEDDING_MODEL") or "").strip()
        or "Qwen3-Embedding-4B"
    )


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


__all__ = [
    "ADMISSION_PREFLIGHT_SCHEMA_VERSION",
    "DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS",
    "FIRST_BATCH_SELECTION_SCHEMA_VERSION",
    "MATERIALIZATION_EXECUTE_SCHEMA_VERSION",
    "PHASE_09_ID",
    "PROVENANCE_HARDENING_SCHEMA_VERSION",
    "SERVING_CLOSED_SCHEMA_VERSION",
    "SOURCE_TRACE_SCHEMA_VERSION",
    "build_admission_preflight_report",
    "build_first_batch_regulation_selection",
    "build_first_batch_regulation_selection_from_paths",
    "build_serving_closed_assertion",
    "build_source_to_target_trace",
    "harden_first_batch_regulation_registry_provenance",
    "materialize_first_batch_regulation_selection",
    "write_phase09_evidence_files",
]
