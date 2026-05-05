from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_fact_readiness import (
    build_policy_hold_fact_readiness,
    build_regulation_fact_readiness,
    fact_readiness_entry_fields,
)
from campus_ingestion_core.collected_notice_regulation_admission_support import (
    INSTITUTIONAL_TARGET_COLLECTION,
    REGULATION_CLASS_DUPLICATE_HOLD,
    REGULATION_CLASS_HISTORICAL_ANNUAL_CYCLE_HOLD,
    REGULATION_CLASS_HISTORICAL_TIME_WINDOW_HOLD,
    REGULATION_CLASS_INSTITUTIONAL,
    REGULATION_CLASS_INVALID_CAPTURE,
    REGULATION_CLASS_MANUAL_REVIEW,
    REGULATION_CLASS_NEEDS_MULTIMODAL,
    REGULATION_CLASS_SCOPED,
    REGULATION_CLASS_WRAPPER_ONLY,
    REGULATION_TARGET,
    SCOPED_TARGET_COLLECTION,
    _candidate_key,
    _coerce_recovered_owner_text_payload,
    _cycle_year,
    _has_formal_owner_title,
    _has_regulation_body_structure,
    _is_historical_annual_cycle_rule,
    _is_historical_time_window_rule,
    _issuing_org,
    _load_json_object,
    _looks_like_draft_or_operational_scheme,
    _looks_like_regulation_candidate,
    _looks_like_wrapper_notice,
    _mapping_rows,
    _multimodal_policy,
    _owner_text_status,
    _preconditions,
    _queue_trace_by_unit_id,
    _read_owner_text_from_plain_text_ref,
    _read_owner_text_from_searchable_merge_input,
    _regulation_title,
    _target_collection_for_text,
    _target_identity_preview,
)

PHASE_06_R1_ID = "phase-06-r1-regulation-candidate-audit-and-admission"
ADMISSION_SCHEMA_VERSION = "collected_notice_consumer_admission.v1"
CANDIDATE_AUDIT_SCHEMA_VERSION = "collected_notice_regulation_candidate_audit.v1"
REJECTED_DEFERRED_SCHEMA_VERSION = "collected_notice_regulation_rejected_deferred.v1"
SOURCE_TRACE_SCHEMA_VERSION = "collected_notice_regulation_source_trace.v1"


@dataclass(frozen=True, slots=True)
class CollectedNoticeRegulationAdmissionPreview:
    admission_manifest: dict[str, Any]
    candidate_audit: dict[str, Any]
    rejected_deferred_source_report: dict[str, Any]
    source_to_searchable_trace: dict[str, Any]


class RegulationOwnerTextObjectStoreReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class _RegulationDecision:
    unit: Mapping[str, Any]
    regulation_admission_class: str
    consumption_class: str
    reason_codes: tuple[str, ...]
    candidate_key: str | None
    regulation_title: str | None
    issuing_org: str
    target_collection: str | None
    target_surface: str | None
    target_identity_preview: str | None
    duplicate_primary_source_notice_id: str | None
    duplicate_primary_searchable_unit_id: str | None
    queue_trace_row: Mapping[str, Any] | None
    fact_readiness: dict[str, Any]
    applicability_status: str | None = None
    promotion_disposition: str | None = None
    recommended_query_surface: str | None = None
    cycle_year: str | None = None

    @property
    def admitted(self) -> bool:
        return self.regulation_admission_class in {
            REGULATION_CLASS_INSTITUTIONAL,
            REGULATION_CLASS_SCOPED,
        }


