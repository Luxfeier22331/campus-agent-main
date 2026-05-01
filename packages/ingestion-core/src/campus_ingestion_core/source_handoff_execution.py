from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from campus_ingestion_core.source_handoff_state_machine import (
    FailureReason,
    IngestionEvent,
    IngestionExecution,
    IngestionStep,
    build_stable_id,
    utc_now_dt,
)
from campus_ingestion_core.source_handoff_store import (
    SourceHandoffOperatorRecord,
    SourceHandoffStore,
)


class SourceHandoffExecutionError(RuntimeError):
    def __init__(
        self,
        *,
        error_code: str,
        message: str,
        failure_class: str = "retryable",
    ) -> None:
        super().__init__(message)
        if failure_class not in {"retryable", "terminal", "manual_review"}:
            raise ValueError("failure_class must be retryable, terminal or manual_review")
        self.error_code = _required_text(error_code, "error_code")
        self.failure_class = failure_class


@dataclass(frozen=True, slots=True)
class SourceHandoffProcessorResult:
    result_kind: str
    completed_step_names: tuple[str, ...] = ()
    output_refs: tuple[Mapping[str, Any], ...] = ()


@dataclass(frozen=True, slots=True)
class SourceHandoffExecutionRunResult:
    status: str
    execution_id: str = ""
    result_kind: str = "none"
    error_code: str = ""
    failure_class: str = ""

    def to_payload(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "execution_id": self.execution_id,
            "result_kind": self.result_kind,
            "error_code": self.error_code,
            "failure_class": self.failure_class,
        }


SourceHandoffProcessor = Callable[
    ...,
    SourceHandoffProcessorResult,
]


def run_next_source_handoff_execution(
    *,
    store: SourceHandoffStore,
    processors: Mapping[str, SourceHandoffProcessor],
    worker_id: str,
    lease_seconds: int = 300,
    retry_after_seconds: int = 300,
    now: datetime | None = None,
) -> SourceHandoffExecutionRunResult:
    timestamp = now or utc_now_dt()
    worker = _required_text(worker_id, "worker_id")
    claimed = store.claim_next_execution(
        worker_id=worker,
        lease_seconds=lease_seconds,
        now=timestamp,
    )
    if claimed is None:
        return SourceHandoffExecutionRunResult(status="idle")
    store.append_event(
        _event(
            event_type="ingestion.execution.claimed",
            execution=claimed,
            occurred_at=timestamp,
        )
    )
    running = store.mark_execution_running(
        claimed.execution_id,
        worker_id=worker,
        now=timestamp,
    )
    operator_record = _operator_record_for_execution(store, running.execution_id)
    processor = processors.get(running.processor_profile)
    if processor is None:
        failure = SourceHandoffExecutionError(
            error_code="unsupported_processor_profile",
            message=f"unsupported processor profile: {running.processor_profile}",
            failure_class="terminal",
        )
        _fail_execution(
            store=store,
            execution=running,
            worker_id=worker,
            failure=failure,
            retry_after_seconds=retry_after_seconds,
            now=timestamp,
        )
        return SourceHandoffExecutionRunResult(
            status="failed_terminal",
            execution_id=running.execution_id,
            result_kind="failed",
            error_code=failure.error_code,
            failure_class=failure.failure_class,
        )
    try:
        result = processor(execution=running, operator_record=operator_record)
        for step_name in result.completed_step_names:
            _mark_step_passed(
                store=store,
                execution=running,
                step_name=step_name,
                output_refs=result.output_refs,
                now=timestamp,
            )
        completed = store.complete_execution(
            running.execution_id,
            worker_id=worker,
            result_kind=result.result_kind,
            now=timestamp,
        )
        store.append_event(
            _event(
                event_type="ingestion.execution.completed",
                execution=completed,
                occurred_at=timestamp,
            )
        )
        return SourceHandoffExecutionRunResult(
            status="completed",
            execution_id=completed.execution_id,
            result_kind=completed.result_kind,
        )
    except SourceHandoffExecutionError as exc:
        failed = _fail_execution(
            store=store,
            execution=running,
            worker_id=worker,
            failure=exc,
            retry_after_seconds=retry_after_seconds,
            now=timestamp,
        )
        return SourceHandoffExecutionRunResult(
            status=failed.status,
            execution_id=failed.execution_id,
            result_kind=failed.result_kind,
            error_code=exc.error_code,
            failure_class=exc.failure_class,
        )
    except Exception as exc:
        failure = SourceHandoffExecutionError(
            error_code="processor_failed_retryable",
            message=f"source handoff processor failed: {exc}",
            failure_class="retryable",
        )
        failed = _fail_execution(
            store=store,
            execution=running,
            worker_id=worker,
            failure=failure,
            retry_after_seconds=retry_after_seconds,
            now=timestamp,
        )
        return SourceHandoffExecutionRunResult(
            status=failed.status,
            execution_id=failed.execution_id,
            result_kind=failed.result_kind,
            error_code=failure.error_code,
            failure_class=failure.failure_class,
        )


