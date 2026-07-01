from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.campus_agent_ingestion_reporting import utc_now

AUTHENTICATED_NOTICE_CHILD_TASK_CONTRACT_SCHEMA_VERSION = (
    "authenticated_notice_child_task_state_contract.v1"
)
AUTHENTICATED_NOTICE_PROGRESS_EVENT_SCHEMA_VERSION = "authenticated_notice_progress_event.v1"

CHILD_TASK_KINDS = frozenset(
    (
        "source_unit_import",
        "media_candidate_evaluation",
        "ocr_table_extraction",
        "multimodal_enrichment",
        "fact_readiness_evaluation",
        "target_admission",
        "downstream_materialization",
        "cleanup_evaluation",
        "smoke_assertion",
    )
)
CHILD_TASK_STATES = frozenset(
    (
        "pending",
        "running",
        "completed",
        "skipped",
        "failed_retryable",
        "failed_terminal",
        "manual_review",
        "cancelled",
    )
)

_STATE_SEVERITY = {
    "pending": "none",
    "running": "none",
    "completed": "none",
    "skipped": "none",
    "cancelled": "low",
    "failed_retryable": "medium",
    "manual_review": "medium",
    "failed_terminal": "high",
}
_SEVERITY_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3}


def build_child_task(
    *,
    parent_job_id: str,
    run_id: str,
    task_kind: str,
    processor_profile_id: str,
    state: str,
    source_unit_id: str = "",
    media_ref_id: str = "",
    target_id: str = "",
    attempt_ordinal: int = 1,
    reason_code: str = "",
    retry_budget: Mapping[str, Any] | None = None,
    next_retry_after: str | None = None,
    input_refs: Sequence[Mapping[str, Any]] | None = None,
    output_refs: Sequence[Mapping[str, Any]] | None = None,
    progress_event_refs: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    normalized_parent_job_id = _required_text(parent_job_id, "parent_job_id")
    normalized_run_id = _required_text(run_id, "run_id")
    normalized_task_kind = _normalize_task_kind(task_kind)
    normalized_profile_id = _required_text(processor_profile_id, "processor_profile_id")
    normalized_state = _normalize_state(state)
    normalized_attempt = _positive_int(attempt_ordinal, "attempt_ordinal")
    normalized_reason = str(reason_code or "").strip()
    source_unit = str(source_unit_id or "").strip()
    media_ref = str(media_ref_id or "").strip()
    target = str(target_id or "").strip()
    identity_parts = (
        normalized_parent_job_id,
        normalized_run_id,
        normalized_task_kind,
        normalized_profile_id,
        source_unit,
        media_ref,
        target,
        str(normalized_attempt),
    )
    task_id = "authenticated_notice_child_task:" + _digest_text("|".join(identity_parts))[:32]
    task: dict[str, Any] = {
        "schema_version": AUTHENTICATED_NOTICE_CHILD_TASK_CONTRACT_SCHEMA_VERSION,
        "task_id": task_id,
        "parent_job_id": normalized_parent_job_id,
        "run_id": normalized_run_id,
        "task_kind": normalized_task_kind,
        "processor_profile_id": normalized_profile_id,
        "state": normalized_state,
        "reason_code": normalized_reason,
        "attempt_ordinal": normalized_attempt,
        "severity": _STATE_SEVERITY[normalized_state],
        "source_unit_id": source_unit,
        "media_ref_id": media_ref,
        "target_id": target,
        "retry_budget": dict(retry_budget or {}),
        "input_refs": [_safe_ref(item) for item in input_refs or ()],
        "output_refs": [_safe_ref(item) for item in output_refs or ()],
        "progress_event_refs": [_safe_ref(item) for item in progress_event_refs or ()],
    }
    if next_retry_after:
        task["next_retry_after"] = str(next_retry_after)
    return task


def build_progress_event(
    *,
    parent_job_id: str,
    run_id: str,
    child_task_id: str,
    stage: str,
    transition: str,
    reason_code: str,
    message: str,
    input_refs: Sequence[Mapping[str, Any]] | None = None,
    output_refs: Sequence[Mapping[str, Any]] | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    normalized_parent_job_id = _required_text(parent_job_id, "parent_job_id")
    normalized_run_id = _required_text(run_id, "run_id")
    normalized_child_task_id = _required_text(child_task_id, "child_task_id")
    normalized_stage = _required_text(stage, "stage")
    normalized_transition = _required_text(transition, "transition")
    normalized_reason = _required_text(reason_code, "reason_code")
    normalized_message = " ".join(str(message or "").split())
    event_id = (
        "authenticated_notice_progress_event:"
        + _digest_text(
            "|".join(
                (
                    normalized_parent_job_id,
                    normalized_run_id,
                    normalized_child_task_id,
                    normalized_stage,
                    normalized_transition,
                    normalized_reason,
                )
            )
        )[:32]
    )
    return {
        "schema_version": AUTHENTICATED_NOTICE_PROGRESS_EVENT_SCHEMA_VERSION,
        "event_id": event_id,
        "generated_at": generated_at or utc_now(),
        "parent_job_id": normalized_parent_job_id,
        "run_id": normalized_run_id,
        "child_task_id": normalized_child_task_id,
        "stage": normalized_stage,
        "transition": normalized_transition,
        "reason_code": normalized_reason,
        "message": normalized_message,
        "input_refs": [_safe_ref(item) for item in input_refs or ()],
        "output_refs": [_safe_ref(item) for item in output_refs or ()],
    }


def summarize_child_tasks(tasks: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    task_rows = [dict(task) for task in tasks]
    by_kind = Counter(str(task.get("task_kind") or "") for task in task_rows)
    by_state = Counter(str(task.get("state") or "") for task in task_rows)
    by_profile = Counter(str(task.get("processor_profile_id") or "") for task in task_rows)
    highest = "none"
    blocked_task: Mapping[str, Any] | None = None
    for task in task_rows:
        severity = str(task.get("severity") or _STATE_SEVERITY.get(str(task.get("state")), "none"))
        if _SEVERITY_RANK.get(severity, 0) > _SEVERITY_RANK[highest]:
            highest = severity
            blocked_task = task
    return {
        "schema_version": "authenticated_notice_child_task_summary.v1",
        "task_count": len(task_rows),
        "by_kind": dict(sorted((key, value) for key, value in by_kind.items() if key)),
        "by_state": dict(sorted((key, value) for key, value in by_state.items() if key)),
        "by_processor_profile": dict(
            sorted((key, value) for key, value in by_profile.items() if key)
        ),
        "highest_severity": highest,
        "blocked_child_task_id": str(blocked_task.get("task_id") or "") if blocked_task else "",
        "blocked_reason_code": str(blocked_task.get("reason_code") or "") if blocked_task else "",
    }


def _normalize_task_kind(value: object) -> str:
    normalized = _required_text(value, "task_kind")
    if normalized not in CHILD_TASK_KINDS:
        raise ValueError(f"unsupported child task kind: {normalized}")
    return normalized


def _normalize_state(value: object) -> str:
    normalized = _required_text(value, "state")
    if normalized not in CHILD_TASK_STATES:
        raise ValueError(f"unsupported child task state: {normalized}")
    return normalized


def _safe_ref(value: Mapping[str, Any]) -> dict[str, Any]:
    allowed_keys = (
        "role",
        "bucket",
        "key",
        "sha256",
        "content_sha256",
        "byte_size",
        "artifact_path",
        "schema_version",
    )
    return {key: value[key] for key in allowed_keys if key in value}


def _required_text(value: object, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


def _positive_int(value: object, label: str) -> int:
    parsed = int(value)  # type: ignore[arg-type]
    if parsed <= 0:
        raise ValueError(f"{label} must be positive")
    return parsed


def _digest_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


__all__ = [
    "AUTHENTICATED_NOTICE_CHILD_TASK_CONTRACT_SCHEMA_VERSION",
    "AUTHENTICATED_NOTICE_PROGRESS_EVENT_SCHEMA_VERSION",
    "CHILD_TASK_KINDS",
    "CHILD_TASK_STATES",
    "build_child_task",
    "build_progress_event",
    "summarize_child_tasks",
]
