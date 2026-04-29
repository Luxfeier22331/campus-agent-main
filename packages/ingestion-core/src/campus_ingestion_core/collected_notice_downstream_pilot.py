from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.notice_derived_transport_schedule_materialization import (
    _extract_rows_from_body_schedule,
)
from campus_ingestion_core.notice_derived_transport_schedule_parsing import (
    _resolve_segment_service_date_ranges,
    _resolve_service_date_ranges,
    _source_ref,
)

PHASE_06_ID = "phase-06-batched-downstream-replay"
ADMISSION_SCHEMA_VERSION = "collected_notice_consumer_admission.v1"
REPLAY_DRY_RUN_SCHEMA_VERSION = "collected_notice_downstream_replay_dry_run.v1"
STAGE_REPORT_SCHEMA_VERSION = "collected_notice_downstream_stage_report.v1"
CONSISTENCY_REPORT_SCHEMA_VERSION = "collected_notice_downstream_consistency_report.v1"
TRACE_SCHEMA_VERSION = "collected_notice_downstream_trace.v1"
REJECTED_DEFERRED_SCHEMA_VERSION = "collected_notice_rejected_deferred_sources.v1"
TRANSPORT_SCHEDULE_TARGET = "transport_schedule"
TRANSPORT_SCHEDULE_TARGET_SURFACE = "campus_services/transport_schedule_candidate"


@dataclass(frozen=True, slots=True)
class CollectedNoticeDownstreamPilotPreview:
    admission_manifest: dict[str, Any]
    replay_dry_run: dict[str, Any]
    stage_report: dict[str, Any]
    consistency_report: dict[str, Any]
    source_to_searchable_downstream_trace: dict[str, Any]
    rejected_deferred_source_report: dict[str, Any]


def build_transport_schedule_single_notice_pilot_preview_from_paths(
    *,
    searchable_notice_preview_path: Path,
    multimodal_candidate_inventory_path: Path,
    source_notice_id: str,
    transport_baseline_effective_date: str = "",
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_downstream_pilot",
) -> CollectedNoticeDownstreamPilotPreview:
    return build_transport_schedule_single_notice_pilot_preview(
        searchable_notice_preview=_load_json_object(searchable_notice_preview_path),
        multimodal_candidate_inventory=_load_json_object(multimodal_candidate_inventory_path),
        source_notice_id=source_notice_id,
        transport_baseline_effective_date=transport_baseline_effective_date,
        generated_by=generated_by,
    )


def build_transport_schedule_single_notice_pilot_preview(
    *,
    searchable_notice_preview: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    source_notice_id: str,
    transport_baseline_effective_date: str = "",
    generated_at: str | None = None,
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_downstream_pilot",
) -> CollectedNoticeDownstreamPilotPreview:
    timestamp = generated_at or utc_now()
    unit = _select_unit(searchable_notice_preview, source_notice_id=source_notice_id)
    return _build_transport_schedule_preview(
        units=[unit],
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        generated_at=timestamp,
        generated_by=generated_by,
        batch_id=f"phase6-pilot-transport-schedule-{source_notice_id}",
        selection_scope="single_notice_pilot",
        selection_policy_name="phase6-single-notice-transport-schedule-pilot",
        admission_reason_code="single_notice_pilot_admitted",
        transport_baseline_effective_date=transport_baseline_effective_date,
    )


def build_transport_schedule_batch_preview_from_paths(
    *,
    searchable_notice_preview_path: Path,
    multimodal_candidate_inventory_path: Path,
    transport_baseline_effective_date: str = "",
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_downstream_pilot",
) -> CollectedNoticeDownstreamPilotPreview:
    return build_transport_schedule_batch_preview(
        searchable_notice_preview=_load_json_object(searchable_notice_preview_path),
        multimodal_candidate_inventory=_load_json_object(multimodal_candidate_inventory_path),
        transport_baseline_effective_date=transport_baseline_effective_date,
        generated_by=generated_by,
    )