def build_collected_notice_regulation_admission_preview_from_paths(
    *,
    searchable_notice_preview_path: Path,
    multimodal_candidate_inventory_path: Path,
    queue_consume_trace_path: Path | None = None,
    owner_text_execution_report_path: Path | None = None,
    owner_text_execution_report_paths: Sequence[Path] | None = None,
    owner_text_object_store: RegulationOwnerTextObjectStoreReader | None = None,
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_regulation_admission",
) -> CollectedNoticeRegulationAdmissionPreview:
    queue_trace = (
        _load_json_object(queue_consume_trace_path)
        if queue_consume_trace_path is not None and Path(queue_consume_trace_path).exists()
        else None
    )
    owner_text_report_paths = _owner_text_execution_report_paths(
        owner_text_execution_report_path=owner_text_execution_report_path,
        owner_text_execution_report_paths=owner_text_execution_report_paths,
    )
    owner_text_reports = [
        _load_json_object(path) for path in owner_text_report_paths if Path(path).exists()
    ]
    recovered_owner_text_by_unit = None
    if owner_text_reports:
        if owner_text_object_store is None:
            raise ValueError(
                "owner_text_object_store is required when owner text execution reports are set"
            )
        recovered_owner_text_by_unit = build_recovered_owner_text_by_unit_from_execution_reports(
            execution_reports=owner_text_reports,
            object_store=owner_text_object_store,
        )
    return build_collected_notice_regulation_admission_preview(
        searchable_notice_preview=_load_json_object(searchable_notice_preview_path),
        multimodal_candidate_inventory=_load_json_object(multimodal_candidate_inventory_path),
        queue_consume_trace=queue_trace,
        recovered_owner_text_by_unit=recovered_owner_text_by_unit,
        generated_by=generated_by,
        evidence_refs={
            "searchable_preview": str(searchable_notice_preview_path),
            "multimodal_inventory": str(multimodal_candidate_inventory_path),
            "queue_consume_trace": str(queue_consume_trace_path or ""),
            "owner_text_execution_report": ";".join(str(path) for path in owner_text_report_paths),
        },
    )


