from __future__ import annotations

from campus_ingestion_worker.official_web_handoff_consumer_io import (
    normalize_string_list,
    optional_text,
    require_object_list,
    require_text,
)


def _candidate_admission_action(
    *,
    consumer_family: str,
    materialization_policy: str,
) -> str:
    if materialization_policy == "inventory_only" or consumer_family == "notice_news_candidate":
        return "inventory_only"
    if materialization_policy == "release_gate_required":
        return "release_gate_required"
    return "selected_write_review_required"


def _candidate_blocked_reason(
    *,
    admission_action: str,
    field_status: dict[str, str],
    quality_gate: dict[object, object],
    required_fields: list[str],
    review_verdict: str,
    typed_candidate: dict[object, object],
    typed_candidate_schema_version: str | None,
) -> str:
    if admission_action == "inventory_only":
        return "inventory_only_until_runtime_admission"
    if admission_action == "release_gate_required":
        return "release_gate_required_before_current_truth"
    if not required_fields:
        return "target_inventory_required_fields_missing"
    if str(quality_gate.get("decision") or "") != "pass":
        return "machine_review_candidate_failed_quality_gate"
    if not typed_candidate_schema_version or not typed_candidate:
        return "machine_review_candidate_missing_typed_candidate"
    if _has_blocking_field_status(field_status=field_status, required_fields=required_fields):
        return "machine_field_review_blocked"
    if review_verdict == "needs_more_evidence":
        return "review_marked_needs_more_evidence"
    return "machine_field_review_required_before_selected_write"


def _build_selected_write_admission_preview(
    *,
    candidate_count: int,
    ready_count: int,
    rejected_count: int,
    pending_count: int,
    blocked_count: int,
    ready_candidates: list[dict[str, object]],
) -> dict[str, object]:
    if candidate_count == 0:
        return {
            "decision": "not_applicable",
            "ready_record_count": 0,
            "rejected_record_count": 0,
            "pending_record_count": 0,
            "blocked_record_count": 0,
            "reason": "no_selected_write_candidates",
            "preview_records": [],
        }
    if ready_count == 0 and rejected_count == candidate_count:
        decision = "no_ready_records"
        reason = "all_candidates_rejected"
    elif ready_count > 0 and blocked_count > 0:
        decision = "partial_dry_run_ready"
        reason = "machine_field_review_partially_passed"
    elif ready_count > 0:
        decision = "dry_run_ready"
        reason = "machine_field_review_passed"
    else:
        decision = "blocked"
        reason = "machine_field_review_blocked"
    return {
        "decision": decision,
        "ready_record_count": ready_count,
        "rejected_record_count": rejected_count,
        "pending_record_count": pending_count,
        "blocked_record_count": blocked_count,
        "reason": reason,
        "preview_records": [
            _selected_write_preview_record(candidate) for candidate in ready_candidates
        ],
    }


def _review_verdicts(
    *,
    consumer_review_manifest: dict[str, object] | None,
    replay_report: dict[str, object],
) -> dict[str, dict[str, object]]:
    if consumer_review_manifest is None:
        return {}
    if consumer_review_manifest.get("schema_version") != (
        "official_web_selected_write_review_manifest.v1"
    ):
        raise ValueError("unsupported official web selected-write review manifest schema_version")
    site_id = require_text(replay_report.get("site_id"), "site_id")
    run_id = require_text(replay_report.get("crawl_run_id"), "crawl_run_id")
    if require_text(consumer_review_manifest.get("site_id"), "site_id") != site_id:
        raise ValueError("consumer review manifest site_id does not match replay report")
    if require_text(consumer_review_manifest.get("run_id"), "run_id") != run_id:
        raise ValueError("consumer review manifest run_id does not match replay report")
    verdicts: dict[str, dict[str, object]] = {}
    for verdict in require_object_list(consumer_review_manifest.get("verdicts"), "verdicts"):
        candidate_key = require_text(verdict.get("candidate_key"), "candidate_key")
        normalized_verdict = require_text(verdict.get("verdict"), "verdict")
        if normalized_verdict not in {"approved", "rejected", "needs_more_evidence"}:
            raise ValueError(f"unsupported consumer review verdict: {normalized_verdict}")
        if candidate_key in verdicts:
            raise ValueError(f"duplicate consumer review verdict: {candidate_key}")
        verdicts[candidate_key] = verdict
    return verdicts