def build_transport_schedule_batch_preview(
    *,
    searchable_notice_preview: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    transport_baseline_effective_date: str = "",
    generated_at: str | None = None,
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_downstream_pilot",
) -> CollectedNoticeDownstreamPilotPreview:
    timestamp = generated_at or utc_now()
    units = _select_transport_schedule_units(searchable_notice_preview)
    return _build_transport_schedule_preview(
        units=units,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        generated_at=timestamp,
        generated_by=generated_by,
        batch_id="phase6-batch-transport-schedule",
        selection_scope="target_batch",
        selection_policy_name="phase6-transport-schedule-target-batch",
        admission_reason_code="transport_schedule_batch_admitted",
        transport_baseline_effective_date=transport_baseline_effective_date,
    )


def _build_transport_schedule_preview(
    *,
    units: list[dict[str, Any]],
    multimodal_candidate_inventory: Mapping[str, Any],
    generated_at: str,
    generated_by: str,
    batch_id: str,
    selection_scope: str,
    selection_policy_name: str,
    admission_reason_code: str,
    transport_baseline_effective_date: str,
) -> CollectedNoticeDownstreamPilotPreview:
    decisions = [
        _transport_schedule_decision(
            unit=unit,
            multimodal_candidate_inventory=multimodal_candidate_inventory,
            generated_at=generated_at,
            transport_baseline_effective_date=transport_baseline_effective_date,
        )
        for unit in units
    ]
    admission_manifest = _admission_manifest(
        decisions=decisions,
        generated_at=generated_at,
        generated_by=generated_by,
        batch_id=batch_id,
        selection_scope=selection_scope,
        selection_policy_name=selection_policy_name,
        admission_reason_code=admission_reason_code,
        transport_baseline_effective_date=transport_baseline_effective_date,
    )
    replay_dry_run = _replay_dry_run(
        decisions=decisions,
        generated_at=generated_at,
        generated_by=generated_by,
    )
    stage_report = _stage_report(
        decisions=decisions,
        generated_at=generated_at,
        generated_by=generated_by,
    )
    rejected_deferred = _rejected_deferred_source_report(
        decisions=decisions,
        generated_at=generated_at,
        generated_by=generated_by,
    )
    consistency_report = _consistency_report(
        decisions=decisions,
        stage_report=stage_report,
        generated_at=generated_at,
        generated_by=generated_by,
    )
    trace = _trace_report(
        decisions=decisions,
        stage_report=stage_report,
        consistency_report=consistency_report,
        generated_at=generated_at,
        generated_by=generated_by,
    )
    return CollectedNoticeDownstreamPilotPreview(
        admission_manifest=admission_manifest,
        replay_dry_run=replay_dry_run,
        stage_report=stage_report,
        consistency_report=consistency_report,
        source_to_searchable_downstream_trace=trace,
        rejected_deferred_source_report=rejected_deferred,
    )


@dataclass(frozen=True, slots=True)
class _TransportScheduleDecision:
    unit: Mapping[str, Any]
    admitted: bool
    reason_codes: list[str]
    rows: list[dict[str, Any]]
    baseline_policy: dict[str, Any]


def preview_to_output_files(
    preview: CollectedNoticeDownstreamPilotPreview,
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


def _select_unit(
    searchable_notice_preview: Mapping[str, Any], *, source_notice_id: str
) -> dict[str, Any]:
    for row in searchable_notice_preview.get("units") or ():
        if isinstance(row, Mapping) and str(row.get("source_notice_id") or "") == str(
            source_notice_id
        ):
            return dict(row)
    raise ValueError(f"source_notice_id not found in searchable preview: {source_notice_id}")


def _select_transport_schedule_units(
    searchable_notice_preview: Mapping[str, Any],
) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in searchable_notice_preview.get("units") or ()
        if isinstance(row, Mapping) and TRANSPORT_SCHEDULE_TARGET in _target_hints(row)
    ]