def build_collected_notice_regulation_admission_preview(
    *,
    searchable_notice_preview: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    queue_consume_trace: Mapping[str, Any] | None = None,
    recovered_owner_text_by_unit: Mapping[str, Any] | None = None,
    generated_at: str | None = None,
    generated_by: str = "campus_ingestion_worker.preview_collected_notice_regulation_admission",
    evidence_refs: Mapping[str, str] | None = None,
) -> CollectedNoticeRegulationAdmissionPreview:
    timestamp = generated_at or utc_now()
    queue_trace_by_unit_id = _queue_trace_by_unit_id(queue_consume_trace)
    units = _select_regulation_candidate_units(
        searchable_notice_preview=searchable_notice_preview,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        queue_trace_by_unit_id=queue_trace_by_unit_id,
    )
    units = _apply_recovered_owner_text_to_units(
        units=units,
        recovered_owner_text_by_unit=recovered_owner_text_by_unit or {},
    )
    decisions = _build_decisions(
        units=units,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        queue_trace_by_unit_id=queue_trace_by_unit_id,
        generated_at=timestamp,
    )
    admission_manifest = _admission_manifest(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
        queue_backed=bool(queue_trace_by_unit_id),
        evidence_refs=dict(evidence_refs or {}),
    )
    candidate_audit = _candidate_audit(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
        queue_backed=bool(queue_trace_by_unit_id),
    )
    rejected_deferred = _rejected_deferred_source_report(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    source_trace = _source_to_searchable_trace(
        decisions=decisions,
        generated_at=timestamp,
        generated_by=generated_by,
        queue_backed=bool(queue_trace_by_unit_id),
    )
    return CollectedNoticeRegulationAdmissionPreview(
        admission_manifest=admission_manifest,
        candidate_audit=candidate_audit,
        rejected_deferred_source_report=rejected_deferred,
        source_to_searchable_trace=source_trace,
    )


def preview_to_output_files(
    preview: CollectedNoticeRegulationAdmissionPreview,
) -> dict[str, dict[str, Any]]:
    return {
        "regulation-consumer-admission-manifest.json": preview.admission_manifest,
        "regulation-candidate-audit.json": preview.candidate_audit,
        "regulation-rejected-deferred-source-report.json": (
            preview.rejected_deferred_source_report
        ),
        "regulation-source-to-searchable-trace.json": preview.source_to_searchable_trace,
    }


def build_recovered_owner_text_by_unit_from_execution_report(
    *,
    execution_report: Mapping[str, Any],
    object_store: RegulationOwnerTextObjectStoreReader,
) -> dict[str, dict[str, Any]]:
    return build_recovered_owner_text_by_unit_from_execution_reports(
        execution_reports=(execution_report,),
        object_store=object_store,
    )


def build_recovered_owner_text_by_unit_from_execution_reports(
    *,
    execution_reports: Sequence[Mapping[str, Any]],
    object_store: RegulationOwnerTextObjectStoreReader,
) -> dict[str, dict[str, Any]]:
    recovered: dict[str, dict[str, Any]] = {}
    for execution_report in execution_reports:
        for result in _mapping_rows(execution_report.get("attempt_results")):
            if str(result.get("status") or "") != "succeeded":
                continue
            if str(result.get("owner_text_status") or "") != "ready":
                continue
            unit_id = str(result.get("searchable_unit_id") or "").strip()
            if not unit_id:
                continue
            refs = result.get("written_refs")
            if not isinstance(refs, Mapping):
                continue
            merge_ref = refs.get("searchable_merge_input")
            plain_text_ref = refs.get("plain_text")
            owner_text = ""
            if isinstance(merge_ref, Mapping):
                owner_text = _read_owner_text_from_searchable_merge_input(
                    object_store=object_store,
                    ref=merge_ref,
                )
            if not owner_text and isinstance(plain_text_ref, Mapping):
                owner_text = _read_owner_text_from_plain_text_ref(
                    object_store=object_store,
                    ref=plain_text_ref,
                )
            if not owner_text.strip():
                continue
            payload = {
                "owner_text": owner_text.strip(),
                "written_refs": {
                    key: dict(value) for key, value in refs.items() if isinstance(value, Mapping)
                },
                "provider": result.get("provider"),
                "model": result.get("model"),
                "owner_text_length": result.get("owner_text_length"),
                "owner_text_sha256": result.get("owner_text_sha256"),
                "source_notice_id": result.get("source_notice_id"),
            }
            existing = recovered.get(unit_id)
            if existing is not None and existing.get("owner_text") != payload["owner_text"]:
                raise ValueError(f"conflicting owner text recovery for unit_id: {unit_id}")
            recovered[unit_id] = payload
    return recovered


def _owner_text_execution_report_paths(
    *,
    owner_text_execution_report_path: Path | None,
    owner_text_execution_report_paths: Sequence[Path] | None,
) -> tuple[Path, ...]:
    values: list[Path] = []
    if owner_text_execution_report_path is not None:
        values.append(Path(owner_text_execution_report_path))
    for path in owner_text_execution_report_paths or ():
        values.append(Path(path))
    deduped: dict[str, Path] = {}
    for path in values:
        deduped[str(path)] = path
    return tuple(deduped[key] for key in sorted(deduped))


def _select_regulation_candidate_units(
    *,
    searchable_notice_preview: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    queue_trace_by_unit_id: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    units: list[dict[str, Any]] = []
    for row in searchable_notice_preview.get("units") or ():
        if not isinstance(row, Mapping):
            continue
        unit = dict(row)
        unit_id = str(unit.get("unit_id") or "")
        if queue_trace_by_unit_id and unit_id not in queue_trace_by_unit_id:
            continue
        if not _looks_like_regulation_candidate(unit, multimodal_candidate_inventory):
            continue
        units.append(unit)
    return sorted(
        units,
        key=lambda item: (
            str(item.get("source_surface") or ""),
            str(item.get("site_id") or ""),
            str(item.get("source_notice_id") or ""),
            str(item.get("unit_id") or ""),
        ),
    )


def _apply_recovered_owner_text_to_units(
    *,
    units: Sequence[Mapping[str, Any]],
    recovered_owner_text_by_unit: Mapping[str, Any],
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for unit in units:
        unit_id = str(unit.get("unit_id") or "").strip()
        recovered = _coerce_recovered_owner_text_payload(recovered_owner_text_by_unit.get(unit_id))
        if recovered is None:
            enriched.append(dict(unit))
            continue
        owner_text = recovered["owner_text"]
        updated = dict(unit)
        updated["body_text"] = owner_text
        updated["body_excerpt"] = owner_text[:240]
        updated["search_text"] = "\n".join(
            part
            for part in (
                str(updated.get("title") or "").strip(),
                owner_text,
            )
            if part
        )
        updated["multimodal_status"] = "completed"
        updated["owner_text_status"] = "ready"
        updated["owner_text_recovery"] = {
            key: value for key, value in recovered.items() if key != "owner_text"
        }
        enriched.append(updated)
    return enriched


def _build_decisions(
    *,
    units: Sequence[Mapping[str, Any]],
    multimodal_candidate_inventory: Mapping[str, Any],
    queue_trace_by_unit_id: Mapping[str, Mapping[str, Any]],
    generated_at: str,
) -> list[_RegulationDecision]:
    decisions: list[_RegulationDecision] = []
    primary_by_candidate_key: dict[str, _RegulationDecision] = {}
    for unit in units:
        decision = _initial_decision(
            unit=unit,
            multimodal_candidate_inventory=multimodal_candidate_inventory,
            queue_trace_row=queue_trace_by_unit_id.get(str(unit.get("unit_id") or "")),
            generated_at=generated_at,
        )
        if decision.admitted and decision.candidate_key:
            primary = primary_by_candidate_key.get(decision.candidate_key)
            if primary is None:
                primary_by_candidate_key[decision.candidate_key] = decision
            else:
                decision = _duplicate_hold_decision(decision, primary)
        decisions.append(decision)
    return decisions


def _initial_decision(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    queue_trace_row: Mapping[str, Any] | None,
    generated_at: str,
) -> _RegulationDecision:
    reasons: list[str] = []
    title = _regulation_title(unit)
    issuing_org = _issuing_org(unit)
    body_text = str(unit.get("body_text") or "").strip()
    source_refs = list(unit.get("source_object_refs") or ())
    fact_readiness = build_regulation_fact_readiness(
        unit=unit,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        owner_text_ready=_owner_text_status(unit) == "ready",
        body_text_ready=bool(title and body_text and _has_regulation_body_structure(body_text)),
    )
    if not str(unit.get("unit_id") or "").strip():
        reasons.append("missing_searchable_unit_id")
    if not source_refs:
        reasons.append("missing_source_object_refs")
    if reasons:
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_INVALID_CAPTURE,
            consumption_class="invalid_capture",
            reason_codes=reasons,
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=None,
            queue_trace_row=queue_trace_row,
            fact_readiness=fact_readiness,
        )
    if fact_readiness.get("target_admission_state") == REGULATION_CLASS_MANUAL_REVIEW:
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_MANUAL_REVIEW,
            consumption_class="defer",
            reason_codes=("required_media_manual_review",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=_target_collection_for_text(unit),
            queue_trace_row=queue_trace_row,
            fact_readiness=fact_readiness,
        )
    if fact_readiness.get("target_admission_state") == "needs_multimodal":
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_NEEDS_MULTIMODAL,
            consumption_class="needs_multimodal",
            reason_codes=("required_media_pending",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=_target_collection_for_text(unit),
            queue_trace_row=queue_trace_row,
            fact_readiness=fact_readiness,
        )
    if _looks_like_wrapper_notice(unit) and not _has_regulation_body_structure(body_text):
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_WRAPPER_ONLY,
            consumption_class="search_only",
            reason_codes=("wrapper_notice_not_canonical_text",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=None,
            queue_trace_row=queue_trace_row,
            fact_readiness=fact_readiness,
        )
    if _looks_like_draft_or_operational_scheme(unit):
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_MANUAL_REVIEW,
            consumption_class="defer",
            reason_codes=("regulation_candidate_requires_manual_review",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=None,
            queue_trace_row=queue_trace_row,
            fact_readiness=fact_readiness,
        )
    if not title or not body_text or not _has_regulation_body_structure(body_text):
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_MANUAL_REVIEW,
            consumption_class="defer",
            reason_codes=("regulation_candidate_requires_manual_review",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=_target_collection_for_text(unit),
            queue_trace_row=queue_trace_row,
            fact_readiness=fact_readiness,
        )
    if not _has_formal_owner_title(unit):
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_MANUAL_REVIEW,
            consumption_class="defer",
            reason_codes=("regulation_candidate_requires_manual_review",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=_target_collection_for_text(unit),
            queue_trace_row=queue_trace_row,
            fact_readiness=fact_readiness,
        )
    target_collection = _target_collection_for_text(unit)
    if target_collection == SCOPED_TARGET_COLLECTION and _is_historical_annual_cycle_rule(
        unit,
        generated_at=generated_at,
    ):
        hold_reason_codes = (
            "historical_annual_cycle_rule_not_promoted",
            "expired_cycle_year",
            "notice_level_retained",
        )
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_HISTORICAL_ANNUAL_CYCLE_HOLD,
            consumption_class="search_only",
            reason_codes=hold_reason_codes,
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=target_collection,
            queue_trace_row=queue_trace_row,
            fact_readiness=build_policy_hold_fact_readiness(
                unit=unit,
                target=REGULATION_TARGET,
                reason_codes=hold_reason_codes,
            ),
            applicability_status="historical_expired",
            promotion_disposition="hold_in_internal_notice",
            recommended_query_surface="notice_level_query",
            cycle_year=_cycle_year(unit),
        )
    if target_collection == SCOPED_TARGET_COLLECTION and _is_historical_time_window_rule(
        unit,
        generated_at=generated_at,
    ):
        hold_reason_codes = (
            "historical_time_window_rule_not_promoted",
            "expired_time_window",
            "notice_level_retained",
        )
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_HISTORICAL_TIME_WINDOW_HOLD,
            consumption_class="search_only",
            reason_codes=hold_reason_codes,
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=target_collection,
            queue_trace_row=queue_trace_row,
            fact_readiness=build_policy_hold_fact_readiness(
                unit=unit,
                target=REGULATION_TARGET,
                reason_codes=hold_reason_codes,
            ),
            applicability_status="historical_expired",
            promotion_disposition="hold_in_internal_notice",
            recommended_query_surface="notice_level_query",
            cycle_year=_cycle_year(unit),
        )
    if target_collection == SCOPED_TARGET_COLLECTION:
        return _decision(
            unit=unit,
            regulation_admission_class=REGULATION_CLASS_SCOPED,
            consumption_class="downstream_admitted",
            reason_codes=("scoped_rule_candidate_detected",),
            regulation_title=title,
            issuing_org=issuing_org,
            target_collection=target_collection,
            queue_trace_row=queue_trace_row,
            fact_readiness=fact_readiness,
        )
    return _decision(
        unit=unit,
        regulation_admission_class=REGULATION_CLASS_INSTITUTIONAL,
        consumption_class="downstream_admitted",
        reason_codes=("institutional_rule_candidate_detected",),
        regulation_title=title,
        issuing_org=issuing_org,
        target_collection=INSTITUTIONAL_TARGET_COLLECTION,
        queue_trace_row=queue_trace_row,
        fact_readiness=fact_readiness,
    )


