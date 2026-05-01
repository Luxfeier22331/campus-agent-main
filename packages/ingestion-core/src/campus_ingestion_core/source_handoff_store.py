from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import replace
from datetime import datetime
from threading import RLock
from typing import Any, Protocol

from campus_ingestion_core.source_handoff_state_machine import (
    FailureReason,
    IngestionChildTask,
    IngestionEvent,
    IngestionExecution,
    IngestionStep,
    ObjectVerification,
    SourceHandoff,
    SourceObjectRef,
    utc_now_dt,
)

DEFAULT_SOURCE_HANDOFF_LEASE_SECONDS = 300


class SourceHandoffStoreError(RuntimeError):
    pass


class SourceHandoffConflictError(SourceHandoffStoreError):
    pass


class SourceHandoffLeaseError(SourceHandoffStoreError):
    pass


class SourceHandoffNotFoundError(SourceHandoffStoreError):
    pass


class SourceHandoffStore(Protocol):
    def create_or_get_handoff(self, handoff: SourceHandoff) -> SourceHandoff: ...

    def append_objects(
        self,
        handoff_id: str,
        objects: Sequence[SourceObjectRef],
    ) -> tuple[SourceObjectRef, ...]: ...

    def mark_handoff_verifying(
        self,
        handoff_id: str,
        *,
        now: datetime | None = None,
    ) -> SourceHandoff: ...

    def record_object_verification(
        self,
        verification: ObjectVerification,
    ) -> ObjectVerification: ...

    def mark_handoff_verified(
        self,
        handoff_id: str,
        *,
        now: datetime | None = None,
    ) -> SourceHandoff: ...

    def reject_handoff(
        self,
        handoff_id: str,
        *,
        failure_reason: FailureReason,
        now: datetime | None = None,
    ) -> SourceHandoff: ...

    def enqueue_execution(self, execution: IngestionExecution) -> IngestionExecution: ...

    def claim_next_execution(
        self,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_SOURCE_HANDOFF_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> IngestionExecution | None: ...

    def heartbeat_execution(
        self,
        execution_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_SOURCE_HANDOFF_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> IngestionExecution: ...

    def complete_execution(
        self,
        execution_id: str,
        *,
        worker_id: str,
        result_kind: str,
        now: datetime | None = None,
    ) -> IngestionExecution: ...

    def fail_execution_retryable(
        self,
        execution_id: str,
        *,
        worker_id: str,
        failure_reason: FailureReason,
        retry_after_seconds: int = 0,
        now: datetime | None = None,
    ) -> IngestionExecution: ...

    def fail_execution_terminal(
        self,
        execution_id: str,
        *,
        worker_id: str,
        failure_reason: FailureReason,
        now: datetime | None = None,
    ) -> IngestionExecution: ...

    def upsert_step(self, step: IngestionStep) -> IngestionStep: ...

    def upsert_child_task(self, child_task: IngestionChildTask) -> IngestionChildTask: ...

    def append_event(self, event: IngestionEvent) -> IngestionEvent: ...

    def operator_summary(self, *, now: datetime | None = None) -> dict[str, Any]: ...


class InMemorySourceHandoffStore:
    def __init__(self) -> None:
        self._handoffs_by_id: dict[str, SourceHandoff] = {}
        self._handoff_id_by_idempotency_key: dict[str, str] = {}
        self._objects_by_handoff_id: dict[str, dict[tuple[str, str], SourceObjectRef]] = {}
        self._verifications_by_id: dict[str, ObjectVerification] = {}
        self._executions_by_id: dict[str, IngestionExecution] = {}
        self._execution_id_by_idempotency_key: dict[str, str] = {}
        self._steps_by_key: dict[tuple[str, str], IngestionStep] = {}
        self._child_tasks_by_key: dict[tuple[str, str], IngestionChildTask] = {}
        self._events_by_id: dict[str, IngestionEvent] = {}
        self._lock = RLock()

    def create_or_get_handoff(self, handoff: SourceHandoff) -> SourceHandoff:
        with self._lock:
            existing_id = self._handoff_id_by_idempotency_key.get(handoff.idempotency_key)
            if existing_id is not None:
                existing = self._handoffs_by_id[existing_id]
                if existing != handoff:
                    raise SourceHandoffConflictError(
                        "source handoff idempotency key conflicts with existing handoff"
                    )
                return existing
            self._handoffs_by_id[handoff.handoff_id] = handoff
            self._handoff_id_by_idempotency_key[handoff.idempotency_key] = handoff.handoff_id
            self._objects_by_handoff_id[handoff.handoff_id] = {
                (item.object_role, item.object_key): item
                for item in (*handoff.required_objects, *handoff.optional_objects)
            }
            return handoff

    def append_objects(
        self,
        handoff_id: str,
        objects: Sequence[SourceObjectRef],
    ) -> tuple[SourceObjectRef, ...]:
        with self._lock:
            self._require_handoff(handoff_id)
            target = self._objects_by_handoff_id.setdefault(handoff_id, {})
            for object_ref in objects:
                key = (object_ref.object_role, object_ref.object_key)
                existing = target.get(key)
                if existing is not None and existing != object_ref:
                    raise SourceHandoffConflictError(
                        f"source object ref conflict for {handoff_id}: {key}"
                    )
                target[key] = object_ref
            return tuple(target.values())

    def mark_handoff_verifying(
        self,
        handoff_id: str,
        *,
        now: datetime | None = None,
    ) -> SourceHandoff:
        with self._lock:
            handoff = self._require_handoff(handoff_id).mark_verifying(now=now)
            self._handoffs_by_id[handoff_id] = handoff
            return handoff

    def record_object_verification(
        self,
        verification: ObjectVerification,
    ) -> ObjectVerification:
        with self._lock:
            self._require_handoff(verification.handoff_id)
            self._verifications_by_id[verification.verification_id] = verification
            return verification

    def mark_handoff_verified(
        self,
        handoff_id: str,
        *,
        now: datetime | None = None,
    ) -> SourceHandoff:
        with self._lock:
            handoff = self._require_handoff(handoff_id).mark_verified(now=now)
            self._handoffs_by_id[handoff_id] = handoff
            return handoff

    def reject_handoff(
        self,
        handoff_id: str,
        *,
        failure_reason: FailureReason,
        now: datetime | None = None,
    ) -> SourceHandoff:
        with self._lock:
            handoff = self._require_handoff(handoff_id).reject(
                failure_reason=failure_reason,
                now=now,
            )
            self._handoffs_by_id[handoff_id] = handoff
            return handoff

    def enqueue_execution(self, execution: IngestionExecution) -> IngestionExecution:
        with self._lock:
            handoff = self._require_handoff(execution.handoff_id)
            if handoff.status != "verified":
                raise SourceHandoffStoreError("only verified handoffs can enqueue executions")
            existing_id = self._execution_id_by_idempotency_key.get(execution.idempotency_key)
            if existing_id is not None:
                existing = self._executions_by_id[existing_id]
                if existing != execution:
                    raise SourceHandoffConflictError(
                        "ingestion execution idempotency key conflicts with existing execution"
                    )
                return existing
            self._executions_by_id[execution.execution_id] = execution
            self._execution_id_by_idempotency_key[execution.idempotency_key] = (
                execution.execution_id
            )
            return execution

    def claim_next_execution(
        self,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_SOURCE_HANDOFF_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> IngestionExecution | None:
        timestamp = now or utc_now_dt()
        with self._lock:
            candidates = [
                execution
                for execution in self._executions_by_id.values()
                if execution.status == "queued"
                or execution.is_retry_due(now=timestamp)
                or execution.is_lease_expired(now=timestamp)
            ]
            if not candidates:
                return None
            selected = sorted(candidates, key=lambda item: (item.created_at, item.execution_id))[0]
            claimed = replace(
                selected,
                status="queued",
                lease_owner="",
                lease_expires_at=None,
            ).claim(worker_id=worker_id, lease_seconds=lease_seconds, now=timestamp)
            self._executions_by_id[claimed.execution_id] = claimed
            return claimed

    def heartbeat_execution(
        self,
        execution_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_SOURCE_HANDOFF_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> IngestionExecution:
        with self._lock:
            execution = self._require_execution(execution_id)
            try:
                updated = execution.heartbeat(
                    worker_id=worker_id,
                    lease_seconds=lease_seconds,
                    now=now,
                )
            except ValueError as exc:
                raise SourceHandoffLeaseError(str(exc)) from exc
            self._executions_by_id[execution_id] = updated
            return updated

    def complete_execution(
        self,
        execution_id: str,
        *,
        worker_id: str,
        result_kind: str,
        now: datetime | None = None,
    ) -> IngestionExecution:
        with self._lock:
            execution = self._require_execution(execution_id)
            try:
                updated = execution.complete(
                    worker_id=worker_id,
                    result_kind=result_kind,
                    now=now,
                )
            except ValueError as exc:
                raise SourceHandoffLeaseError(str(exc)) from exc
            self._executions_by_id[execution_id] = updated
            return updated

    def fail_execution_retryable(
        self,
        execution_id: str,
        *,
        worker_id: str,
        failure_reason: FailureReason,
        retry_after_seconds: int = 0,
        now: datetime | None = None,
    ) -> IngestionExecution:
        with self._lock:
            execution = self._require_execution(execution_id)
            try:
                updated = execution.fail_retryable(
                    worker_id=worker_id,
                    failure_reason=failure_reason,
                    retry_after_seconds=retry_after_seconds,
                    now=now,
                )
            except ValueError as exc:
                raise SourceHandoffLeaseError(str(exc)) from exc
            self._executions_by_id[execution_id] = updated
            return updated

    def fail_execution_terminal(
        self,
        execution_id: str,
        *,
        worker_id: str,
        failure_reason: FailureReason,
        now: datetime | None = None,
    ) -> IngestionExecution:
        with self._lock:
            execution = self._require_execution(execution_id)
            try:
                updated = execution.fail_terminal(
                    worker_id=worker_id,
                    failure_reason=failure_reason,
                    now=now,
                )
            except ValueError as exc:
                raise SourceHandoffLeaseError(str(exc)) from exc
            self._executions_by_id[execution_id] = updated
            return updated

    def upsert_step(self, step: IngestionStep) -> IngestionStep:
        with self._lock:
            self._require_execution(step.execution_id)
            self._steps_by_key[(step.execution_id, step.step_id)] = step
            return step

    def upsert_child_task(self, child_task: IngestionChildTask) -> IngestionChildTask:
        with self._lock:
            self._require_execution(child_task.execution_id)
            self._child_tasks_by_key[(child_task.execution_id, child_task.child_task_id)] = (
                child_task
            )
            return child_task

    def append_event(self, event: IngestionEvent) -> IngestionEvent:
        with self._lock:
            existing = self._events_by_id.get(event.event_id)
            if existing is not None and existing != event:
                raise SourceHandoffConflictError(f"ingestion event conflict: {event.event_id}")
            self._events_by_id[event.event_id] = event
            return event

    def operator_summary(self, *, now: datetime | None = None) -> dict[str, Any]:
        _ = now
        with self._lock:
            handoffs_by_status = Counter(
                handoff.status for handoff in self._handoffs_by_id.values()
            )
            executions_by_status = Counter(
                execution.status for execution in self._executions_by_id.values()
            )
            child_tasks_by_status = Counter(
                task.status for task in self._child_tasks_by_key.values()
            )
            steps_by_status = Counter(step.status for step in self._steps_by_key.values())
            return {
                "schema_version": "source_handoff_operator_summary.v1",
                "handoffs": {
                    "total_count": len(self._handoffs_by_id),
                    "by_status": dict(sorted(handoffs_by_status.items())),
                },
                "executions": {
                    "total_count": len(self._executions_by_id),
                    "by_status": dict(sorted(executions_by_status.items())),
                },
                "steps": {
                    "total_count": len(self._steps_by_key),
                    "by_status": dict(sorted(steps_by_status.items())),
                },
                "child_tasks": {
                    "total_count": len(self._child_tasks_by_key),
                    "by_status": dict(sorted(child_tasks_by_status.items())),
                },
            }

    def _require_handoff(self, handoff_id: str) -> SourceHandoff:
        normalized = str(handoff_id or "").strip()
        handoff = self._handoffs_by_id.get(normalized)
        if handoff is None:
            raise SourceHandoffNotFoundError(f"source handoff not found: {normalized}")
        return handoff

    def _require_execution(self, execution_id: str) -> IngestionExecution:
        normalized = str(execution_id or "").strip()
        execution = self._executions_by_id.get(normalized)
        if execution is None:
            raise SourceHandoffNotFoundError(f"ingestion execution not found: {normalized}")
        return execution


__all__ = [
    "DEFAULT_SOURCE_HANDOFF_LEASE_SECONDS",
    "InMemorySourceHandoffStore",
    "SourceHandoffConflictError",
    "SourceHandoffLeaseError",
    "SourceHandoffNotFoundError",
    "SourceHandoffStore",
    "SourceHandoffStoreError",
]