def _transport_schedule_decision(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    generated_at: str,
    transport_baseline_effective_date: str,
) -> _TransportScheduleDecision:
    rejection_reason_codes = _rejection_reason_codes(
        unit=unit,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
    )
    admitted = not rejection_reason_codes
    rows = _transport_schedule_rows(unit) if admitted else []
    if admitted and not rows:
        rejection_reason_codes = ["no_extractable_transport_schedule_row"]
        admitted = False
    baseline_policy = _transport_baseline_policy(
        unit=unit,
        generated_at=generated_at,
        transport_baseline_effective_date=transport_baseline_effective_date,
        requires_schedule_image_ocr=_requires_schedule_image_ocr(
            unit=unit,
            multimodal_candidate_inventory=multimodal_candidate_inventory,
        ),
    )
    return _TransportScheduleDecision(
        unit=unit,
        admitted=admitted,
        reason_codes=rejection_reason_codes,
        rows=rows if admitted else [],
        baseline_policy=baseline_policy,
    )


def _rejection_reason_codes(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
) -> list[str]:
    reasons: list[str] = []
    targets = _target_hints(unit)
    if TRANSPORT_SCHEDULE_TARGET not in targets:
        reasons.append("target_hint_not_transport_schedule")
    if str(unit.get("multimodal_status") or "") not in {"not_required", "completed"}:
        reasons.append("multimodal_not_ready")
    blocking_candidates = [
        row
        for row in multimodal_candidate_inventory.get("candidates") or ()
        if isinstance(row, Mapping)
        and str(row.get("unit_id") or "") == str(unit.get("unit_id") or "")
        and str(row.get("status") or "") in {"pending", "failed"}
    ]
    if blocking_candidates and "multimodal_not_ready" not in reasons:
        reasons.append("multimodal_not_ready")
    if not unit.get("source_object_refs"):
        reasons.append("missing_source_object_refs")
    if not str(unit.get("body_text") or "").strip():
        reasons.append("missing_body_text")
    return reasons


def _transport_schedule_rows(unit: Mapping[str, Any]) -> list[dict[str, Any]]:
    entry = _projection_entry(unit)
    rows = _extract_rows_from_body_schedule(
        parent_text=str(unit.get("body_text") or ""),
        projection_entry=entry,
        source_ref=_source_ref(entry),
    )
    return [_row_payload(row) for row in rows]


def _projection_entry(unit: Mapping[str, Any]) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus=str(unit.get("source_corpus") or "campus_notices"),
        source_collection=str(unit.get("source_collection") or "internal_notice"),
        source_notice_id=str(unit.get("source_notice_id") or ""),
        unit_id=str(unit.get("unit_id") or ""),
        primary_role=NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id=str(unit.get("source_document_id") or ""),
        source_notice_release_time=str(unit.get("published_at") or ""),
        role_metadata={
            "notice_title": str(unit.get("title") or ""),
            "organization_name": _organization_name(unit),
            "service_status_candidate_kind": TRANSPORT_SCHEDULE_TARGET,
        },
        updated_at=str(unit.get("updated_at") or ""),
    )


def _row_payload(row: Any) -> dict[str, Any]:
    payload = asdict(row)
    payload["service_date_ranges"] = [list(item) for item in row.service_date_ranges]
    return payload


