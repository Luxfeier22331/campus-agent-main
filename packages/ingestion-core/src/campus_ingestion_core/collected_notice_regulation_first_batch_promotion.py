from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.campusrag_ingestion_support import (
    collect_import_document_stats,
)
from campus_ingestion_core.collected_notice_regulation_first_batch_documents import (
    build_document_import_input,
)
from campus_ingestion_core.collected_notice_regulation_first_batch_evidence import (
    write_phase09_evidence_files,
)
from campus_ingestion_core.collected_notice_regulation_first_batch_helpers import (
    _blocked_counts,
    _document_source_refs,
    _flatten_stats_ids,
    _index_candidates_by_notice,
    _load_json_object,
    _mapping_rows,
    _materialized_source_notice_ids,
    _normalize_notice_ids,
    _owner_text_refs,
    _read_embedding_model_name,
    _required_text,
    _selection_entries,
    _selection_notice_ids,
    _selection_target_document_ids,
    _unique_object_refs,
)
from campus_ingestion_core.collected_notice_regulation_first_batch_provenance import (
    PROVENANCE_HARDENING_SCHEMA_VERSION,
    harden_first_batch_regulation_registry_provenance,
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
    phase_id: str = PHASE_09_ID,
) -> dict[str, Any]:
    return build_first_batch_regulation_selection(
        candidate_audit=_load_json_object(candidate_audit_path),
        consistency_report=_load_json_object(consistency_report_path),
        institutional_materialization=_load_json_object(institutional_materialization_path),
        scoped_materialization=_load_json_object(scoped_materialization_path),
        selected_notice_ids=selected_notice_ids,
        generated_at=generated_at,
        phase_id=phase_id,
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
    phase_id: str = PHASE_09_ID,
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
        "phase": phase_id,
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
    phase_id: str | None = None,
) -> dict[str, Any]:
    entries = _selection_entries(selection)
    selected_ids = tuple(str(entry["source_notice_id"]) for entry in entries)
    return {
        "schema_version": ADMISSION_PREFLIGHT_SCHEMA_VERSION,
        "generated_at": generated_at or utc_now(),
        "phase": phase_id or str(selection.get("phase") or PHASE_09_ID),
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
    phase_id: str | None = None,
    import_source: str = "collected_notice_regulation_first_batch_promotion",
    parser_version: str = _TARGET_PARSER_VERSION,
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    report_phase_id = phase_id or str(selection.get("phase") or PHASE_09_ID)
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
    if execute:
        _assert_selected_documents_quality(selected_documents)
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
            "phase": report_phase_id,
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
            build_document_import_input(
                document,
                promotion_phase_id=report_phase_id,
                import_source=import_source,
            )
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
            parser_version=parser_version,
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
        "phase": report_phase_id,
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
        "materialized_documents": _materialized_document_reports(
            documents=selected_documents,
            registry=registry,
            object_store=object_store,
            bucket_derived=settings.bucket_derived,
        ),
        "stats_by_collection": stats_by_collection,
        "target_scope_preflight_document_counts": preflight_counts,
        "target_scope_postflight_document_counts": postflight_counts,
        "source_to_target_trace": build_source_to_target_trace(
            selection=selection,
            generated_at=timestamp,
            phase_id=report_phase_id,
        ),
        "query_serving_opened": False,
        "rag_release_opened": False,
    }


def _assert_selected_documents_quality(documents: Sequence[Mapping[str, Any]]) -> None:
    failures: list[str] = []
    for document in documents:
        quality = document.get("normalization_quality")
        verdict = str(quality.get("quality_verdict") if isinstance(quality, Mapping) else "")
        if verdict != "passed":
            failures.append(
                f"{document.get('target_document_id')} normalization quality must be passed "
                f"(got {verdict or 'missing'})"
            )
    if failures:
        raise ValueError("; ".join(failures))


def _materialized_document_reports(
    *,
    documents: Sequence[Mapping[str, Any]],
    registry: DocumentRegistry,
    object_store: FirstBatchPromotionObjectStore,
    bucket_derived: str,
) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for document in documents:
        target_document_id = str(document.get("target_document_id") or "")
        record = registry.current_version(
            target_document_id,
            preferred_revision_tracks=("current-effective",),
        )
        if record is None:
            continue
        canonical_key = record.canonical_markdown_object_key
        document_units_key = record.document_units_object_key
        canonical_bytes = (
            object_store.get_bytes(bucket=bucket_derived, key=canonical_key)
            if canonical_key
            else b""
        )
        document_units_bytes = (
            object_store.get_bytes(bucket=bucket_derived, key=document_units_key)
            if document_units_key
            else b""
        )
        quality = document.get("normalization_quality")
        reports.append(
            {
                "target_document_id": record.document_id,
                "target_collection": record.collection,
                "version_id": record.version_id,
                "content_hash": record.content_hash,
                "cleaning_policy_version": record.cleaning_policy_version,
                "normalizer_version": _normalizer_version(quality),
                "normalization_quality": dict(quality) if isinstance(quality, Mapping) else {},
                "canonical_markdown_object_key": canonical_key,
                "canonical_markdown_sha256": hashlib.sha256(canonical_bytes).hexdigest()
                if canonical_bytes
                else "",
                "document_units_object_key": document_units_key,
                "document_units_sha256": hashlib.sha256(document_units_bytes).hexdigest()
                if document_units_bytes
                else "",
            }
        )
    return reports


def _normalizer_version(quality: object) -> str:
    if not isinstance(quality, Mapping):
        return ""
    return str(quality.get("normalizer_version") or "")


def build_source_to_target_trace(
    *,
    selection: Mapping[str, Any],
    generated_at: str | None = None,
    phase_id: str | None = None,
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
        "phase": phase_id or str(selection.get("phase") or PHASE_09_ID),
        "mode": "execute_trace",
        "write_enabled": False,
        "target": "regulation",
        "entry_count": len(entries),
        "entries": entries,
    }


def build_serving_closed_assertion(
    *,
    generated_at: str | None = None,
    phase_id: str = PHASE_09_ID,
) -> dict[str, Any]:
    return {
        "schema_version": SERVING_CLOSED_SCHEMA_VERSION,
        "generated_at": generated_at or utc_now(),
        "phase": phase_id,
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
