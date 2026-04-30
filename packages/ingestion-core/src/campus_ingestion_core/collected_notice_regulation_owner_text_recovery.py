from __future__ import annotations

import json
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_regulation_owner_text_recovery_constants import (
    DEFAULT_REGULATION_OWNER_TEXT_MEDIA_KINDS,
    DEFAULT_REGULATION_OWNER_TEXT_RECOVERY_BATCH_LIMIT,
    DEFAULT_REGULATION_OWNER_TEXT_SOURCE_SURFACES,
    PHASE_05_ID,
    PHASE_06_R1_ID,
    PHASE_06_R1A_ID,
    PHASE_06_R2_ID,
    REGULATION_OWNER_TEXT_ATTEMPT_PLAN_SCHEMA_VERSION,
    REGULATION_OWNER_TEXT_READINESS_GAP_REPORT_SCHEMA_VERSION,
    REGULATION_OWNER_TEXT_RECOVERY_BATCH_SCHEMA_VERSION,
    REGULATION_OWNER_TEXT_RECOVERY_TARGET,
    REGULATION_OWNER_TEXT_SEARCHABLE_MERGE_CONTRACT_SCHEMA_VERSION,
)
from campus_ingestion_core.collected_notice_regulation_owner_text_recovery_models import (
    CollectedNoticeRegulationOwnerTextRecoveryPreview,
)


def build_collected_notice_regulation_owner_text_recovery_preview_from_paths(
    *,
    regulation_admission_manifest_path: Path,
    multimodal_candidate_inventory_path: Path,
    limit: int = DEFAULT_REGULATION_OWNER_TEXT_RECOVERY_BATCH_LIMIT,
    generated_by: str = (
        "campus_ingestion_worker.preview_collected_notice_regulation_owner_text_recovery"
    ),
) -> CollectedNoticeRegulationOwnerTextRecoveryPreview:
    return build_collected_notice_regulation_owner_text_recovery_preview(
        regulation_admission_manifest=_load_json_object(regulation_admission_manifest_path),
        multimodal_candidate_inventory=_load_json_object(multimodal_candidate_inventory_path),
        limit=limit,
        generated_by=generated_by,
        evidence_refs={
            "regulation_admission_manifest": str(regulation_admission_manifest_path),
            "multimodal_candidate_inventory": str(multimodal_candidate_inventory_path),
        },
    )