def _admission_manifest(
    *,
    decisions: list[_TransportScheduleDecision],
    generated_at: str,
    generated_by: str,
    batch_id: str,
    selection_scope: str,
    selection_policy_name: str,
    admission_reason_code: str,
    transport_baseline_effective_date: str,
) -> dict[str, Any]:
    entries = [
        _admission_entry(
            decision=decision,
            admission_reason_code=admission_reason_code,
        )
        for decision in decisions
    ]
    return {
        "schema_version": ADMISSION_SCHEMA_VERSION,
        "batch_id": batch_id,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_06_ID,
        "selection_scope": selection_scope,
        "source_scope": {
            "source_notice_ids": [decision.unit.get("source_notice_id") for decision in decisions],
            "target": TRANSPORT_SCHEDULE_TARGET,
        },
        "baseline": "captured_but_not_imported",
        "transport_baseline": {
            "status": "available" if transport_baseline_effective_date else "missing",
            "effective_date": transport_baseline_effective_date,
        },
        "selection_policy": {
            "name": selection_policy_name,
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
            "ocr_execute_now": sum(
                1 for entry in entries if entry["ocr_priority"] == "execute_now"
            ),
            "ocr_defer_until_baseline": sum(
                1 for entry in entries if entry["ocr_priority"] == "defer_until_baseline"
            ),
            "historical_search_only": sum(
                1 for entry in entries if entry["overlay_kind"] == "historical_search_only"
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


def _admission_entry(
    *,
    decision: _TransportScheduleDecision,
    admission_reason_code: str,
) -> dict[str, Any]:
    unit = decision.unit
    baseline_policy = decision.baseline_policy
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
        "consumption_class": ("downstream_admitted" if decision.admitted else _blocked_class(unit)),
        "target": TRANSPORT_SCHEDULE_TARGET if decision.admitted else None,
        "target_surface": TRANSPORT_SCHEDULE_TARGET_SURFACE if decision.admitted else None,
        "target_hints": unit.get("target_hints") or {},
        "multimodal_policy": _multimodal_policy(unit),
        **baseline_policy,
        "reason_codes": decision.reason_codes or [admission_reason_code],
        "preconditions": [
            "searchable_unit_present",
            "source_object_refs_present",
            "body_transport_schedule_extracted",
            "no_current_promotion",
        ]
        if decision.admitted
        else [],
        "searchable_unit_id": unit.get("unit_id"),
    }


def _replay_dry_run(
    *,
    decisions: list[_TransportScheduleDecision],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    rows = _all_rows(decisions)
    blocked_reason_codes = {
        str(decision.unit.get("source_notice_id")): decision.reason_codes
        for decision in decisions
        if decision.reason_codes
    }
    single_unit = decisions[0].unit if len(decisions) == 1 else {}
    return {
        "schema_version": REPLAY_DRY_RUN_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_06_ID,
        "target": TRANSPORT_SCHEDULE_TARGET,
        "source_notice_id": single_unit.get("source_notice_id"),
        "searchable_unit_id": single_unit.get("unit_id"),
        "source_notice_count": len(decisions),
        "source_notice_ids": [decision.unit.get("source_notice_id") for decision in decisions],
        "extracted_schedule_row_count": len(rows),
        "transport_schedule_rows": rows,
        "blocked_reason_codes": blocked_reason_codes,
    }


def _stage_report(
    *,
    decisions: list[_TransportScheduleDecision],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    stage_candidates = [
        {
            "stage_candidate_id": (
                "stage:transport_schedule:"
                f"{decision.unit.get('site_id')}:{decision.unit.get('source_notice_id')}:{index}"
            ),
            "source_notice_id": decision.unit.get("source_notice_id"),
            "searchable_unit_id": decision.unit.get("unit_id"),
            "target": TRANSPORT_SCHEDULE_TARGET,
            "row": row,
            "source_object_refs": list(decision.unit.get("source_object_refs") or ()),
            "source_url": decision.unit.get("source_url"),
        }
        for decision in decisions
        for index, row in enumerate(decision.rows, start=1)
    ]
    return {
        "schema_version": STAGE_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_06_ID,
        "target": TRANSPORT_SCHEDULE_TARGET,
        "stage_candidate_count": len(stage_candidates),
        "stage_candidates": stage_candidates,
    }


def _consistency_report(
    *,
    decisions: list[_TransportScheduleDecision],
    stage_report: Mapping[str, Any],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    admitted_decisions = [decision for decision in decisions if decision.admitted]
    rows = _all_rows(decisions)
    if not rows:
        issues.append({"field": "transport_schedule_rows", "reason": "no_admitted_rows"})
    for decision in admitted_decisions:
        if not decision.unit.get("source_object_refs"):
            issues.append({"field": "source_object_refs", "reason": "missing"})
        if not decision.unit.get("unit_id"):
            issues.append({"field": "searchable_unit_id", "reason": "missing"})
    return {
        "schema_version": CONSISTENCY_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "phase": PHASE_06_ID,
        "target": TRANSPORT_SCHEDULE_TARGET,
        "verdict": "passed" if not issues else "blocked",
        "issues": issues,
        "source_notice_id": (
            decisions[0].unit.get("source_notice_id") if len(decisions) == 1 else None
        ),
        "searchable_unit_id": (decisions[0].unit.get("unit_id") if len(decisions) == 1 else None),
        "source_url": decisions[0].unit.get("source_url") if len(decisions) == 1 else None,
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
    decisions: list[_TransportScheduleDecision],
    stage_report: Mapping[str, Any],
    consistency_report: Mapping[str, Any],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    admitted_decisions = [decision for decision in decisions if decision.admitted]
    first_decision = decisions[0] if decisions else None
    first_unit = first_decision.unit if first_decision is not None else {}
    return {
        "schema_version": TRACE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "phase": PHASE_06_ID,
        "source_notice_id": first_unit.get("source_notice_id"),
        "source_notice_ids": [decision.unit.get("source_notice_id") for decision in decisions],
        "admitted_source_notice_ids": [
            decision.unit.get("source_notice_id") for decision in admitted_decisions
        ],
        "source_url": first_unit.get("source_url"),
        "source_object_refs": list(first_unit.get("source_object_refs") or ()),
        "searchable_unit_id": first_unit.get("unit_id"),
        "downstream_target": TRANSPORT_SCHEDULE_TARGET,
        "downstream_stage_candidate_ids": [
            row["stage_candidate_id"] for row in stage_report.get("stage_candidates") or ()
        ],
        "consistency_verdict": consistency_report.get("verdict"),
    }


def _rejected_deferred_source_report(
    *,
    decisions: list[_TransportScheduleDecision],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    entries = []
    for decision in decisions:
        if not decision.reason_codes:
            continue
        unit = decision.unit
        entries.append(
            {
                "source_notice_id": unit.get("source_notice_id"),
                "candidate_target": TRANSPORT_SCHEDULE_TARGET,
                "reason_codes": decision.reason_codes,
                "baseline_status": decision.baseline_policy["baseline_status"],
                "baseline_effective_date": decision.baseline_policy["baseline_effective_date"],
                "temporal_relation": decision.baseline_policy["temporal_relation"],
                "overlay_kind": decision.baseline_policy["overlay_kind"],
                "ocr_priority": decision.baseline_policy["ocr_priority"],
                "current_eligible": decision.baseline_policy["current_eligible"],
                "baseline_gate_reason_codes": decision.baseline_policy[
                    "baseline_gate_reason_codes"
                ],
                "searchable_exists": bool(unit.get("unit_id")),
                "multimodal_processing_could_change_decision": (
                    "multimodal_not_ready" in decision.reason_codes
                ),
            }
        )
    return {
        "schema_version": REJECTED_DEFERRED_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "phase": PHASE_06_ID,
        "entry_count": len(entries),
        "entries": entries,
    }


def _target_hints(unit: Mapping[str, Any]) -> list[str]:
    hints = unit.get("target_hints")
    if not isinstance(hints, Mapping):
        return []
    values = hints.get("candidate_targets")
    if not isinstance(values, list | tuple):
        return []
    return [str(value).strip() for value in values if str(value).strip()]


def _multimodal_policy(unit: Mapping[str, Any]) -> str:
    status = str(unit.get("multimodal_status") or "")
    if status == "not_required":
        return "not_required"
    if status == "completed":
        return "completed"
    if status == "pending":
        return "pending"
    if status == "failed":
        return "failed"
    return "not_required"


def _blocked_class(unit: Mapping[str, Any]) -> str:
    if _multimodal_policy(unit) in {"pending", "failed"}:
        return "needs_multimodal"
    return "defer"


def _transport_baseline_policy(
    *,
    unit: Mapping[str, Any],
    generated_at: str,
    transport_baseline_effective_date: str,
    requires_schedule_image_ocr: bool,
) -> dict[str, Any]:
    baseline_date = _parse_iso_date(transport_baseline_effective_date)
    anchor_date = _parse_iso_date(generated_at) or date.today()
    service_date_ranges = _service_date_ranges(unit)
    release_date = _parse_iso_date(str(unit.get("published_at") or ""))
    policy_text = _policy_text(unit)
    baseline_status = "available" if baseline_date is not None else "missing"
    baseline_reason_codes: list[str] = []
    explicit_service_date_ranges = _explicit_service_date_ranges(unit)

    if baseline_date is None:
        temporal_relation = _window_temporal_relation(
            service_date_ranges=service_date_ranges,
            anchor_date=anchor_date,
        )
        overlay_kind = (
            "awaiting_baseline"
            if requires_schedule_image_ocr
            else _overlay_kind(
                service_date_ranges=service_date_ranges,
                policy_text=policy_text,
                fallback="manual_review",
            )
        )
        ocr_priority = "defer_until_baseline" if requires_schedule_image_ocr else "search_only"
        baseline_reason_codes.append("transport_baseline_missing")
        if requires_schedule_image_ocr:
            baseline_reason_codes.append("schedule_image_requires_ocr")
    elif release_date is not None and release_date < baseline_date:
        temporal_relation = "pre_baseline"
        overlay_kind = "historical_search_only"
        ocr_priority = "search_only"
        baseline_reason_codes.append("pre_baseline_historical_search_only")
    elif explicit_service_date_ranges:
        temporal_relation = _window_temporal_relation(
            service_date_ranges=explicit_service_date_ranges,
            anchor_date=anchor_date,
        )
        overlay_kind = _overlay_kind(
            service_date_ranges=explicit_service_date_ranges,
            policy_text=policy_text,
            fallback="temporary_overlay",
        )
        ocr_priority = (
            "execute_now"
            if requires_schedule_image_ocr and temporal_relation == "active_or_future_window"
            else "search_only"
        )
        baseline_reason_codes.append("temporary_window_detected")
        if requires_schedule_image_ocr:
            baseline_reason_codes.append("schedule_image_requires_ocr")
    elif _looks_like_baseline_delta(policy_text):
        temporal_relation = "post_baseline"
        overlay_kind = "baseline_delta_candidate"
        ocr_priority = "execute_now" if requires_schedule_image_ocr else "search_only"
        baseline_reason_codes.append("post_baseline_delta_candidate")
        if requires_schedule_image_ocr:
            baseline_reason_codes.append("schedule_image_requires_ocr")
    else:
        temporal_relation = "post_baseline" if release_date else "unknown"
        overlay_kind = "manual_review"
        ocr_priority = "manual_review" if requires_schedule_image_ocr else "search_only"
        baseline_reason_codes.append("manual_review_required")
        if requires_schedule_image_ocr:
            baseline_reason_codes.append("schedule_image_requires_ocr")

    return {
        "baseline_status": baseline_status,
        "baseline_effective_date": transport_baseline_effective_date if baseline_date else "",
        "temporal_relation": temporal_relation,
        "overlay_kind": overlay_kind,
        "ocr_priority": ocr_priority,
        "current_eligible": False,
        "baseline_gate_reason_codes": list(dict.fromkeys(baseline_reason_codes)),
    }


def _requires_schedule_image_ocr(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
) -> bool:
    if _multimodal_policy(unit) in {
        "pending",
        "failed",
    } and TRANSPORT_SCHEDULE_TARGET in _target_hints(unit):
        return True
    unit_id = str(unit.get("unit_id") or "")
    for row in multimodal_candidate_inventory.get("candidates") or ():
        if not isinstance(row, Mapping):
            continue
        if str(row.get("unit_id") or "") != unit_id:
            continue
        status = str(row.get("status") or "")
        if status not in {"pending", "failed"}:
            continue
        processing_family = str(row.get("processing_family") or "")
        media_kind = str(row.get("media_kind") or "")
        if processing_family == "schedule_image_ocr" or media_kind == "image":
            return True
        if not processing_family and TRANSPORT_SCHEDULE_TARGET in _target_hints(unit):
            return True
    return False


def _explicit_service_date_ranges(unit: Mapping[str, Any]) -> tuple[tuple[str, str], ...]:
    return _resolve_service_date_ranges(
        text=_policy_text(unit),
        release_time=str(unit.get("published_at") or ""),
    )


def _service_date_ranges(unit: Mapping[str, Any]) -> tuple[tuple[str, str], ...]:
    text = _policy_text(unit)
    release_time = str(unit.get("published_at") or "")
    ranged = _resolve_service_date_ranges(text=text, release_time=release_time)
    if ranged:
        return ranged
    return _resolve_segment_service_date_ranges(
        text=text,
        release_time=release_time,
        allow_open_ended_effective_date=False,
    )


def _window_temporal_relation(
    *,
    service_date_ranges: tuple[tuple[str, str], ...],
    anchor_date: date,
) -> str:
    if not service_date_ranges:
        return "unknown"
    latest_end = max(date.fromisoformat(end_date) for _start_date, end_date in service_date_ranges)
    return "expired_temporary_window" if latest_end < anchor_date else "active_or_future_window"


def _overlay_kind(
    *,
    service_date_ranges: tuple[tuple[str, str], ...],
    policy_text: str,
    fallback: str,
) -> str:
    if service_date_ranges:
        if any(keyword in policy_text for keyword in ("停运", "暂停", "停止", "不运行")):
            return "temporary_exception"
        return "temporary_overlay"
    if _looks_like_baseline_delta(policy_text):
        return "baseline_delta_candidate"
    return fallback


def _looks_like_baseline_delta(policy_text: str) -> bool:
    compact = "".join(policy_text.split())
    return any(
        marker in compact
        for marker in (
            "起",
            "开始",
            "调整",
            "增加",
            "增开",
            "加开",
            "恢复",
            "优化",
            "变更",
        )
    )


def _policy_text(unit: Mapping[str, Any]) -> str:
    return "\n".join(
        str(unit.get(key) or "") for key in ("title", "body_text", "body_excerpt", "search_text")
    )


def _parse_iso_date(value: str) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    match = re.search(r"20\d{2}-\d{1,2}-\d{1,2}", text)
    if not match:
        return None
    year_text, month_text, day_text = match.group(0).split("-")
    return date(int(year_text), int(month_text), int(day_text))


def _organization_name(unit: Mapping[str, Any]) -> str:
    search_text = str(unit.get("search_text") or "")
    lines = [line.strip() for line in search_text.splitlines() if line.strip()]
    return lines[1] if len(lines) > 1 else ""


def _all_rows(decisions: list[_TransportScheduleDecision]) -> list[dict[str, Any]]:
    return [row for decision in decisions for row in decision.rows]


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


__all__ = [
    "PHASE_06_ID",
    "CollectedNoticeDownstreamPilotPreview",
    "build_transport_schedule_batch_preview",
    "build_transport_schedule_batch_preview_from_paths",
    "build_transport_schedule_single_notice_pilot_preview",
    "build_transport_schedule_single_notice_pilot_preview_from_paths",
    "preview_to_output_files",
]