def _decision(
    *,
    unit: Mapping[str, Any],
    regulation_admission_class: str,
    consumption_class: str,
    reason_codes: Sequence[str],
    regulation_title: str | None,
    issuing_org: str,
    target_collection: str | None,
    queue_trace_row: Mapping[str, Any] | None,
    fact_readiness: Mapping[str, Any],
    duplicate_primary_source_notice_id: str | None = None,
    duplicate_primary_searchable_unit_id: str | None = None,
    applicability_status: str | None = None,
    promotion_disposition: str | None = None,
    recommended_query_surface: str | None = None,
    cycle_year: str | None = None,
) -> _RegulationDecision:
    candidate_key = (
        _candidate_key(
            regulation_title=regulation_title,
            issuing_org=issuing_org,
            target_collection=target_collection,
        )
        if regulation_title and target_collection
        else None
    )
    target_identity_preview = (
        _target_identity_preview(
            regulation_title=regulation_title,
            issuing_org=issuing_org,
            target_collection=target_collection,
        )
        if regulation_admission_class in {REGULATION_CLASS_INSTITUTIONAL, REGULATION_CLASS_SCOPED}
        and regulation_title
        and target_collection
        else None
    )
    target_surface = (
        f"regulations/{target_collection}"
        if target_identity_preview and target_collection
        else None
    )
    normalized_reason_codes = tuple(dict.fromkeys(str(item) for item in reason_codes if str(item)))
    if _owner_text_status(unit) == "ready":
        normalized_reason_codes = tuple(
            dict.fromkeys((*normalized_reason_codes, "owner_text_recovered"))
        )
    return _RegulationDecision(
        unit=unit,
        regulation_admission_class=regulation_admission_class,
        consumption_class=consumption_class,
        reason_codes=normalized_reason_codes,
        candidate_key=candidate_key,
        regulation_title=regulation_title,
        issuing_org=issuing_org,
        target_collection=target_collection,
        target_surface=target_surface,
        target_identity_preview=target_identity_preview,
        duplicate_primary_source_notice_id=duplicate_primary_source_notice_id,
        duplicate_primary_searchable_unit_id=duplicate_primary_searchable_unit_id,
        queue_trace_row=queue_trace_row,
        fact_readiness=dict(fact_readiness),
        applicability_status=applicability_status,
        promotion_disposition=promotion_disposition,
        recommended_query_surface=recommended_query_surface,
        cycle_year=cycle_year,
    )