def _fail_execution(
    *,
    store: SourceHandoffStore,
    execution: IngestionExecution,
    worker_id: str,
    failure: SourceHandoffExecutionError,
    retry_after_seconds: int,
    now: datetime,
) -> IngestionExecution:
    failure_reason = FailureReason(
        code=failure.error_code,
        message=str(failure),
        retryable=failure.failure_class == "retryable",
    )
    if failure.failure_class == "retryable":
        failed = store.fail_execution_retryable(
            execution.execution_id,
            worker_id=worker_id,
            failure_reason=failure_reason,
            retry_after_seconds=retry_after_seconds,
            now=now,
        )
    else:
        failed = store.fail_execution_terminal(
            execution.execution_id,
            worker_id=worker_id,
            failure_reason=failure_reason,
            now=now,
        )
    store.append_event(
        _event(
            event_type=(
                "ingestion.execution.dead_lettered"
                if failed.status == "dead_letter"
                else "ingestion.execution.failed"
            ),
            execution=failed,
            occurred_at=now,
            payload={
                "error_code": failure.error_code,
                "failure_class": failure.failure_class,
            },
        )
    )
    return failed


def _mark_step_passed(
    *,
    store: SourceHandoffStore,
    execution: IngestionExecution,
    step_name: str,
    output_refs: Sequence[Mapping[str, Any]],
    now: datetime,
) -> None:
    normalized_step_name = _required_text(step_name, "step_name")
    store.upsert_step(
        IngestionStep(
            execution_id=execution.execution_id,
            step_id=build_stable_id("source_handoff_step", execution.execution_id, step_name),
            step_name=normalized_step_name,
            status="passed",
            attempt_count=execution.attempt_count,
            output_refs=tuple(output_refs),
            created_at=now,
            updated_at=now,
            started_at=now,
            finished_at=now,
        )
    )


def _operator_record_for_execution(
    store: SourceHandoffStore,
    execution_id: str,
) -> SourceHandoffOperatorRecord:
    for record in store.operator_records(limit=500):
        if record.execution is not None and record.execution.execution_id == execution_id:
            return record
    raise SourceHandoffExecutionError(
        error_code="operator_record_missing",
        message=f"operator record not found for execution: {execution_id}",
        failure_class="terminal",
    )


def _event(
    *,
    event_type: str,
    execution: IngestionExecution,
    occurred_at: datetime,
    payload: Mapping[str, Any] | None = None,
) -> IngestionEvent:
    return IngestionEvent(
        event_id=build_stable_id(
            "source_handoff_event",
            event_type,
            execution.execution_id,
            execution.status,
            execution.attempt_count,
        ),
        event_type=event_type,
        execution_id=execution.execution_id,
        handoff_id=execution.handoff_id,
        payload={
            "execution_id": execution.execution_id,
            "status": execution.status,
            "result_kind": execution.result_kind,
            **dict(payload or {}),
        },
        occurred_at=occurred_at,
    )


def _required_text(value: object, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


__all__ = [
    "SourceHandoffExecutionError",
    "SourceHandoffExecutionRunResult",
    "SourceHandoffProcessor",
    "SourceHandoffProcessorResult",
    "run_next_source_handoff_execution",
]
