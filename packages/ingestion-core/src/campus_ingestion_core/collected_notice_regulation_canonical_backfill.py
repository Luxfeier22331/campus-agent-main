from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_regulation_first_batch_promotion import (
    DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS,
    build_admission_preflight_report,
    build_first_batch_regulation_selection,
    build_serving_closed_assertion,
    build_source_to_target_trace,
    materialize_first_batch_regulation_selection,
)
from campus_ingestion_core.collected_notice_regulation_manual_review_admission import (
    build_manual_review_regulation_admission,
)
from campus_ingestion_core.collected_notice_regulation_materialization_preview import (
    build_collected_notice_regulation_materialization_preview,
)
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry

PHASE_13_ID = "phase-13-historical-regulation-canonical-backfill"
CANONICAL_BACKFILL_SCHEMA_VERSION = "collected_notice_regulation_canonical_backfill.v1"
DEFAULT_MANUAL_REVIEW_RESOLUTIONS: Mapping[str, object] = {
    "481": "scoped_rules",
    "619": "institutional_rules",
}

_GENERATED_BY = "campus_ingestion_core.collected_notice_regulation_canonical_backfill"
_IMPORT_SOURCE = "collected_notice_regulation_canonical_backfill"
_PARSER_VERSION = "collected_notice_regulation_canonical_backfill_v1"


class CollectedNoticeRegulationCanonicalBackfillObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class CollectedNoticeRegulationCanonicalBackfillRequest:
    first_batch_candidate_audit: Mapping[str, Any]
    first_batch_admission_manifest: Mapping[str, Any]
    manual_review_candidate_audit: Mapping[str, Any] | None = None
    manual_review_owner_text_execution_report: Mapping[str, Any] | None = None
    manual_review_resolutions: Mapping[str, object] = field(
        default_factory=lambda: dict(DEFAULT_MANUAL_REVIEW_RESOLUTIONS)
    )
    first_batch_notice_ids: tuple[str, ...] = DEFAULT_FIRST_BATCH_SELECTED_NOTICE_IDS
    execute: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "first_batch_notice_ids",
            _normalize_notice_ids(self.first_batch_notice_ids),
        )
        object.__setattr__(
            self,
            "manual_review_resolutions",
            {
                str(notice_id).strip(): value
                for notice_id, value in self.manual_review_resolutions.items()
                if str(notice_id).strip()
            },
        )