def _duplicate_hold_decision(
    decision: _RegulationDecision,
    primary: _RegulationDecision,
) -> _RegulationDecision:
    return _decision(
        unit=decision.unit,
        regulation_admission_class=REGULATION_CLASS_DUPLICATE_HOLD,
        consumption_class="search_only",
        reason_codes=("duplicate_regulation_candidate",),
        regulation_title=decision.regulation_title,
        issuing_org=decision.issuing_org,
        target_collection=decision.target_collection,
        queue_trace_row=decision.queue_trace_row,
        fact_readiness=decision.fact_readiness,
        duplicate_primary_source_notice_id=str(primary.unit.get("source_notice_id") or ""),
        duplicate_primary_searchable_unit_id=str(primary.unit.get("unit_id") or ""),
    )


def _admission_manifest(
    *,
    decisions: Sequence[_RegulationDecision],
    generated_at: str,
    generated_by: str,
    queue_backed: bool,
    evidence_refs: Mapping[str, str],
) -> dict[str, Any]:
    entries = [_admission_entry(decision) for decision in decisions]
    class_counts = Counter(entry["regulation_admission_class"] for entry in entries)
    consumption_counts = Counter(entry["consumption_class"] for entry in entries)
    target_collection_counts = Counter(
        entry.get("target_collection") or "none" for entry in entries
    )
    return {
        "schema_version": ADMISSION_SCHEMA_VERSION,
        "batch_id": "phase6-r1-regulation-candidate-admission",
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_06_R1_ID,
        "target": REGULATION_TARGET,
        "source_scope": {
            "source_notice_ids": [entry["source_notice_id"] for entry in entries],
            "target": REGULATION_TARGET,
            "queue_backed": queue_backed,
        },
        "baseline": "captured_but_not_imported",
        "selection_policy": {
            "name": "phase6-r1-regulation-candidate-admission",
            "version": "v1",
            "queue_backed_required": queue_backed,
        },
        "entries": entries,
        "counts": {
            "entry_count": len(entries),
            "downstream_admitted": consumption_counts.get("downstream_admitted", 0),
            "search_only": consumption_counts.get("search_only", 0),
            "defer": consumption_counts.get("defer", 0),
            "needs_multimodal": consumption_counts.get("needs_multimodal", 0),
            "invalid_capture": consumption_counts.get("invalid_capture", 0),
            "by_regulation_admission_class": dict(sorted(class_counts.items())),
            "by_target_collection": dict(sorted(target_collection_counts.items())),
        },
        "evidence_refs": {
            "searchable_preview": evidence_refs.get("searchable_preview", ""),
            "multimodal_inventory": evidence_refs.get("multimodal_inventory", ""),
            "queue_consume_trace": evidence_refs.get("queue_consume_trace", ""),
            "owner_text_execution_report": evidence_refs.get("owner_text_execution_report", ""),
        },
    }