def build_collected_notice_regulation_owner_text_recovery_preview(
    *,
    regulation_admission_manifest: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    limit: int = DEFAULT_REGULATION_OWNER_TEXT_RECOVERY_BATCH_LIMIT,
    source_surfaces: Sequence[str] = DEFAULT_REGULATION_OWNER_TEXT_SOURCE_SURFACES,
    media_kinds: Sequence[str] = DEFAULT_REGULATION_OWNER_TEXT_MEDIA_KINDS,
    generated_at: str | None = None,
    generated_by: str = (
        "campus_ingestion_worker.preview_collected_notice_regulation_owner_text_recovery"
    ),
    evidence_refs: Mapping[str, str] | None = None,
) -> CollectedNoticeRegulationOwnerTextRecoveryPreview:
    timestamp = generated_at or utc_now()
    normalized_limit = max(0, int(limit))
    source_surface_set = _normalized_filter(source_surfaces)
    media_kind_set = _normalized_filter(media_kinds)
    candidates_by_unit = _candidates_by_unit(multimodal_candidate_inventory)
    needs_multimodal_entries = [
        dict(entry)
        for entry in _mapping_rows(regulation_admission_manifest.get("entries"))
        if str(entry.get("regulation_admission_class") or "") == "needs_multimodal"
    ]
    in_scope_entries: list[dict[str, Any]] = []
    deferred: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    eligible_attempts: list[dict[str, Any]] = []

    for entry in needs_multimodal_entries:
        if str(entry.get("source_surface") or "") not in source_surface_set:
            deferred.append(
                _deferred_row(entry=entry, reason_codes=("source_surface_out_of_scope",))
            )
            continue
        in_scope_entries.append(entry)
        entry_candidates = _regulation_candidates_for_entry(
            entry=entry,
            candidates_by_unit=candidates_by_unit,
        )
        if not entry_candidates:
            gaps.append(_gap_row(entry=entry, reason_codes=("no_matching_multimodal_candidate",)))
            continue
        accepted_for_entry = 0
        for candidate in entry_candidates:
            candidate_gap_reasons = _candidate_gap_reasons(
                candidate=candidate,
                media_kind_set=media_kind_set,
            )
            if candidate_gap_reasons:
                gaps.append(
                    _gap_row(
                        entry=entry,
                        candidate=candidate,
                        reason_codes=candidate_gap_reasons,
                    )
                )
                continue
            eligible_attempts.append(_attempt_seed(entry=entry, candidate=candidate))
            accepted_for_entry += 1
        if accepted_for_entry == 0 and not any(
            row.get("source_notice_id") == entry.get("source_notice_id") for row in gaps
        ):
            gaps.append(_gap_row(entry=entry, reason_codes=("no_recoverable_media_candidate",)))

    ordered_attempts = sorted(eligible_attempts, key=_attempt_sort_key)
    selected_attempts = ordered_attempts[:normalized_limit]
    limit_deferred = [
        _deferred_row(
            entry=attempt["entry"],
            candidate=attempt["candidate"],
            reason_codes=("batch_limit_deferred",),
        )
        for attempt in ordered_attempts[normalized_limit:]
    ]
    all_deferred = deferred + limit_deferred
    return CollectedNoticeRegulationOwnerTextRecoveryPreview(
        batch_manifest=_batch_manifest(
            generated_at=timestamp,
            generated_by=generated_by,
            limit=normalized_limit,
            source_surfaces=source_surface_set,
            media_kinds=media_kind_set,
            needs_multimodal_entries=needs_multimodal_entries,
            in_scope_entries=in_scope_entries,
            eligible_attempts=ordered_attempts,
            selected_attempts=selected_attempts,
            gaps=gaps,
            deferred=all_deferred,
            evidence_refs=dict(evidence_refs or {}),
        ),
        attempt_plan=_attempt_plan(
            generated_at=timestamp,
            generated_by=generated_by,
            selected_attempts=selected_attempts,
        ),
        searchable_merge_contract=_searchable_merge_contract(
            generated_at=timestamp,
            generated_by=generated_by,
            selected_attempts=selected_attempts,
        ),
        readiness_gap_report=_readiness_gap_report(
            generated_at=timestamp,
            generated_by=generated_by,
            gaps=gaps,
            deferred=all_deferred,
            needs_multimodal_entries=needs_multimodal_entries,
            in_scope_entries=in_scope_entries,
        ),
    )


def preview_to_output_files(
    preview: CollectedNoticeRegulationOwnerTextRecoveryPreview,
) -> dict[str, dict[str, Any]]:
    return {
        "regulation-owner-text-recovery-batch-manifest.json": preview.batch_manifest,
        "regulation-owner-text-attempt-plan.json": preview.attempt_plan,
        "regulation-owner-text-searchable-merge-contract.json": (preview.searchable_merge_contract),
        "regulation-owner-text-readiness-gap-report.json": preview.readiness_gap_report,
    }


