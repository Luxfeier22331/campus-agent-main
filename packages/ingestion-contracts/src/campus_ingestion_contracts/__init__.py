from __future__ import annotations

from dataclasses import dataclass
from typing import Any

TASK_ENVELOPE_VERSION = "ingestion_task_envelope.v1"
TASK_REGISTRY_VERSION = "ingestion_task_registry.v1"

TASK_KINDS = {
    "source_truth_materialize",
    "document_units_validate",
    "chunk_prepare",
    "release_manifest_validate",
}

EXECUTOR_KINDS = {"rust_kernel", "ts_control"}


@dataclass(frozen=True, slots=True)
class ValidationResult:
    ok: bool
    errors: tuple[str, ...] = ()


def validate_ingestion_task_envelope(value: object) -> ValidationResult:
    errors: list[str] = []
    if not isinstance(value, dict):
        return ValidationResult(ok=False, errors=("payload must be an object",))

    _require_string(value, "schema_version", errors)
    _require_string(value, "task_id", errors)
    _require_string(value, "run_id", errors)
    _require_string(value, "source_family", errors)
    _require_string(value, "source_channel", errors)
    _require_string(value, "corpus", errors)
    _require_string(value, "collection", errors)
    _require_string(value, "task_kind", errors)
    _require_string(value, "output_contract", errors)
    _require_string(value, "idempotency_key", errors)
    _require_string(value, "created_by", errors)
    _require_string(value, "created_at", errors)

    if value.get("schema_version") not in (None, TASK_ENVELOPE_VERSION):
        errors.append("schema_version must be ingestion_task_envelope.v1")
    task_kind = value.get("task_kind")
    if isinstance(task_kind, str) and task_kind not in TASK_KINDS:
        errors.append(f"task_kind is not supported: {task_kind}")

    _validate_artifact_ref(value.get("input_ref"), "input_ref", errors)
    _validate_lease_policy(value.get("lease_policy"), errors)
    _validate_retry_policy(value.get("retry_policy"), errors)

    return _result(errors)


def validate_ingestion_task_registry(value: object) -> ValidationResult:
    errors: list[str] = []
    if not isinstance(value, dict):
        return ValidationResult(ok=False, errors=("payload must be an object",))

    _require_string(value, "schema_version", errors)
    _require_string(value, "source_family", errors)
    _require_string(value, "corpus", errors)
    _require_string(value, "collection", errors)
    if value.get("schema_version") not in (None, TASK_REGISTRY_VERSION):
        errors.append("schema_version must be ingestion_task_registry.v1")

    tasks = value.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        errors.append("tasks must contain at least one task")
        return _result(errors)

    for index, task in enumerate(tasks):
        if not isinstance(task, dict):
            errors.append(f"tasks[{index}] must be an object")
            continue
        _require_string(task, f"tasks[{index}].task_kind", errors, field="task_kind")
        _require_string(task, f"tasks[{index}].executor_kind", errors, field="executor_kind")
        _require_string(task, f"tasks[{index}].input_contract", errors, field="input_contract")
        _require_string(task, f"tasks[{index}].output_contract", errors, field="output_contract")
        if isinstance(task.get("task_kind"), str) and task["task_kind"] not in TASK_KINDS:
            errors.append(f"tasks[{index}].task_kind is not supported: {task['task_kind']}")
        if (
            isinstance(task.get("executor_kind"), str)
            and task["executor_kind"] not in EXECUTOR_KINDS
        ):
            errors.append(f"tasks[{index}].executor_kind is not supported: {task['executor_kind']}")
        if not isinstance(task.get("can_publish_alias"), bool):
            errors.append(f"tasks[{index}].can_publish_alias is required")
        if task.get("executor_kind") == "rust_kernel":
            _require_string(task, f"tasks[{index}].kernel_id", errors, field="kernel_id")
    return _result(errors)


def _validate_artifact_ref(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, dict):
        errors.append(f"{path} is required")
        return
    _require_string(value, f"{path}.kind", errors, field="kind")
    _require_string(value, f"{path}.uri", errors, field="uri")


def _validate_lease_policy(value: Any, errors: list[str]) -> None:
    if not isinstance(value, dict):
        errors.append("lease_policy is required")
        return
    _require_positive_int(value, "lease_policy.lease_seconds", errors, field="lease_seconds")
    _require_positive_int(
        value, "lease_policy.heartbeat_seconds", errors, field="heartbeat_seconds"
    )


def _validate_retry_policy(value: Any, errors: list[str]) -> None:
    if not isinstance(value, dict):
        errors.append("retry_policy is required")
        return
    _require_positive_int(value, "retry_policy.max_attempts", errors, field="max_attempts")


def _require_string(
    value: dict[str, Any],
    path: str,
    errors: list[str],
    *,
    field: str | None = None,
) -> None:
    key = field or path
    candidate = value.get(key)
    if not isinstance(candidate, str) or not candidate.strip():
        errors.append(f"{path} is required")


def _require_positive_int(
    value: dict[str, Any],
    path: str,
    errors: list[str],
    *,
    field: str,
) -> None:
    candidate = value.get(field)
    if not isinstance(candidate, int) or candidate < 1:
        errors.append(f"{path} must be a positive integer")


def _result(errors: list[str]) -> ValidationResult:
    if errors:
        return ValidationResult(ok=False, errors=tuple(errors))
    return ValidationResult(ok=True)


__all__ = [
    "ValidationResult",
    "validate_ingestion_task_envelope",
    "validate_ingestion_task_registry",
]