def _admission_entry(decision: _RegulationDecision) -> dict[str, Any]:
    unit = decision.unit
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
        "consumption_class": decision.consumption_class,
        "regulation_admission_class": decision.regulation_admission_class,
        "target": REGULATION_TARGET if decision.admitted else None,
        "target_surface": decision.target_surface,
        "target_collection": decision.target_collection,
        "target_identity_preview": decision.target_identity_preview,
        "candidate_key": decision.candidate_key,
        "regulation_title_normalized": decision.regulation_title,
        "issuing_org": decision.issuing_org,
        "cycle_year": decision.cycle_year,
        "applicability_status": decision.applicability_status,
        "promotion_disposition": decision.promotion_disposition,
        "recommended_query_surface": decision.recommended_query_surface,
        "duplicate_primary_source_notice_id": decision.duplicate_primary_source_notice_id,
        "duplicate_primary_searchable_unit_id": decision.duplicate_primary_searchable_unit_id,
        "target_hints": unit.get("target_hints") or {},
        "multimodal_policy": _multimodal_policy(unit),
        "owner_text_status": _owner_text_status(unit),
        "owner_text_recovery": unit.get("owner_text_recovery") or {},
        **fact_readiness_entry_fields(decision.fact_readiness),
        "reason_codes": list(decision.reason_codes),
        "preconditions": _preconditions(decision),
        "searchable_unit_id": unit.get("unit_id"),
    }