def _batch_manifest(
    *,
    generated_at: str,
    generated_by: str,
    limit: int,
    source_surfaces: frozenset[str],
    media_kinds: frozenset[str],
    needs_multimodal_entries: Sequence[Mapping[str, Any]],
    in_scope_entries: Sequence[Mapping[str, Any]],
    eligible_attempts: Sequence[Mapping[str, Any]],
    selected_attempts: Sequence[Mapping[str, Any]],
    gaps: Sequence[Mapping[str, Any]],
    deferred: Sequence[Mapping[str, Any]],
    evidence_refs: Mapping[str, str],
) -> dict[str, Any]:
    selected_candidates = [attempt["candidate"] for attempt in selected_attempts]
    batches = []
    if selected_attempts:
        batches.append(
            {
                "batch_id": "phase6-r1a-regulation-owner-text-001",
                "target": REGULATION_OWNER_TEXT_RECOVERY_TARGET,
                "attempt_count": len(selected_attempts),
                "candidate_ids": [
                    str(attempt["candidate"].get("candidate_id") or "")
                    for attempt in selected_attempts
                ],
                "source_notice_ids": [
                    str(attempt["entry"].get("source_notice_id") or "")
                    for attempt in selected_attempts
                ],
                "media_kinds": sorted(
                    {
                        str(attempt["candidate"].get("media_kind") or "")
                        for attempt in selected_attempts
                    }
                ),
                "target_collections": sorted(
                    {
                        str(attempt["entry"].get("target_collection") or "")
                        for attempt in selected_attempts
                    }
                ),
            }
        )
    return {
        "schema_version": REGULATION_OWNER_TEXT_RECOVERY_BATCH_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "provider_calls_enabled": False,
        "object_store_writes_enabled": False,
        "db_writes_enabled": False,
        "phase": PHASE_06_R1A_ID,
        "target": REGULATION_OWNER_TEXT_RECOVERY_TARGET,
        "source_scope": {
            "source_surfaces": sorted(source_surfaces),
            "media_kinds": sorted(media_kinds),
            "source_notice_ids": [
                str(attempt["entry"].get("source_notice_id") or "") for attempt in selected_attempts
            ],
        },
        "selection_policy": {
            "name": "regulation-owner-text-recovery-mini-batch",
            "version": "v1",
            "required_regulation_admission_class": "needs_multimodal",
            "required_candidate_status": "pending_or_failed_retryable",
            "required_target_hint": "regulation",
            "source_surfaces": sorted(source_surfaces),
            "media_kinds": sorted(media_kinds),
            "limit": limit,
            "sort_order": [
                "priority_desc",
                "source_surface",
                "source_object_byte_size_asc",
                "media_kind",
                "source_notice_id",
                "candidate_id",
            ],
        },
        "batches": batches,
        "counts": {
            "needs_multimodal_entry_count": len(needs_multimodal_entries),
            "in_scope_needs_multimodal_count": len(in_scope_entries),
            "eligible_attempt_count": len(eligible_attempts),
            "selected_attempt_count": len(selected_attempts),
            "batch_limit_deferred_count": sum(
                1 for row in deferred if row.get("reason_codes") == ["batch_limit_deferred"]
            ),
            "gap_count": len(gaps),
            "deferred_count": len(deferred),
            "by_selected_media_kind": dict(
                sorted(
                    Counter(
                        str(item.get("media_kind") or "") for item in selected_candidates
                    ).items()
                )
            ),
            "by_selected_target_collection": dict(
                sorted(
                    Counter(
                        str(attempt["entry"].get("target_collection") or "")
                        for attempt in selected_attempts
                    ).items()
                )
            ),
        },
        "evidence_refs": {
            "regulation_admission_manifest": evidence_refs.get("regulation_admission_manifest", ""),
            "multimodal_candidate_inventory": evidence_refs.get(
                "multimodal_candidate_inventory", ""
            ),
        },
    }


