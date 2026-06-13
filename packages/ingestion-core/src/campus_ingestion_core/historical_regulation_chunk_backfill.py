from __future__ import annotations

import hashlib
from collections import Counter, defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.internal_notice_institutional_regulation_chunk_prep import (
    prepare_institutional_regulation_chunks,
)
from campus_ingestion_core.internal_notice_scoped_rule_chunk_prep import (
    prepare_scoped_rule_chunks,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry import DocumentRegistry

HISTORICAL_REGULATION_CHUNK_BACKFILL_SCHEMA_VERSION = "historical_regulation_chunk_backfill.v1"
DEFAULT_HISTORICAL_REGULATION_CHUNK_BACKFILL_PHASE = "phase-00-chunk-only-boundary-and-inventory"
DOWNSTREAM_CONSUMPTION_ELIGIBLE_COLLECTIONS = frozenset({"institutional_rules"})


class HistoricalRegulationBackfillObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class HistoricalRegulationChunkPrepReport(Protocol):
    prepared_document_count: int
    total_unit_count: int
    total_chunk_count: int
    passed: bool
    manifest_path: str
    validation_summary_path: str
    document_reports_path: str


def build_historical_regulation_chunk_backfill_evidence(
    *,
    phase13_report: Mapping[str, Any],
    materialization_reports: Mapping[str, Mapping[str, Any]],
    registry: DocumentRegistry,
    object_store: HistoricalRegulationBackfillObjectStore,
    bucket_derived: str,
    preparation_run_id_prefix: str = "historical-regulation-chunk-backfill",
    generated_at: str | None = None,
) -> dict[str, Any]:
    runtime_generated_at = generated_at or datetime.now(UTC).isoformat()
    targets = _collect_targets(materialization_reports)
    preflight_records = [
        _build_preflight_record(
            target=target,
            registry=registry,
            object_store=object_store,
            bucket_derived=bucket_derived,
        )
        for target in targets
    ]
    classification_records = [_build_classification_record(record) for record in preflight_records]
    admitted_collections = tuple(
        sorted(
            {
                str(record["target_collection"])
                for record in classification_records
                if record["classification"] == "admit_to_chunk"
            }
        )
    )
    return {
        "target_inventory": _build_target_inventory(
            phase13_report=phase13_report,
            targets=targets,
            generated_at=runtime_generated_at,
        ),
        "classification_report": _build_classification_report(
            records=classification_records,
            generated_at=runtime_generated_at,
        ),
        "canonical_provenance_preflight": _build_canonical_provenance_preflight(
            records=preflight_records,
            generated_at=runtime_generated_at,
        ),
        "serving_closed_assertion": build_serving_closed_assertion(
            generated_at=runtime_generated_at
        ),
        "candidate_store_noop_assertion": build_candidate_store_noop_assertion(
            generated_at=runtime_generated_at
        ),
        "chunk_only_execution_plan_md": build_chunk_only_execution_plan_markdown(
            admitted_collections=admitted_collections,
            preparation_run_id_prefix=preparation_run_id_prefix,
        ),
    }


def prepare_historical_regulation_chunk_backfill_chunks(
    *,
    classification_report: Mapping[str, Any],
    canonical_preflight: Mapping[str, Any],
    registry: DocumentRegistry,
    object_store: HistoricalRegulationBackfillObjectStore,
    output_dir: Path,
    bucket_derived: str,
    preparation_run_id_prefix: str = "historical-regulation-chunk-backfill",
    generated_at: str | None = None,
    prepare_institutional_chunks: Callable[..., HistoricalRegulationChunkPrepReport] | None = None,
    prepare_scoped_chunks: Callable[..., HistoricalRegulationChunkPrepReport] | None = None,
) -> dict[str, Any]:
    runtime_generated_at = generated_at or datetime.now(UTC).isoformat()
    runtime_output_dir = Path(output_dir)
    target_records, blocked_targets = _resolve_chunk_preparation_records(
        classification_report=classification_report,
        canonical_preflight=canonical_preflight,
        registry=registry,
    )
    institutional_prepare = prepare_institutional_chunks or prepare_institutional_regulation_chunks
    scoped_prepare = prepare_scoped_chunks or prepare_scoped_rule_chunks
    collection_reports: list[dict[str, Any]] = []
    for collection, records, prepare in (
        (
            "institutional_rules",
            tuple(
                record for record in target_records if record.collection == "institutional_rules"
            ),
            institutional_prepare,
        ),
        (
            "scoped_rules",
            tuple(record for record in target_records if record.collection == "scoped_rules"),
            scoped_prepare,
        ),
    ):
        if not records:
            continue
        collection_output_dir = runtime_output_dir / collection
        report = prepare(
            records=records,
            object_store=object_store,
            output_dir=collection_output_dir,
            bucket_derived=bucket_derived,
        )
        collection_reports.append(
            _build_collection_chunk_report(
                collection=collection,
                preparation_run_id=f"{preparation_run_id_prefix}-{collection}",
                output_dir=collection_output_dir,
                records=records,
                report=report,
            )
        )
    return {
        "chunk_preparation_batch_report": _build_chunk_preparation_batch_report(
            generated_at=runtime_generated_at,
            output_dir=runtime_output_dir,
            target_records=target_records,
            blocked_targets=blocked_targets,
            collection_reports=collection_reports,
        ),
        "serving_closed_assertion": build_serving_closed_assertion(
            generated_at=runtime_generated_at
        ),
        "candidate_store_noop_assertion": build_candidate_store_noop_assertion(
            generated_at=runtime_generated_at
        ),
    }


def build_serving_closed_assertion(*, generated_at: str | None = None) -> dict[str, Any]:
    return {
        "schema_version": "historical-regulation-serving-closed-assertion.v1",
        "generated_at": generated_at or datetime.now(UTC).isoformat(),
        "query_serving_opened": False,
        "rag_release_opened": False,
        "candidate_enqueue_opened": False,
        "candidate_processor_opened": False,
        "release_admission_opened": False,
        "embedding_opened": False,
        "index_release_opened": False,
        "alias_publish_opened": False,
        "disallowed_operations": [
            "campus_ingestion_worker.enqueue_regulation_rag_release_candidates",
            "campus_ingestion_worker.process_regulation_rag_release_candidates",
            "campus_ingestion_worker.release_registry_scope",
            "campus_ingestion_worker.scope_alias",
        ],
    }


def build_candidate_store_noop_assertion(*, generated_at: str | None = None) -> dict[str, Any]:
    return {
        "schema_version": "historical-regulation-candidate-store-noop-assertion.v1",
        "generated_at": generated_at or datetime.now(UTC).isoformat(),
        "candidate_store_mutated": False,
        "candidate_store_rows_created": 0,
        "candidate_store_rows_updated": 0,
        "candidate_store_rows_deleted": 0,
        "force_reenqueue_opened": False,
    }


def build_chunk_only_execution_plan_markdown(
    *,
    admitted_collections: Sequence[str],
    preparation_run_id_prefix: str,
) -> str:
    lines = [
        "# Chunk-Only Execution Plan",
        "",
        "This plan is for historical stock regulation backfill only.",
        "",
        "Do not run candidate enqueue, candidate processor, release admission,",
        "embedding, index release, or alias publish commands.",
        "",
        "Use the historical target-limited worker. Do not run collection-wide",
        "registry scope preparation for this backfill.",
        "",
        "## Commands",
        "",
    ]
    if not admitted_collections:
        lines.extend(
            [
                "No collections are currently admitted to chunk preparation.",
                "",
            ]
        )
        return "\n".join(lines) + "\n"
    lines.extend(
        [
            "No active Python worker command is retained for this historical",
            "backfill. Rebuild this as an admitted ingestion-control task if",
            "the recovery need returns.",
            "",
            "## Admitted Collections",
            "",
        ]
    )
    for collection in admitted_collections:
        lines.append(f"- `{collection}`")
    return "\n".join(lines) + "\n"


def _resolve_chunk_preparation_records(
    *,
    classification_report: Mapping[str, Any],
    canonical_preflight: Mapping[str, Any],
    registry: DocumentRegistry,
) -> tuple[tuple[DocumentRegistryRecord, ...], tuple[dict[str, Any], ...]]:
    preflight_by_document_id = {
        str(record.get("target_document_id") or ""): record
        for record in _mapping_records(canonical_preflight)
        if str(record.get("target_document_id") or "").strip()
    }
    target_records: list[DocumentRegistryRecord] = []
    blocked_targets: list[dict[str, Any]] = []
    for target in _mapping_records(classification_report):
        if str(target.get("classification") or "") != "admit_to_chunk":
            continue
        target_document_id = str(target.get("target_document_id") or "").strip()
        target_collection = str(target.get("target_collection") or "").strip()
        if target_collection not in {"institutional_rules", "scoped_rules"}:
            blocked_targets.append(
                {
                    "target_document_id": target_document_id,
                    "target_collection": target_collection,
                    "reason": "unsupported_target_collection",
                }
            )
            continue
        preflight = preflight_by_document_id.get(target_document_id)
        if preflight is None or str(preflight.get("verdict") or "") != "passed":
            blocked_targets.append(
                {
                    "target_document_id": target_document_id,
                    "target_collection": target_collection,
                    "reason": "canonical_preflight_not_passed",
                }
            )
            continue
        record = registry.current_version(
            target_document_id,
            preferred_revision_tracks=("current-effective",),
        )
        issues = _chunk_record_issues(
            target_collection=target_collection,
            preflight=preflight,
            record=record,
        )
        if issues:
            blocked_targets.append(
                {
                    "target_document_id": target_document_id,
                    "target_collection": target_collection,
                    "reason": "registry_record_not_chunk_ready",
                    "issues": issues,
                }
            )
            continue
        assert record is not None
        target_records.append(record)
    deduped = {
        (record.collection, record.document_id, record.version_id): record
        for record in target_records
    }
    return (
        tuple(
            deduped[key] for key in sorted(deduped, key=lambda item: (item[0], item[1], item[2]))
        ),
        tuple(blocked_targets),
    )


def _mapping_records(payload: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    records = payload.get("records") or ()
    if not isinstance(records, Sequence) or isinstance(records, (str, bytes)):
        return ()
    return tuple(record for record in records if isinstance(record, Mapping))


def _chunk_record_issues(
    *,
    target_collection: str,
    preflight: Mapping[str, Any],
    record: DocumentRegistryRecord | None,
) -> list[str]:
    if record is None:
        return ["current_registry_record_missing"]
    issues: list[str] = []
    if record.corpus != "regulations":
        issues.append("registry_corpus_mismatch")
    if record.collection != target_collection:
        issues.append("registry_collection_mismatch")
    if record.status != "active":
        issues.append("registry_status_not_active")
    if not record.is_current:
        issues.append("registry_record_not_current")
    if record.revision_track != "current-effective":
        issues.append("registry_revision_track_not_current_effective")
    if preflight.get("version_id") and record.version_id != preflight["version_id"]:
        issues.append("registry_version_id_mismatch")
    if preflight.get("content_hash") and record.content_hash != preflight["content_hash"]:
        issues.append("registry_content_hash_mismatch")
    if (
        preflight.get("document_units_object_key")
        and record.document_units_object_key != preflight["document_units_object_key"]
    ):
        issues.append("registry_document_units_key_mismatch")
    if (
        preflight.get("canonical_markdown_object_key")
        and record.canonical_markdown_object_key != preflight["canonical_markdown_object_key"]
    ):
        issues.append("registry_canonical_markdown_key_mismatch")
    if not record.document_units_object_key:
        issues.append("document_units_key_missing")
    return issues


def _build_collection_chunk_report(
    *,
    collection: str,
    preparation_run_id: str,
    output_dir: Path,
    records: Sequence[DocumentRegistryRecord],
    report: HistoricalRegulationChunkPrepReport,
) -> dict[str, Any]:
    return {
        "target_collection": collection,
        "preparation_run_id": preparation_run_id,
        "output_dir": str(output_dir),
        "target_document_ids": [record.document_id for record in records],
        "prepared_document_count": int(report.prepared_document_count),
        "total_unit_count": int(report.total_unit_count),
        "total_chunk_count": int(report.total_chunk_count),
        "passed": bool(report.passed),
        "manifest_path": str(report.manifest_path),
        "validation_summary_path": str(report.validation_summary_path),
        "document_reports_path": str(report.document_reports_path),
    }


def _build_chunk_preparation_batch_report(
    *,
    generated_at: str,
    output_dir: Path,
    target_records: Sequence[DocumentRegistryRecord],
    blocked_targets: Sequence[Mapping[str, Any]],
    collection_reports: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    failed_collections = [
        str(report["target_collection"])
        for report in collection_reports
        if not bool(report.get("passed"))
    ]
    return {
        "schema_version": "historical-regulation-chunk-preparation-batch.v1",
        "generated_at": generated_at,
        "phase": "phase-04-chunk-preparation-batch",
        "output_dir": str(output_dir),
        "target_count": len(target_records),
        "blocked_target_count": len(blocked_targets),
        "blocked_targets": [dict(target) for target in blocked_targets],
        "document_site_eligible_count": sum(
            1
            for record in target_records
            if record.collection in DOWNSTREAM_CONSUMPTION_ELIGIBLE_COLLECTIONS
        ),
        "rag_consumption_eligible_count": sum(
            1
            for record in target_records
            if record.collection in DOWNSTREAM_CONSUMPTION_ELIGIBLE_COLLECTIONS
        ),
        "prepared_document_count": sum(
            int(report.get("prepared_document_count") or 0) for report in collection_reports
        ),
        "total_unit_count": sum(
            int(report.get("total_unit_count") or 0) for report in collection_reports
        ),
        "total_chunk_count": sum(
            int(report.get("total_chunk_count") or 0) for report in collection_reports
        ),
        "target_document_ids": [record.document_id for record in target_records],
        "collection_counts": dict(
            sorted(Counter(record.collection for record in target_records).items())
        ),
        "collections": [dict(report) for report in collection_reports],
        "failed_collections": failed_collections,
        "overall_verdict": (
            "passed" if not blocked_targets and not failed_collections else "failed"
        ),
    }


def _collect_targets(
    materialization_reports: Mapping[str, Mapping[str, Any]],
) -> tuple[dict[str, Any], ...]:
    targets: list[dict[str, Any]] = []
    for batch_id, report in sorted(materialization_reports.items()):
        documents = report.get("materialized_documents") or ()
        if not isinstance(documents, Sequence) or isinstance(documents, (str, bytes)):
            continue
        for raw in documents:
            if not isinstance(raw, Mapping):
                continue
            target = _target_from_materialized_document(batch_id=batch_id, raw=raw)
            if target is not None:
                targets.append(target)
    deduped: dict[tuple[str, str], dict[str, Any]] = {}
    for target in targets:
        deduped[(target["target_collection"], target["target_document_id"])] = target
    return tuple(deduped[key] for key in sorted(deduped, key=lambda item: (item[0], item[1])))


def _target_from_materialized_document(
    *,
    batch_id: str,
    raw: Mapping[str, Any],
) -> dict[str, Any] | None:
    target_collection = _text(raw.get("target_collection"))
    target_document_id = _text(raw.get("target_document_id"))
    if not target_collection or not target_document_id:
        return None
    quality = raw.get("normalization_quality")
    normalized_quality = dict(quality) if isinstance(quality, Mapping) else {}
    source_notice_ids = tuple(
        str(item).strip()
        for item in normalized_quality.get("source_notice_ids", ())
        if str(item).strip()
    )
    return {
        "batch_id": batch_id,
        "source_notice_ids": list(source_notice_ids),
        "target_collection": target_collection,
        "target_document_id": target_document_id,
        "version_id": _text(raw.get("version_id")),
        "content_hash": _text(raw.get("content_hash")),
        "canonical_markdown_object_key": _optional_text(raw.get("canonical_markdown_object_key")),
        "canonical_markdown_sha256": _optional_text(raw.get("canonical_markdown_sha256")),
        "document_units_object_key": _optional_text(raw.get("document_units_object_key")),
        "document_units_sha256": _optional_text(raw.get("document_units_sha256")),
        "cleaning_policy_version": _text(raw.get("cleaning_policy_version")),
        "normalizer_version": _text(raw.get("normalizer_version")),
        "normalization_quality": normalized_quality,
    }


def _build_preflight_record(
    *,
    target: Mapping[str, Any],
    registry: DocumentRegistry,
    object_store: HistoricalRegulationBackfillObjectStore,
    bucket_derived: str,
) -> dict[str, Any]:
    issues: list[str] = []
    target_document_id = str(target["target_document_id"])
    target_collection = str(target["target_collection"])
    quality = target.get("normalization_quality")
    quality_verdict = _text(quality.get("quality_verdict")) if isinstance(quality, Mapping) else ""
    if quality_verdict != "passed":
        issues.append("normalization_quality_not_passed")
    if not target.get("canonical_markdown_object_key"):
        issues.append("canonical_markdown_key_missing")
    if not target.get("document_units_object_key"):
        issues.append("document_units_key_missing")

    record = registry.current_version(
        target_document_id,
        preferred_revision_tracks=("current-effective",),
    )
    if record is None:
        issues.append("current_registry_record_missing")
    else:
        issues.extend(_registry_issues(target=target, record=record))
    issues.extend(
        _object_hash_issues(
            target=target,
            object_store=object_store,
            bucket_derived=bucket_derived,
        )
    )
    return {
        **target,
        "corpus": "regulations",
        "target_collection": target_collection,
        "current_registry_record": asdict(record) if record is not None else None,
        "issues": list(dict.fromkeys(issues)),
        "verdict": "passed" if not issues else "failed",
    }


def _registry_issues(
    *,
    target: Mapping[str, Any],
    record: DocumentRegistryRecord,
) -> list[str]:
    issues: list[str] = []
    if record.corpus != "regulations":
        issues.append("registry_corpus_mismatch")
    if record.collection != target["target_collection"]:
        issues.append("registry_collection_mismatch")
    if record.status != "active":
        issues.append("registry_status_not_active")
    if not record.is_current:
        issues.append("registry_record_not_current")
    if record.revision_track != "current-effective":
        issues.append("registry_revision_track_not_current_effective")
    if target.get("version_id") and record.version_id != target["version_id"]:
        issues.append("registry_version_id_mismatch")
    if target.get("content_hash") and record.content_hash != target["content_hash"]:
        issues.append("registry_content_hash_mismatch")
    if (
        target.get("cleaning_policy_version")
        and record.cleaning_policy_version != target["cleaning_policy_version"]
    ):
        issues.append("registry_cleaning_policy_mismatch")
    if (
        target.get("canonical_markdown_object_key")
        and record.canonical_markdown_object_key != target["canonical_markdown_object_key"]
    ):
        issues.append("registry_canonical_markdown_key_mismatch")
    if (
        target.get("document_units_object_key")
        and record.document_units_object_key != target["document_units_object_key"]
    ):
        issues.append("registry_document_units_key_mismatch")
    return issues


def _object_hash_issues(
    *,
    target: Mapping[str, Any],
    object_store: HistoricalRegulationBackfillObjectStore,
    bucket_derived: str,
) -> list[str]:
    issues: list[str] = []
    canonical_key = _optional_text(target.get("canonical_markdown_object_key"))
    canonical_sha256 = _optional_text(target.get("canonical_markdown_sha256"))
    if canonical_key and canonical_sha256:
        issues.extend(
            _sha256_issue(
                object_store=object_store,
                bucket=bucket_derived,
                key=canonical_key,
                expected_sha256=canonical_sha256,
                mismatch_issue="canonical_markdown_sha256_mismatch",
                missing_issue="canonical_markdown_object_missing",
            )
        )
    units_key = _optional_text(target.get("document_units_object_key"))
    units_sha256 = _optional_text(target.get("document_units_sha256"))
    if units_key and units_sha256:
        issues.extend(
            _sha256_issue(
                object_store=object_store,
                bucket=bucket_derived,
                key=units_key,
                expected_sha256=units_sha256,
                mismatch_issue="document_units_sha256_mismatch",
                missing_issue="document_units_object_missing",
            )
        )
    return issues


def _sha256_issue(
    *,
    object_store: HistoricalRegulationBackfillObjectStore,
    bucket: str,
    key: str,
    expected_sha256: str,
    mismatch_issue: str,
    missing_issue: str,
) -> list[str]:
    try:
        payload = object_store.get_bytes(bucket=bucket, key=key)
    except Exception:
        return [missing_issue]
    actual_sha256 = hashlib.sha256(payload).hexdigest()
    return [] if actual_sha256 == expected_sha256 else [mismatch_issue]


def _build_classification_record(record: Mapping[str, Any]) -> dict[str, Any]:
    issues = tuple(str(item) for item in record.get("issues", ()))
    if not issues:
        classification = "admit_to_chunk"
    elif "normalization_quality_not_passed" in issues:
        classification = "reject"
    else:
        classification = "needs_recovery"
    target_collection = str(record["target_collection"])
    downstream_eligible = (
        classification == "admit_to_chunk"
        and target_collection in DOWNSTREAM_CONSUMPTION_ELIGIBLE_COLLECTIONS
    )
    return {
        "source_notice_ids": list(record.get("source_notice_ids") or ()),
        "target_collection": target_collection,
        "target_document_id": record["target_document_id"],
        "classification": classification,
        "document_site_eligible": downstream_eligible,
        "rag_consumption_eligible": downstream_eligible,
        "downstream_consumption_status": (
            "eligible_after_release_gate"
            if downstream_eligible
            else "chunk_only_non_serving"
            if classification == "admit_to_chunk" and target_collection == "scoped_rules"
            else "not_ready_for_downstream_consumption"
        ),
        "reason_codes": list(issues or ("ready_for_chunk_preparation",)),
    }


def _build_target_inventory(
    *,
    phase13_report: Mapping[str, Any],
    targets: Sequence[Mapping[str, Any]],
    generated_at: str,
) -> dict[str, Any]:
    return {
        "schema_version": "historical-regulation-target-inventory.v1",
        "generated_at": generated_at,
        "source_phase": "phase-13-historical-regulation-canonical-backfill",
        "selected_notice_ids": list(phase13_report.get("selected_notice_ids") or ()),
        "target_count": len(targets),
        "collection_counts": dict(
            sorted(Counter(str(target["target_collection"]) for target in targets).items())
        ),
        "targets": [dict(target) for target in targets],
    }


def _build_classification_report(
    *,
    records: Sequence[Mapping[str, Any]],
    generated_at: str,
) -> dict[str, Any]:
    return {
        "schema_version": "historical-regulation-classification-report.v1",
        "generated_at": generated_at,
        "status_counts": dict(
            sorted(Counter(str(record["classification"]) for record in records).items())
        ),
        "collection_status_counts": dict(
            sorted(
                _collection_status_counts(records).items(),
                key=lambda item: item[0],
            )
        ),
        "downstream_eligible_counts": {
            "document_site": sum(
                1 for record in records if bool(record.get("document_site_eligible"))
            ),
            "rag_consumption": sum(
                1 for record in records if bool(record.get("rag_consumption_eligible"))
            ),
            **{
                collection: sum(
                    1
                    for record in records
                    if str(record.get("target_collection") or "") == collection
                    and bool(record.get("rag_consumption_eligible"))
                )
                for collection in sorted(
                    set(DOWNSTREAM_CONSUMPTION_ELIGIBLE_COLLECTIONS) | {"scoped_rules"}
                )
            },
        },
        "records": [dict(record) for record in records],
    }


def _build_canonical_provenance_preflight(
    *,
    records: Sequence[Mapping[str, Any]],
    generated_at: str,
) -> dict[str, Any]:
    failed = sum(1 for record in records if record["verdict"] != "passed")
    return {
        "schema_version": "historical-regulation-canonical-provenance-preflight.v1",
        "generated_at": generated_at,
        "overall_verdict": "passed" if failed == 0 else "failed",
        "passed_count": len(records) - failed,
        "failed_count": failed,
        "records": [dict(record) for record in records],
    }


def _collection_status_counts(records: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    counter: defaultdict[str, int] = defaultdict(int)
    for record in records:
        key = f"{record['target_collection']}:{record['classification']}"
        counter[key] += 1
    return dict(counter)


def _text(value: object) -> str:
    return str(value or "").strip()


def _optional_text(value: object) -> str | None:
    text = _text(value)
    return text or None


__all__ = [
    "DEFAULT_HISTORICAL_REGULATION_CHUNK_BACKFILL_PHASE",
    "HISTORICAL_REGULATION_CHUNK_BACKFILL_SCHEMA_VERSION",
    "build_candidate_store_noop_assertion",
    "build_chunk_only_execution_plan_markdown",
    "build_historical_regulation_chunk_backfill_evidence",
    "build_serving_closed_assertion",
    "prepare_historical_regulation_chunk_backfill_chunks",
]