def _candidate_review_verdict(
    *,
    admission_action: str,
    candidate_key: str,
    verdicts: dict[str, dict[str, object]],
) -> str:
    if admission_action == "inventory_only":
        return "inventory_only"
    if admission_action == "release_gate_required":
        return "pending_review"
    verdict = verdicts.get(candidate_key)
    if verdict is None:
        return "pending_review"
    return require_text(verdict.get("verdict"), "verdict")


def _ready_for_selected_write(
    *,
    admission_action: str,
    field_status: dict[str, str],
    required_fields: list[str],
    review_verdict: str,
    quality_gate: dict[object, object],
    typed_candidate: dict[object, object],
    typed_candidate_schema_version: str | None,
) -> bool:
    return (
        admission_action == "selected_write_review_required"
        and review_verdict not in {"rejected", "needs_more_evidence"}
        and str(quality_gate.get("decision") or "") == "pass"
        and bool(typed_candidate_schema_version)
        and bool(typed_candidate)
        and bool(field_status)
        and bool(required_fields)
        and all(field_status.get(field_name) == "present" for field_name in required_fields)
    )


def _has_blocking_field_status(
    *,
    field_status: dict[str, object],
    required_fields: list[str],
) -> bool:
    if not required_fields:
        return True
    return any(
        str(field_status.get(field_name) or "missing") in {"missing", "ambiguous"}
        for field_name in required_fields
    )


def _is_selected_write_candidate(candidate: dict[str, object]) -> bool:
    return (
        str(candidate.get("materialization_policy") or "") == "candidate_only"
        and optional_text(candidate.get("selected_write_target")) is not None
    )


def _selected_write_preview_record(candidate: dict[str, object]) -> dict[str, object]:
    selected_write_target = require_text(
        candidate.get("selected_write_target"),
        "selected_write_target",
    )
    target_corpus, target_collection = selected_write_target.split("/", 1)
    return {
        "candidate_key": require_text(candidate.get("candidate_key"), "candidate_key"),
        "field_status": dict(candidate.get("field_status"))
        if isinstance(candidate.get("field_status"), dict)
        else {},
        "inventory_id": optional_text(candidate.get("inventory_id")),
        "matched_evidence": normalize_string_list(candidate.get("matched_evidence")),
        "normalized_canonical_url": require_text(
            candidate.get("normalized_canonical_url"),
            "normalized_canonical_url",
        ),
        "optional_evidence": normalize_string_list(candidate.get("optional_evidence")),
        "optional_fields": normalize_string_list(candidate.get("optional_fields")),
        "ready_for_selected_write": bool(candidate.get("ready_for_selected_write")),
        "required_evidence": normalize_string_list(candidate.get("required_evidence")),
        "required_fields": normalize_string_list(candidate.get("required_fields")),
        "review_verdict": require_text(candidate.get("review_verdict"), "review_verdict"),
        "selected_write_target": selected_write_target,
        "source_ref": candidate.get("source_ref"),
        "target_id": optional_text(candidate.get("target_id")),
        "target_job_id": optional_text(candidate.get("target_job_id")),
        "target_label": optional_text(candidate.get("target_label")),
        "target_corpus": target_corpus,
        "target_collection": target_collection,
        "typed_candidate_schema_version": candidate.get("typed_candidate_schema_version"),
        "typed_candidate": candidate.get("typed_candidate"),
    }