def _attempt_plan(
    *,
    generated_at: str,
    generated_by: str,
    selected_attempts: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    attempts = [_attempt_plan_entry(attempt) for attempt in selected_attempts]
    return {
        "schema_version": REGULATION_OWNER_TEXT_ATTEMPT_PLAN_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "provider_calls_enabled": False,
        "object_store_writes_enabled": False,
        "db_writes_enabled": False,
        "phase": PHASE_06_R1A_ID,
        "target": REGULATION_OWNER_TEXT_RECOVERY_TARGET,
        "attempt_count": len(attempts),
        "attempts": attempts,
    }


def _attempt_plan_entry(attempt: Mapping[str, Any]) -> dict[str, Any]:
    entry = attempt["entry"]
    candidate = attempt["candidate"]
    normalized_output_refs = dict(candidate.get("normalized_output_refs") or {})
    candidate_status = str(candidate.get("status") or "")
    state = "retry_planned" if candidate_status == "failed_retryable" else "planned"
    action = (
        "retry_regulation_owner_text"
        if candidate_status == "failed_retryable"
        else "recover_regulation_owner_text"
    )
    return {
        "attempt_id": f"{candidate.get('candidate_id')}:owner-text:attempt:1",
        "candidate_id": candidate.get("candidate_id"),
        "source_notice_id": entry.get("source_notice_id"),
        "source_surface": entry.get("source_surface"),
        "searchable_unit_id": entry.get("searchable_unit_id"),
        "source_document_id": entry.get("source_document_id"),
        "title": entry.get("title"),
        "regulation_title_normalized": entry.get("regulation_title_normalized"),
        "candidate_key": entry.get("candidate_key"),
        "target_collection": entry.get("target_collection"),
        "media_ref_id": candidate.get("media_ref_id"),
        "media_kind": candidate.get("media_kind"),
        "processing_family": candidate.get("processing_family"),
        "priority": candidate.get("priority"),
        "state": state,
        "action": action,
        "attempt_number": 1,
        "provider": "pending_runtime_config",
        "model": "pending_runtime_config",
        "provider_model_required": True,
        "source_object_ref": dict(candidate.get("source_object_ref") or {}),
        "source_object_refs": list(entry.get("source_object_refs") or ()),
        "attempt_ledger": dict(candidate.get("attempt_ledger") or {}),
        "normalized_output_refs": normalized_output_refs,
        "owner_text_output_ref": normalized_output_refs.get("plain_text"),
        "provider_response_output_ref": normalized_output_refs.get("provider_response"),
        "layout_elements_output_ref": normalized_output_refs.get("layout_elements"),
        "searchable_merge_input_ref": normalized_output_refs.get("searchable_merge_input"),
        "required_outputs": [
            "provider_response",
            "owner_text",
            "layout_elements",
            "searchable_merge_input",
        ],
        "post_recovery_rerun": _post_recovery_rerun(),
        "provenance": {
            "phase5_candidate_provenance": dict(candidate.get("provenance") or {}),
            "phase6r1_admission_entry_id": entry.get("entry_id"),
        },
    }


def _searchable_merge_contract(
    *,
    generated_at: str,
    generated_by: str,
    selected_attempts: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    units = []
    for attempt in selected_attempts:
        attempt_entry = _attempt_plan_entry(attempt)
        units.append(
            {
                "source_notice_id": attempt_entry["source_notice_id"],
                "source_surface": attempt_entry["source_surface"],
                "searchable_unit_id": attempt_entry["searchable_unit_id"],
                "source_document_id": attempt_entry["source_document_id"],
                "title": attempt_entry["title"],
                "candidate_id": attempt_entry["candidate_id"],
                "candidate_key": attempt_entry["candidate_key"],
                "target_collection": attempt_entry["target_collection"],
                "current_regulation_admission_class": "needs_multimodal",
                "required_owner_text_status": "ready",
                "owner_text_input_ref": attempt_entry["owner_text_output_ref"],
                "layout_elements_input_ref": attempt_entry["layout_elements_output_ref"],
                "searchable_merge_input_ref": attempt_entry["searchable_merge_input_ref"],
                "admission_rerun_preconditions": [
                    "owner_text_recovered",
                    "searchable_merge_input_written",
                    "phase6r1_regulation_admission_rerun_required",
                ],
            }
        )
    return {
        "schema_version": REGULATION_OWNER_TEXT_SEARCHABLE_MERGE_CONTRACT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "provider_calls_enabled": False,
        "object_store_writes_enabled": False,
        "db_writes_enabled": False,
        "phase": PHASE_06_R1A_ID,
        "target": REGULATION_OWNER_TEXT_RECOVERY_TARGET,
        "unit_count": len(units),
        "units": units,
        "rerun_contract": _post_recovery_rerun(),
    }


def _readiness_gap_report(
    *,
    generated_at: str,
    generated_by: str,
    gaps: Sequence[Mapping[str, Any]],
    deferred: Sequence[Mapping[str, Any]],
    needs_multimodal_entries: Sequence[Mapping[str, Any]],
    in_scope_entries: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    return {
        "schema_version": REGULATION_OWNER_TEXT_READINESS_GAP_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "provider_calls_enabled": False,
        "object_store_writes_enabled": False,
        "db_writes_enabled": False,
        "phase": PHASE_06_R1A_ID,
        "target": REGULATION_OWNER_TEXT_RECOVERY_TARGET,
        "needs_multimodal_entry_count": len(needs_multimodal_entries),
        "in_scope_needs_multimodal_count": len(in_scope_entries),
        "gap_count": len(gaps),
        "deferred_count": len(deferred),
        "counts_by_gap_reason": _reason_counter(gaps),
        "counts_by_deferred_reason": _reason_counter(deferred),
        "gaps": [dict(row) for row in gaps],
        "deferred": [dict(row) for row in deferred],
    }


def _regulation_candidates_for_entry(
    *,
    entry: Mapping[str, Any],
    candidates_by_unit: Mapping[str, Sequence[Mapping[str, Any]]],
) -> list[dict[str, Any]]:
    unit_id = str(entry.get("searchable_unit_id") or "").strip()
    candidates = [
        dict(candidate)
        for candidate in candidates_by_unit.get(unit_id, ())
        if "regulation" in _target_hints(candidate)
    ]
    return sorted(candidates, key=lambda item: str(item.get("candidate_id") or ""))


def _candidate_gap_reasons(
    *,
    candidate: Mapping[str, Any],
    media_kind_set: frozenset[str],
) -> tuple[str, ...]:
    reasons: list[str] = []
    status = str(candidate.get("status") or "")
    if status == "manual_review":
        reasons.append("manual_review_required")
    elif status not in {"pending", "failed_retryable"}:
        reasons.append("candidate_not_active_recoverable")
    if str(candidate.get("media_kind") or "") not in media_kind_set:
        reasons.append("unsupported_media_kind")
    source_ref = candidate.get("source_object_ref")
    if not isinstance(source_ref, Mapping) or not str(source_ref.get("key") or "").strip():
        reasons.append("missing_source_object_ref")
    return tuple(dict.fromkeys(reasons))


def _attempt_seed(
    *,
    entry: Mapping[str, Any],
    candidate: Mapping[str, Any],
) -> dict[str, Any]:
    return {"entry": dict(entry), "candidate": dict(candidate)}


def _gap_row(
    *,
    entry: Mapping[str, Any],
    reason_codes: Sequence[str],
    candidate: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return _issue_row(
        entry=entry,
        candidate=candidate,
        reason_codes=reason_codes,
        issue_class="gap",
    )


def _deferred_row(
    *,
    entry: Mapping[str, Any],
    reason_codes: Sequence[str],
    candidate: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return _issue_row(
        entry=entry,
        candidate=candidate,
        reason_codes=reason_codes,
        issue_class="deferred",
    )


def _issue_row(
    *,
    entry: Mapping[str, Any],
    reason_codes: Sequence[str],
    issue_class: str,
    candidate: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "issue_class": issue_class,
        "source_notice_id": entry.get("source_notice_id"),
        "source_surface": entry.get("source_surface"),
        "searchable_unit_id": entry.get("searchable_unit_id"),
        "title": entry.get("title"),
        "candidate_key": entry.get("candidate_key"),
        "target_collection": entry.get("target_collection"),
        "candidate_id": (candidate or {}).get("candidate_id"),
        "media_kind": (candidate or {}).get("media_kind"),
        "candidate_status": (candidate or {}).get("status"),
        "reason_codes": list(dict.fromkeys(str(item) for item in reason_codes if str(item))),
    }


def _candidates_by_unit(
    multimodal_candidate_inventory: Mapping[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in _mapping_rows(multimodal_candidate_inventory.get("candidates")):
        unit_id = str(candidate.get("unit_id") or "").strip()
        if unit_id:
            result[unit_id].append(dict(candidate))
    return result


def _attempt_sort_key(attempt: Mapping[str, Any]) -> tuple[object, ...]:
    entry = attempt["entry"]
    candidate = attempt["candidate"]
    source_ref = candidate.get("source_object_ref")
    byte_size = None
    if isinstance(source_ref, Mapping):
        byte_size = source_ref.get("byte_size")
    return (
        _priority_rank(str(candidate.get("priority") or "")),
        str(entry.get("source_surface") or ""),
        _numeric_or_large(byte_size),
        str(candidate.get("media_kind") or ""),
        _numeric_or_text(entry.get("source_notice_id")),
        str(candidate.get("candidate_id") or ""),
    )


def _priority_rank(priority: str) -> int:
    if priority == "high":
        return 0
    if priority == "normal":
        return 1
    return 2


def _numeric_or_large(value: object) -> int:
    try:
        parsed = int(str(value))
    except (TypeError, ValueError):
        return 10**18
    return parsed if parsed >= 0 else 10**18


def _numeric_or_text(value: object) -> tuple[int, int | str]:
    text = str(value or "")
    try:
        return (0, int(text))
    except ValueError:
        return (1, text)


def _target_hints(candidate: Mapping[str, Any]) -> list[str]:
    raw = candidate.get("target_hints")
    if not isinstance(raw, Sequence) or isinstance(raw, str):
        return []
    return [str(item).strip() for item in raw if str(item).strip()]


def _normalized_filter(values: Sequence[str]) -> frozenset[str]:
    return frozenset(str(item).strip() for item in values if str(item).strip())


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, str):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


def _reason_counter(rows: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for row in rows:
        for reason in row.get("reason_codes") or ():
            counter[str(reason)] += 1
    return dict(sorted(counter.items()))


def _post_recovery_rerun() -> dict[str, Any]:
    return {
        "required": True,
        "owner_text_gate": "owner_text_ready",
        "steps": [
            PHASE_05_ID,
            PHASE_06_R1_ID,
            PHASE_06_R2_ID,
        ],
        "downstream_admission_requires": [
            "owner_text_ready",
            "regulation_candidate_audit_passed",
            "phase6r2_gated_materialization_required",
        ],
    }


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


__all__ = [
    "PHASE_06_R1A_ID",
    "CollectedNoticeRegulationOwnerTextRecoveryPreview",
    "build_collected_notice_regulation_owner_text_recovery_preview",
    "build_collected_notice_regulation_owner_text_recovery_preview_from_paths",
    "preview_to_output_files",
]