def backfill_collected_notice_regulation_canonical(
    *,
    request: CollectedNoticeRegulationCanonicalBackfillRequest,
    env: Mapping[str, str],
    object_store: CollectedNoticeRegulationCanonicalBackfillObjectStore,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    generated_at: str | None = None,
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    artifacts: dict[str, dict[str, Any]] = {}
    batch_reports: list[dict[str, Any]] = []

    if request.first_batch_notice_ids:
        first_batch = _build_and_materialize_first_batch(
            candidate_audit=request.first_batch_candidate_audit,
            admission_manifest=request.first_batch_admission_manifest,
            notice_ids=request.first_batch_notice_ids,
            env=env,
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            execute=request.execute,
            generated_at=timestamp,
        )
        artifacts["first_batch"] = first_batch
        batch_reports.append(_batch_summary(batch_id="first_batch", artifacts=first_batch))

    if request.manual_review_resolutions:
        if request.manual_review_candidate_audit is None:
            raise ValueError("manual_review_candidate_audit is required when resolutions are set")
        if request.manual_review_owner_text_execution_report is None:
            raise ValueError(
                "manual_review_owner_text_execution_report is required when resolutions are set"
            )
        manual_review = _build_and_materialize_manual_review(
            candidate_audit=request.manual_review_candidate_audit,
            source_admission_manifest=request.first_batch_admission_manifest,
            owner_text_execution_report=request.manual_review_owner_text_execution_report,
            resolutions=request.manual_review_resolutions,
            env=env,
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            execute=request.execute,
            generated_at=timestamp,
        )
        artifacts["manual_review"] = manual_review
        batch_reports.append(_batch_summary(batch_id="manual_review", artifacts=manual_review))

    selected_notice_ids = sorted(
        {notice_id for report in batch_reports for notice_id in report["selected_notice_ids"]}
    )
    selected_target_document_ids = sorted(
        {
            target_document_id
            for report in batch_reports
            for target_document_id in report["selected_target_document_ids"]
        }
    )
    quality_rows = [
        row
        for batch in artifacts.values()
        for row in _mapping_rows(batch["normalization_quality_report"].get("documents"))
    ]
    failed_or_flagged = [
        row for row in quality_rows if str(row.get("quality_verdict") or "") != "passed"
    ]
    return {
        "schema_version": CANONICAL_BACKFILL_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": _GENERATED_BY,
        "phase": PHASE_13_ID,
        "mode": "execute" if request.execute else "dry_run",
        "write_enabled": bool(request.execute),
        "target": "regulation",
        "selected_notice_ids": selected_notice_ids,
        "selected_target_document_ids": selected_target_document_ids,
        "materialized_document_count": sum(
            int(report["materialized_document_count"]) for report in batch_reports
        ),
        "normalization_quality": {
            "verdict": "passed" if not failed_or_flagged else "failed",
            "document_count": len(quality_rows),
            "failed_or_flagged_document_count": len(failed_or_flagged),
        },
        "query_serving_opened": False,
        "rag_release_opened": False,
        "batches": batch_reports,
        "artifacts": artifacts,
    }


def _build_and_materialize_first_batch(
    *,
    candidate_audit: Mapping[str, Any],
    admission_manifest: Mapping[str, Any],
    notice_ids: Sequence[str],
    env: Mapping[str, str],
    object_store: CollectedNoticeRegulationCanonicalBackfillObjectStore,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    execute: bool,
    generated_at: str,
) -> dict[str, Any]:
    filtered_manifest = _filter_admission_manifest(
        admission_manifest=admission_manifest,
        notice_ids=notice_ids,
    )
    preview = build_collected_notice_regulation_materialization_preview(
        admission_manifest=filtered_manifest,
        object_store=object_store,
        generated_at=generated_at,
        phase_id=PHASE_13_ID,
        generated_by=_GENERATED_BY,
        evidence_refs={"source_batch": "first_batch"},
    )
    selection = build_first_batch_regulation_selection(
        candidate_audit=candidate_audit,
        consistency_report=preview.consistency_report,
        institutional_materialization=preview.institutional_rules_materialization,
        scoped_materialization=preview.scoped_rules_materialization,
        selected_notice_ids=notice_ids,
        generated_at=generated_at,
        phase_id=PHASE_13_ID,
    )
    return _materialize_backfill_batch(
        selection=selection,
        institutional_materialization=preview.institutional_rules_materialization,
        scoped_materialization=preview.scoped_rules_materialization,
        normalization_quality_report=preview.normalization_quality_report,
        consistency_report=preview.consistency_report,
        source_preview_trace=preview.source_to_target_trace,
        env=env,
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        execute=execute,
        generated_at=generated_at,
    )


def _build_and_materialize_manual_review(
    *,
    candidate_audit: Mapping[str, Any],
    source_admission_manifest: Mapping[str, Any],
    owner_text_execution_report: Mapping[str, Any],
    resolutions: Mapping[str, object],
    env: Mapping[str, str],
    object_store: CollectedNoticeRegulationCanonicalBackfillObjectStore,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    execute: bool,
    generated_at: str,
) -> dict[str, Any]:
    admission = build_manual_review_regulation_admission(
        candidate_audit=_enrich_manual_review_candidate_audit(
            candidate_audit=candidate_audit,
            source_admission_manifest=source_admission_manifest,
        ),
        owner_text_execution_report=owner_text_execution_report,
        resolutions=resolutions,
        generated_at=generated_at,
        generated_by=_GENERATED_BY,
        evidence_refs={"source_batch": "manual_review"},
    )
    preview = build_collected_notice_regulation_materialization_preview(
        admission_manifest=admission["admission_manifest"],
        object_store=object_store,
        generated_at=generated_at,
        phase_id=PHASE_13_ID,
        generated_by=_GENERATED_BY,
        evidence_refs={"source_batch": "manual_review"},
    )
    selection = build_first_batch_regulation_selection(
        candidate_audit=admission["candidate_audit"],
        consistency_report=preview.consistency_report,
        institutional_materialization=preview.institutional_rules_materialization,
        scoped_materialization=preview.scoped_rules_materialization,
        selected_notice_ids=tuple(resolutions),
        generated_at=generated_at,
        phase_id=PHASE_13_ID,
    )
    artifacts = _materialize_backfill_batch(
        selection=selection,
        institutional_materialization=preview.institutional_rules_materialization,
        scoped_materialization=preview.scoped_rules_materialization,
        normalization_quality_report=preview.normalization_quality_report,
        consistency_report=preview.consistency_report,
        source_preview_trace=preview.source_to_target_trace,
        env=env,
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        execute=execute,
        generated_at=generated_at,
    )
    artifacts["manual_review_resolution_report"] = admission["resolution_report"]
    artifacts["manual_review_resolved_admission_manifest"] = admission["admission_manifest"]
    artifacts["manual_review_resolved_candidate_audit"] = admission["candidate_audit"]
    return artifacts


def _enrich_manual_review_candidate_audit(
    *,
    candidate_audit: Mapping[str, Any],
    source_admission_manifest: Mapping[str, Any],
) -> dict[str, Any]:
    admission_by_notice = {
        str(entry.get("source_notice_id") or "").strip(): entry
        for entry in _mapping_rows(source_admission_manifest.get("entries"))
        if str(entry.get("source_notice_id") or "").strip()
    }
    if not admission_by_notice:
        return dict(candidate_audit)
    enriched = dict(candidate_audit)
    candidates: list[dict[str, Any]] = []
    for row in _mapping_rows(candidate_audit.get("candidates")):
        candidate = dict(row)
        source_notice_id = str(candidate.get("source_notice_id") or "").strip()
        admission_entry = admission_by_notice.get(source_notice_id)
        if admission_entry is not None:
            for field_name in (
                "source_notice_release_time",
                "notice_release_time",
                "published_at",
                "published_date",
                "body_excerpt",
            ):
                if (
                    not str(candidate.get(field_name) or "").strip()
                    and str(admission_entry.get(field_name) or "").strip()
                ):
                    candidate[field_name] = admission_entry.get(field_name)
        candidates.append(candidate)
    enriched["candidates"] = candidates
    return enriched


def _materialize_backfill_batch(
    *,
    selection: Mapping[str, Any],
    institutional_materialization: Mapping[str, Any],
    scoped_materialization: Mapping[str, Any],
    normalization_quality_report: Mapping[str, Any],
    consistency_report: Mapping[str, Any],
    source_preview_trace: Mapping[str, Any],
    env: Mapping[str, str],
    object_store: CollectedNoticeRegulationCanonicalBackfillObjectStore,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    execute: bool,
    generated_at: str,
) -> dict[str, Any]:
    admission_preflight = build_admission_preflight_report(
        selection=selection,
        generated_at=generated_at,
        phase_id=PHASE_13_ID,
    )
    materialization_report = materialize_first_batch_regulation_selection(
        selection=selection,
        institutional_materialization=institutional_materialization,
        scoped_materialization=scoped_materialization,
        registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        object_store=object_store,
        execute=execute,
        env=env,
        generated_at=generated_at,
        phase_id=PHASE_13_ID,
        import_source=_IMPORT_SOURCE,
        parser_version=_PARSER_VERSION,
    )
    source_to_target_trace = build_source_to_target_trace(
        selection=selection,
        generated_at=generated_at,
        phase_id=PHASE_13_ID,
    )
    return {
        "selection": dict(selection),
        "admission_preflight_report": admission_preflight,
        "institutional_materialization": dict(institutional_materialization),
        "scoped_materialization": dict(scoped_materialization),
        "normalization_quality_report": dict(normalization_quality_report),
        "consistency_report": dict(consistency_report),
        "source_preview_trace": dict(source_preview_trace),
        "materialization_report": materialization_report,
        "source_to_target_trace": source_to_target_trace,
        "serving_closed_assertion": build_serving_closed_assertion(
            generated_at=generated_at,
            phase_id=PHASE_13_ID,
        ),
    }


def _filter_admission_manifest(
    *,
    admission_manifest: Mapping[str, Any],
    notice_ids: Sequence[str],
) -> dict[str, Any]:
    selected_ids = set(_normalize_notice_ids(notice_ids))
    entries = [
        dict(entry)
        for entry in _mapping_rows(admission_manifest.get("entries"))
        if str(entry.get("source_notice_id") or "").strip() in selected_ids
    ]
    found_ids = {str(entry.get("source_notice_id") or "") for entry in entries}
    missing_ids = sorted(selected_ids - found_ids)
    if missing_ids:
        raise ValueError(
            "first-batch admission manifest is missing selected notice ids: "
            + ", ".join(missing_ids)
        )
    filtered = dict(admission_manifest)
    filtered["entries"] = sorted(
        entries, key=lambda entry: str(entry.get("source_notice_id") or "")
    )
    filtered["source_scope"] = {
        **dict(filtered.get("source_scope") or {}),
        "source_notice_ids": sorted(selected_ids),
        "historical_canonical_backfill": True,
    }
    filtered["evidence_refs"] = {
        **dict(filtered.get("evidence_refs") or {}),
        "backfill_phase": PHASE_13_ID,
    }
    return filtered


def _batch_summary(*, batch_id: str, artifacts: Mapping[str, Any]) -> dict[str, Any]:
    materialization = artifacts["materialization_report"]
    quality = artifacts["normalization_quality_report"]
    return {
        "batch_id": batch_id,
        "phase": PHASE_13_ID,
        "mode": materialization["mode"],
        "write_enabled": materialization["write_enabled"],
        "selected_notice_ids": list(materialization["selected_notice_ids"]),
        "selected_target_document_ids": list(materialization["selected_target_document_ids"]),
        "materialized_document_count": materialization["materialized_document_count"],
        "normalization_quality_verdict": quality.get("verdict"),
        "normalization_quality_document_count": quality.get("document_count"),
        "query_serving_opened": False,
        "rag_release_opened": False,
    }


def _normalize_notice_ids(values: Sequence[str] | Any) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


def _mapping_rows(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return []
    return [item for item in value if isinstance(item, Mapping)]


__all__ = [
    "CANONICAL_BACKFILL_SCHEMA_VERSION",
    "DEFAULT_MANUAL_REVIEW_RESOLUTIONS",
    "PHASE_13_ID",
    "CollectedNoticeRegulationCanonicalBackfillRequest",
    "backfill_collected_notice_regulation_canonical",
]