def _candidate_audit(
    *,
    decisions: Sequence[_RegulationDecision],
    generated_at: str,
    generated_by: str,
    queue_backed: bool,
) -> dict[str, Any]:
    candidates = [_audit_row(decision) for decision in decisions]
    return {
        "schema_version": CANDIDATE_AUDIT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_06_R1_ID,
        "target": REGULATION_TARGET,
        "queue_backed": queue_backed,
        "candidate_count": len(candidates),
        "class_counts": dict(
            sorted(Counter(row["regulation_admission_class"] for row in candidates).items())
        ),
        "candidates": candidates,
    }


def _audit_row(decision: _RegulationDecision) -> dict[str, Any]:
    unit = decision.unit
    return {
        "source_notice_id": unit.get("source_notice_id"),
        "source_surface": unit.get("source_surface"),
        "source_document_id": unit.get("source_document_id"),
        "searchable_unit_id": unit.get("unit_id"),
        "title": unit.get("title"),
        "regulation_title_normalized": decision.regulation_title,
        "issuing_org": decision.issuing_org,
        "candidate_key": decision.candidate_key,
        "regulation_admission_class": decision.regulation_admission_class,
        "consumption_class": decision.consumption_class,
        "target_collection": decision.target_collection,
        "target_identity_preview": decision.target_identity_preview,
        "cycle_year": decision.cycle_year,
        "applicability_status": decision.applicability_status,
        "promotion_disposition": decision.promotion_disposition,
        "recommended_query_surface": decision.recommended_query_surface,
        "duplicate_primary_source_notice_id": decision.duplicate_primary_source_notice_id,
        "duplicate_primary_searchable_unit_id": decision.duplicate_primary_searchable_unit_id,
        "reason_codes": list(decision.reason_codes),
        "owner_text_status": _owner_text_status(unit),
        "owner_text_recovery": unit.get("owner_text_recovery") or {},
        "fact_readiness_state": decision.fact_readiness["fact_readiness_state"],
        "target_admission_state": decision.fact_readiness["target_admission_state"],
        "source_object_refs": list(unit.get("source_object_refs") or ()),
        "source_url": unit.get("source_url"),
    }


