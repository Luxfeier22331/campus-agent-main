from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_fact_readiness import (
    TARGET_ADMISSION_NEEDS_MULTIMODAL,
    build_service_status_fact_readiness,
    fact_readiness_entry_fields,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.notice_derived_service_status_materialization import (
    extract_notice_derived_service_status_record,
)

PHASE_06_SERVICE_STATUS_ID = "phase-06-batched-downstream-replay"
ADMISSION_SCHEMA_VERSION = "collected_notice_consumer_admission.v1"
REPLAY_DRY_RUN_SCHEMA_VERSION = "collected_notice_downstream_replay_dry_run.v1"
STAGE_REPORT_SCHEMA_VERSION = "collected_notice_downstream_stage_report.v1"
CONSISTENCY_REPORT_SCHEMA_VERSION = "collected_notice_downstream_consistency_report.v1"
TRACE_SCHEMA_VERSION = "collected_notice_downstream_trace.v1"
REJECTED_DEFERRED_SCHEMA_VERSION = "collected_notice_rejected_deferred_sources.v1"
SERVICE_STATUS_TARGET = "service_status"
_PREVIEW_DERIVED_BUCKET = "campus-rag-derived-preview"
_SHANGHAI_TZ = timezone(timedelta(hours=8))


@dataclass(frozen=True, slots=True)
class CollectedNoticeServiceStatusReplayPreview:
    admission_manifest: dict[str, Any]
    replay_dry_run: dict[str, Any]
    stage_report: dict[str, Any]
    consistency_report: dict[str, Any]
    source_to_searchable_downstream_trace: dict[str, Any]
    rejected_deferred_source_report: dict[str, Any]


@dataclass(frozen=True, slots=True)
class _ServiceStatusDecision:
    unit: Mapping[str, Any]
    admitted: bool
    reason_codes: list[str]
    record: dict[str, Any] | None
    fact_readiness: dict[str, Any]


class _PreviewDocumentRegistry:
    def __init__(self, records: Sequence[DocumentRegistryRecord]) -> None:
        self._records = {record.document_id: record for record in records}

    def current_version(
        self,
        document_id: str,
        preferred_revision_tracks: Sequence[str] = (),
    ) -> DocumentRegistryRecord | None:
        return self._records.get(document_id)

    def latest_versions(self, document_id: str) -> list[DocumentRegistryRecord]:
        record = self._records.get(document_id)
        return [record] if record is not None else []


class _PreviewObjectStore:
    def __init__(self, objects: Mapping[tuple[str, str], bytes]) -> None:
        self._objects = dict(objects)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self._objects[(bucket, key)]


def build_service_status_batch_preview_from_paths(
    *,
    searchable_notice_preview_path: Path,
    multimodal_candidate_inventory_path: Path,
    generated_at: str | None = None,
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_service_status_downstream",
) -> CollectedNoticeServiceStatusReplayPreview:
    return build_service_status_batch_preview(
        searchable_notice_preview=_load_json_object(searchable_notice_preview_path),
        multimodal_candidate_inventory=_load_json_object(multimodal_candidate_inventory_path),
        generated_at=generated_at,
        generated_by=generated_by,
    )


def build_service_status_batch_preview(
    *,
    searchable_notice_preview: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    generated_at: str | None = None,
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_service_status_downstream",
) -> CollectedNoticeServiceStatusReplayPreview:
    timestamp = generated_at or utc_now()
    units = _select_service_status_units(searchable_notice_preview)
    registry, object_store = _preview_registry_and_store(units)
    decisions = [
        _service_status_decision(
            unit=unit,
            multimodal_candidate_inventory=multimodal_candidate_inventory,
            registry=registry,
            object_store=object_store,
            generated_at=timestamp,
        )
        for unit in units
    ]
    admission_manifest = _admission_manifest(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    replay_dry_run = _replay_dry_run(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    stage_report = _stage_report(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    rejected_deferred = _rejected_deferred_source_report(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    consistency_report = _consistency_report(
        decisions=decisions,
        stage_report=stage_report,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    trace = _trace_report(
        decisions=decisions,
        stage_report=stage_report,
        consistency_report=consistency_report,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    return CollectedNoticeServiceStatusReplayPreview(
        admission_manifest=admission_manifest,
        replay_dry_run=replay_dry_run,
        stage_report=stage_report,
        consistency_report=consistency_report,
        source_to_searchable_downstream_trace=trace,
        rejected_deferred_source_report=rejected_deferred,
    )


def preview_to_output_files(
    preview: CollectedNoticeServiceStatusReplayPreview,
) -> dict[str, dict[str, Any]]:
    return {
        "consumer-admission-manifest.json": preview.admission_manifest,
        "replay.dry-run.json": preview.replay_dry_run,
        "stage-report.json": preview.stage_report,
        "consistency-report.json": preview.consistency_report,
        "source-to-searchable-downstream-trace.json": (
            preview.source_to_searchable_downstream_trace
        ),
        "rejected-deferred-source-report.json": preview.rejected_deferred_source_report,
    }


def _select_service_status_units(
    searchable_notice_preview: Mapping[str, Any],
) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in searchable_notice_preview.get("units") or ()
        if isinstance(row, Mapping) and SERVICE_STATUS_TARGET in _target_candidates(row)
    ]


def _target_candidates(unit: Mapping[str, Any]) -> list[str]:
    target_hints = unit.get("target_hints")
    if isinstance(target_hints, Mapping):
        raw = target_hints.get("candidate_targets")
        if isinstance(raw, Sequence) and not isinstance(raw, str):
            return list(dict.fromkeys(str(item).strip() for item in raw if str(item).strip()))
    classification = unit.get("classification")
    if isinstance(classification, Mapping):
        raw = classification.get("target_candidates")
        if isinstance(raw, Sequence) and not isinstance(raw, str):
            return list(dict.fromkeys(str(item).strip() for item in raw if str(item).strip()))
    return []


def _service_status_decision(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    registry: _PreviewDocumentRegistry,
    object_store: _PreviewObjectStore,
    generated_at: str,
) -> _ServiceStatusDecision:
    reason_codes = _precondition_rejection_reason_codes(unit=unit)
    if reason_codes:
        fact_readiness = build_service_status_fact_readiness(
            unit=unit,
            multimodal_candidate_inventory=multimodal_candidate_inventory,
            text_record_ready=False,
        )
        return _ServiceStatusDecision(
            unit=unit,
            admitted=False,
            reason_codes=reason_codes,
            record=None,
            fact_readiness=fact_readiness,
        )
    candidate = extract_notice_derived_service_status_record(
        projection_entry=_projection_entry(unit),
        registry=registry,
        object_store=object_store,
        derived_bucket=_PREVIEW_DERIVED_BUCKET,
        generated_at=generated_at,
    )
    fact_readiness = build_service_status_fact_readiness(
        unit=unit,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        text_record_ready=candidate is not None,
    )
    if candidate is None:
        reason_codes = (
            list(fact_readiness["reason_codes"])
            if fact_readiness["target_admission_state"] == TARGET_ADMISSION_NEEDS_MULTIMODAL
            else ["missing_effective_window_or_status_signal"]
        )
        return _ServiceStatusDecision(
            unit=unit,
            admitted=False,
            reason_codes=reason_codes,
            record=None,
            fact_readiness=fact_readiness,
        )
    record = candidate.to_record()
    if not _record_effective_at(record, generated_at):
        return _ServiceStatusDecision(
            unit=unit,
            admitted=False,
            reason_codes=["not_current_effective_at_generated_time"],
            record=record,
            fact_readiness=fact_readiness,
        )
    return _ServiceStatusDecision(
        unit=unit,
        admitted=True,
        reason_codes=list(
            dict.fromkeys(
                [
                    "service_status_current_window_admitted",
                    *(fact_readiness.get("reason_codes") or ()),
                ]
            )
        ),
        record=record,
        fact_readiness=fact_readiness,
    )


def _precondition_rejection_reason_codes(
    *,
    unit: Mapping[str, Any],
) -> list[str]:
    reasons: list[str] = []
    if SERVICE_STATUS_TARGET not in _target_candidates(unit):
        reasons.append("target_hint_not_service_status")
    if not unit.get("source_object_refs"):
        reasons.append("missing_source_object_refs")
    if not str(unit.get("body_text") or "").strip():
        reasons.append("missing_body_text")
    return reasons


def _projection_entry(unit: Mapping[str, Any]) -> NoticeConsumptionProjectionEntry:
    classification = dict(unit.get("classification") or {})
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus=str(unit.get("source_corpus") or "campus_notices"),
        source_collection=str(unit.get("source_collection") or "internal_notice"),
        source_notice_id=str(unit.get("source_notice_id") or ""),
        unit_id=str(unit.get("unit_id") or ""),
        primary_role=NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id=str(unit.get("source_document_id") or ""),
        source_document_id=str(unit.get("source_document_id") or ""),
        source_notice_release_time=str(unit.get("published_at") or ""),
        role_metadata={
            "notice_title": str(unit.get("title") or ""),
            "organization_name": _organization_name(unit),
            "notice_family": str(classification.get("notice_family") or ""),
            "service_status_candidate_kind": SERVICE_STATUS_TARGET,
        },
        updated_at=str(unit.get("updated_at") or ""),
    )


def _admission_manifest(
    *,
    decisions: Sequence[_ServiceStatusDecision],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    entries = [_admission_entry(decision) for decision in decisions]
    return {
        "schema_version": ADMISSION_SCHEMA_VERSION,
        "batch_id": "phase6-batch-service-status",
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_06_SERVICE_STATUS_ID,
        "selection_scope": "target_batch",
        "source_scope": {
            "source_notice_ids": [decision.unit.get("source_notice_id") for decision in decisions],
            "target": SERVICE_STATUS_TARGET,
        },
        "baseline": "captured_but_not_imported",
        "selection_policy": {
            "name": "phase6-service-status-target-batch",
            "version": "v1",
        },
        "entries": entries,
        "counts": {
            "entry_count": len(entries),
            "downstream_admitted": sum(
                1 for entry in entries if entry["consumption_class"] == "downstream_admitted"
            ),
            "needs_multimodal": sum(
                1 for entry in entries if entry["consumption_class"] == "needs_multimodal"
            ),
            "defer": sum(1 for entry in entries if entry["consumption_class"] == "defer"),
            "search_only": sum(
                1 for entry in entries if entry["consumption_class"] == "search_only"
            ),
        },
        "evidence_refs": {
            "searchable_preview": (
                "evidence/phase-04-dry-run-reimport-and-universal-search-preview/"
                "searchable-notice-preview.json"
            ),
            "multimodal_inventory": (
                "evidence/phase-05-multimodal-ocr-consumption-readiness/"
                "multimodal-candidate-inventory.json"
            ),
        },
    }


def _admission_entry(decision: _ServiceStatusDecision) -> dict[str, Any]:
    unit = decision.unit
    admitted = decision.admitted
    return {
        "entry_id": f"notice:{unit.get('site_id')}:{unit.get('source_notice_id')}",
        "source_channel": unit.get("source_channel"),
        "source_surface": unit.get("source_surface"),
        "source_corpus": unit.get("source_corpus"),
        "source_collection": unit.get("source_collection"),
        "site_id": unit.get("site_id"),
        "source_notice_id": unit.get("source_notice_id"),
        "source_document_id": unit.get("source_document_id"),
        "title": unit.get("title"),
        "published_at": unit.get("published_at"),
        "body_excerpt": unit.get("body_excerpt"),
        "source_url": unit.get("source_url"),
        "run_id": dict(unit.get("run_provenance") or {}).get("run_id", ""),
        "source_object_refs": list(unit.get("source_object_refs") or ()),
        "consumption_class": "downstream_admitted" if admitted else _blocked_class(decision),
        "target": SERVICE_STATUS_TARGET if admitted else None,
        "target_surface": NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE if admitted else None,
        "target_hints": unit.get("target_hints") or {},
        "multimodal_policy": _multimodal_policy(unit),
        **fact_readiness_entry_fields(decision.fact_readiness),
        "reason_codes": decision.reason_codes,
        "preconditions": [
            "searchable_unit_present",
            "source_object_refs_present",
            "service_status_current_window_extracted",
            "no_current_promotion",
        ]
        if admitted
        else [],
        "searchable_unit_id": unit.get("unit_id"),
    }


def _replay_dry_run(
    *,
    decisions: Sequence[_ServiceStatusDecision],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    records = _admitted_records(decisions)
    blocked_reason_codes = {
        str(decision.unit.get("source_notice_id")): decision.reason_codes
        for decision in decisions
        if not decision.admitted
    }
    return {
        "schema_version": REPLAY_DRY_RUN_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_06_SERVICE_STATUS_ID,
        "target": SERVICE_STATUS_TARGET,
        "source_notice_count": len(decisions),
        "source_notice_ids": [decision.unit.get("source_notice_id") for decision in decisions],
        "service_status_record_count": len(records),
        "service_status_records": records,
        "blocked_reason_codes": blocked_reason_codes,
    }


def _stage_report(
    *,
    decisions: Sequence[_ServiceStatusDecision],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    stage_candidates = [
        {
            "stage_candidate_id": (
                "stage:service_status:"
                f"{decision.unit.get('site_id')}:{decision.unit.get('source_notice_id')}:"
                f"{record.get('subject_id')}"
            ),
            "source_notice_id": decision.unit.get("source_notice_id"),
            "searchable_unit_id": decision.unit.get("unit_id"),
            "target": SERVICE_STATUS_TARGET,
            "record": record,
            "source_object_refs": list(decision.unit.get("source_object_refs") or ()),
            "source_url": decision.unit.get("source_url"),
        }
        for decision in decisions
        if decision.admitted and decision.record is not None
        for record in (decision.record,)
    ]
    return {
        "schema_version": STAGE_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_06_SERVICE_STATUS_ID,
        "target": SERVICE_STATUS_TARGET,
        "stage_candidate_count": len(stage_candidates),
        "stage_candidates": stage_candidates,
    }


def _consistency_report(
    *,
    decisions: Sequence[_ServiceStatusDecision],
    stage_report: Mapping[str, Any],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    admitted_decisions = [decision for decision in decisions if decision.admitted]
    blocking_reason_codes = {
        "required_media_pending",
        "missing_source_object_refs",
        "missing_body_text",
        "missing_effective_window_or_status_signal",
    }
    if not decisions:
        issues.append({"field": "service_status_candidates", "reason": "no_candidates"})
    if any(set(decision.reason_codes) & blocking_reason_codes for decision in decisions):
        issues.append(
            {"field": "service_status_candidates", "reason": "blocked_candidates_present"}
        )
    for decision in admitted_decisions:
        if decision.record is None:
            issues.append({"field": "service_status_records", "reason": "missing_record"})
        if not decision.unit.get("source_object_refs"):
            issues.append({"field": "source_object_refs", "reason": "missing"})
        if not decision.unit.get("unit_id"):
            issues.append({"field": "searchable_unit_id", "reason": "missing"})
    return {
        "schema_version": CONSISTENCY_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "phase": PHASE_06_SERVICE_STATUS_ID,
        "target": SERVICE_STATUS_TARGET,
        "verdict": "passed" if not issues else "blocked",
        "issues": issues,
        "source_notice_ids": [decision.unit.get("source_notice_id") for decision in decisions],
        "admitted_source_count": len(admitted_decisions),
        "blocked_source_count": len(decisions) - len(admitted_decisions),
        "source_object_ref_count": sum(
            len(decision.unit.get("source_object_refs") or ()) for decision in admitted_decisions
        ),
        "stage_candidate_count": stage_report.get("stage_candidate_count", 0),
        "current_promotion_enabled": False,
    }


def _trace_report(
    *,
    decisions: Sequence[_ServiceStatusDecision],
    stage_report: Mapping[str, Any],
    consistency_report: Mapping[str, Any],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    admitted_decisions = [decision for decision in decisions if decision.admitted]
    blocked_decisions = [decision for decision in decisions if not decision.admitted]
    return {
        "schema_version": TRACE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "phase": PHASE_06_SERVICE_STATUS_ID,
        "source_notice_ids": [decision.unit.get("source_notice_id") for decision in decisions],
        "admitted_source_notice_ids": [
            decision.unit.get("source_notice_id") for decision in admitted_decisions
        ],
        "blocked_source_notice_ids": [
            decision.unit.get("source_notice_id") for decision in blocked_decisions
        ],
        "downstream_target": SERVICE_STATUS_TARGET,
        "downstream_stage_candidate_ids": [
            row["stage_candidate_id"] for row in stage_report.get("stage_candidates") or ()
        ],
        "consistency_verdict": consistency_report.get("verdict"),
    }


def _rejected_deferred_source_report(
    *,
    decisions: Sequence[_ServiceStatusDecision],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    entries = []
    for decision in decisions:
        if decision.admitted:
            continue
        unit = decision.unit
        entries.append(
            {
                "source_notice_id": unit.get("source_notice_id"),
                "candidate_target": SERVICE_STATUS_TARGET,
                "reason_codes": decision.reason_codes,
                "consumption_class": _blocked_class(decision),
                "searchable_exists": bool(unit.get("unit_id")),
                "multimodal_processing_could_change_decision": (
                    "required_media_pending" in decision.reason_codes
                ),
                "source_url": unit.get("source_url"),
            }
        )
    return {
        "schema_version": REJECTED_DEFERRED_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "phase": PHASE_06_SERVICE_STATUS_ID,
        "entry_count": len(entries),
        "entries": entries,
    }


def _preview_registry_and_store(
    units: Sequence[Mapping[str, Any]],
) -> tuple[_PreviewDocumentRegistry, _PreviewObjectStore]:
    records: list[DocumentRegistryRecord] = []
    objects: dict[tuple[str, str], bytes] = {}
    for unit in units:
        document_id = str(unit.get("source_document_id") or "")
        if not document_id:
            continue
        key = _canonical_key(unit)
        records.append(_registry_record(unit=unit, canonical_key=key))
        objects[(_PREVIEW_DERIVED_BUCKET, key)] = _canonical_markdown(unit).encode("utf-8")
    return _PreviewDocumentRegistry(records), _PreviewObjectStore(objects)


def _registry_record(*, unit: Mapping[str, Any], canonical_key: str) -> DocumentRegistryRecord:
    document_id = str(unit.get("source_document_id") or "")
    source_notice_id = str(unit.get("source_notice_id") or "")
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=f"preview:{source_notice_id}:source-faithful",
        source_uri=str(unit.get("source_url") or ""),
        content_hash=f"preview:{source_notice_id}:content",
        corpus=str(unit.get("source_corpus") or "campus_notices"),
        collection=str(unit.get("source_collection") or "internal_notice"),
        cleaning_policy_version="collected_notice_service_status_replay_preview_v1",
        entitlement_groups=tuple(str(item) for item in unit.get("entitlement_groups") or ()),
        visibility_scope=str(unit.get("visibility_scope") or ""),
        visibility_level=str(unit.get("visibility_level") or "restricted"),
        status="active",
        ingestion_timestamp=str(unit.get("updated_at") or ""),
        parser_version="collected_notice_service_status_replay_preview_v1",
        embedding_model="preview",
        source_channel=str(unit.get("source_channel") or "authenticated_notice_portal"),
        is_current=True,
        document_units_object_key=f"{canonical_key}.units.jsonl",
        canonical_markdown_object_key=canonical_key,
        processed_object_keys=(canonical_key,),
        import_source="collected_notice_service_status_replay_preview",
        published_date=str(unit.get("published_at") or "").split(" ")[0],
    )


def _canonical_key(unit: Mapping[str, Any]) -> str:
    existing = str(unit.get("normalized_markdown_object_key") or "").strip()
    if existing:
        return existing
    return f"preview/service-status/{unit.get('source_notice_id')}/canonical.md"


def _canonical_markdown(unit: Mapping[str, Any]) -> str:
    title = str(unit.get("title") or "").strip()
    body = str(unit.get("body_text") or "").strip()
    return f"# {title}\n\n{body}\n" if title else f"{body}\n"


def _record_effective_at(record: Mapping[str, Any], generated_at: str) -> bool:
    generated_dt = _parse_datetime(generated_at)
    effective_from = _parse_datetime(str(record.get("effective_from") or ""))
    effective_until = _parse_datetime(str(record.get("effective_until") or ""))
    return effective_from <= generated_dt < effective_until


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(str(value).strip())
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_SHANGHAI_TZ)
    return parsed.astimezone(_SHANGHAI_TZ)


def _blocked_class(decision: _ServiceStatusDecision) -> str:
    if decision.fact_readiness.get("target_admission_state") == TARGET_ADMISSION_NEEDS_MULTIMODAL:
        return "needs_multimodal"
    if "not_current_effective_at_generated_time" in decision.reason_codes:
        return "search_only"
    return "defer"


def _multimodal_policy(unit: Mapping[str, Any]) -> str:
    status = str(unit.get("multimodal_status") or "").strip()
    if status in {"pending", "failed", "completed"}:
        return status
    return "not_required"


def _organization_name(unit: Mapping[str, Any]) -> str:
    search_text = str(unit.get("search_text") or "")
    lines = [line.strip() for line in search_text.splitlines() if line.strip()]
    return lines[1] if len(lines) > 1 else ""


def _admitted_records(decisions: Sequence[_ServiceStatusDecision]) -> list[dict[str, Any]]:
    return [
        dict(decision.record) for decision in decisions if decision.admitted and decision.record
    ]


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


__all__ = [
    "PHASE_06_SERVICE_STATUS_ID",
    "CollectedNoticeServiceStatusReplayPreview",
    "build_service_status_batch_preview",
    "build_service_status_batch_preview_from_paths",
    "preview_to_output_files",
]
