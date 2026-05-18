from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from campus_ingestion_core.source_handoff_state_machine import (
    IngestionChildTask,
    IngestionStep,
    ObjectVerification,
    SourceObjectRef,
    utc_now_dt,
    validate_operator_safe_payload,
)
from campus_ingestion_core.source_handoff_store import (
    SourceHandoffOperatorRecord,
    SourceHandoffStore,
)

SOURCE_HANDOFF_OPERATOR_PROJECTION_SCHEMA_VERSION = "source_handoff_operator_projection.v1"

_FAILED_OBJECT_VERIFICATION_STATUSES = {
    "missing",
    "checksum_mismatch",
    "size_mismatch",
    "failed_retryable",
}
_STEP_SEVERITY = {
    "pending": "none",
    "running": "none",
    "passed": "none",
    "skipped": "low",
    "cancelled": "low",
    "failed_retryable": "medium",
    "failed_terminal": "high",
}
_CHILD_TASK_SEVERITY = {
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
_SAFE_REF_KEYS = (
    "role",
    "bucket",
    "key",
    "object_key",
    "sha256",
    "content_sha256",
    "byte_size",
    "schema_version",
)


def build_source_handoff_operator_projection(
    *,
    store: SourceHandoffStore,
    limit: int = 100,
    source_channel: str | None = None,
    source_surface: str | None = None,
    include_terminal: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    timestamp = now or utc_now_dt()
    records = store.operator_records(
        limit=limit,
        source_channel=source_channel,
        source_surface=source_surface,
        include_terminal=include_terminal,
    )
    projection = {
        "schema_version": SOURCE_HANDOFF_OPERATOR_PROJECTION_SCHEMA_VERSION,
        "generated_at": timestamp.isoformat(),
        "filters": {
            "source_channel": str(source_channel or ""),
            "source_surface": str(source_surface or ""),
            "include_terminal": include_terminal,
            "limit": limit,
        },
        "counts": store.operator_summary(now=timestamp),
        "records": [project_source_handoff_operator_record(record) for record in records],
    }
    validate_operator_safe_payload(projection)
    return projection


def project_source_handoff_operator_record(
    record: SourceHandoffOperatorRecord,
) -> dict[str, Any]:
    handoff = record.handoff
    execution = record.execution
    projected = {
        "source_channel": handoff.source_channel,
        "source_surface": handoff.source_surface,
        "site_id": handoff.site_id,
        "source_run_id": handoff.source_run_id,
        "handoff": {
            "handoff_id": handoff.handoff_id,
            "handoff_kind": handoff.handoff_kind,
            "status": handoff.status,
            "required_object_count": _required_object_count(record.source_objects),
            "verified_object_count": _verified_object_count(record.object_verifications),
            "failed_object_count": _failed_object_count(record.object_verifications),
            "updated_at": handoff.updated_at.isoformat(),
            "failure_reason": handoff.failure_reason.to_payload()
            if handoff.failure_reason
            else None,
        },
        "execution": _execution_payload(execution),
        "steps": _step_summary(record.steps),
        "child_tasks": _child_task_summary(record.child_tasks),
        "safe_output_refs": _safe_output_refs(record.steps, record.child_tasks),
    }
    validate_operator_safe_payload(projected)
    return projected


def _execution_payload(execution) -> dict[str, Any]:
    if execution is None:
        return {
            "execution_id": "",
            "status": "none",
            "result_kind": "none",
            "processor_profile": "",
            "attempt_count": 0,
            "max_attempts": 0,
            "next_retry_after": None,
            "updated_at": None,
            "failure_reason": None,
        }
    return {
        "execution_id": execution.execution_id,
        "status": execution.status,
        "result_kind": execution.result_kind,
        "processor_profile": execution.processor_profile,
        "attempt_count": execution.attempt_count,
        "max_attempts": execution.max_attempts,
        "next_retry_after": execution.next_retry_after.isoformat()
        if execution.next_retry_after
        else None,
        "updated_at": execution.updated_at.isoformat(),
        "failure_reason": execution.failure_reason.to_payload()
        if execution.failure_reason
        else None,
    }


def _required_object_count(objects: Sequence[SourceObjectRef]) -> int:
    return sum(1 for item in objects if item.required)


def _verified_object_count(verifications: Sequence[ObjectVerification]) -> int:
    return sum(1 for item in verifications if item.status == "matched")


def _failed_object_count(verifications: Sequence[ObjectVerification]) -> int:
    return sum(1 for item in verifications if item.status in _FAILED_OBJECT_VERIFICATION_STATUSES)


def _step_summary(steps: Sequence[IngestionStep]) -> dict[str, Any]:
    by_status = Counter(step.status for step in steps)
    highest = "none"
    blocked_step_name = ""
    for step in steps:
        severity = _STEP_SEVERITY.get(step.status, "none")
        if _SEVERITY_RANK[severity] > _SEVERITY_RANK[highest]:
            highest = severity
            blocked_step_name = step.step_name
    return {
        "step_count": len(steps),
        "by_status": dict(sorted(by_status.items())),
        "highest_severity": highest,
        "blocked_step_name": blocked_step_name,
    }


def _child_task_summary(tasks: Sequence[IngestionChildTask]) -> dict[str, Any]:
    by_status = Counter(task.status for task in tasks)
    highest = "none"
    blocked_task: IngestionChildTask | None = None
    for task in tasks:
        severity = _CHILD_TASK_SEVERITY.get(task.status, "none")
        if _SEVERITY_RANK[severity] > _SEVERITY_RANK[highest]:
            highest = severity
            blocked_task = task
    return {
        "task_count": len(tasks),
        "by_status": dict(sorted(by_status.items())),
        "highest_severity": highest,
        "blocked_child_task_id": blocked_task.child_task_id if blocked_task else "",
        "blocked_reason_code": blocked_task.reason_code if blocked_task else "",
    }


def _safe_output_refs(
    steps: Sequence[IngestionStep],
    child_tasks: Sequence[IngestionChildTask],
) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    seen: set[tuple[tuple[str, str], ...]] = set()
    for ref in (
        *(item for step in steps for item in step.output_refs),
        *(item for task in child_tasks for item in task.output_refs),
    ):
        safe_ref = _safe_ref(ref)
        if not safe_ref:
            continue
        identity = tuple(sorted((str(key), str(value)) for key, value in safe_ref.items()))
        if identity in seen:
            continue
        seen.add(identity)
        refs.append(safe_ref)
    return refs


def _safe_ref(value: Mapping[str, Any]) -> dict[str, Any]:
    safe = {key: value[key] for key in _SAFE_REF_KEYS if key in value}
    if set(safe) == {"role"}:
        return {}
    validate_operator_safe_payload(safe)
    return safe


__all__ = [
    "SOURCE_HANDOFF_OPERATOR_PROJECTION_SCHEMA_VERSION",
    "build_source_handoff_operator_projection",
    "project_source_handoff_operator_record",
]