def _rejected_deferred_source_report(
    *,
    decisions: Sequence[_RegulationDecision],
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
                "candidate_target": REGULATION_TARGET,
                "regulation_admission_class": decision.regulation_admission_class,
                "consumption_class": decision.consumption_class,
                "reason_codes": list(decision.reason_codes),
                "cycle_year": decision.cycle_year,
                "applicability_status": decision.applicability_status,
                "promotion_disposition": decision.promotion_disposition,
                "recommended_query_surface": decision.recommended_query_surface,
                "searchable_exists": bool(unit.get("unit_id")),
                "source_object_ref_count": len(unit.get("source_object_refs") or ()),
                "multimodal_processing_could_change_decision": (
                    decision.regulation_admission_class == REGULATION_CLASS_NEEDS_MULTIMODAL
                ),
                "duplicate_primary_source_notice_id": decision.duplicate_primary_source_notice_id,
            }
        )
    return {
        "schema_version": REJECTED_DEFERRED_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_06_R1_ID,
        "target": REGULATION_TARGET,
        "entry_count": len(entries),
        "entries": entries,
    }


def _source_to_searchable_trace(
    *,
    decisions: Sequence[_RegulationDecision],
    generated_at: str,
    generated_by: str,
    queue_backed: bool,
) -> dict[str, Any]:
    entries = [_source_trace_entry(decision) for decision in decisions]
    return {
        "schema_version": SOURCE_TRACE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_06_R1_ID,
        "target": REGULATION_TARGET,
        "queue_backed": queue_backed,
        "entry_count": len(entries),
        "entries": entries,
    }


def _source_trace_entry(decision: _RegulationDecision) -> dict[str, Any]:
    unit = decision.unit
    queue_trace_row = dict(decision.queue_trace_row or {})
    return {
        "source_notice_id": unit.get("source_notice_id"),
        "source_surface": unit.get("source_surface"),
        "source_document_id": unit.get("source_document_id"),
        "searchable_unit_id": unit.get("unit_id"),
        "source_url": unit.get("source_url"),
        "source_object_refs": list(unit.get("source_object_refs") or ()),
        "queue_job_id": queue_trace_row.get("job_id"),
        "queue_replay_batch_id": queue_trace_row.get("replay_batch_id"),
        "queue_source_object_refs": list(queue_trace_row.get("source_object_refs") or ()),
        "regulation_admission_class": decision.regulation_admission_class,
        "consumption_class": decision.consumption_class,
        "candidate_key": decision.candidate_key,
        "target_identity_preview": decision.target_identity_preview,
        "owner_text_status": _owner_text_status(unit),
    }


__all__ = [
    "PHASE_06_R1_ID",
    "CollectedNoticeRegulationAdmissionPreview",
    "RegulationOwnerTextObjectStoreReader",
    "build_collected_notice_regulation_admission_preview",
    "build_collected_notice_regulation_admission_preview_from_paths",
    "build_recovered_owner_text_by_unit_from_execution_report",
    "build_recovered_owner_text_by_unit_from_execution_reports",
    "preview_to_output_files",
]
