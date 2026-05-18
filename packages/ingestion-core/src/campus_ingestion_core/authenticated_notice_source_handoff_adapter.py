from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AuthenticatedNoticeCollectorRunObjectRefs,
)
from campus_ingestion_core.source_handoff_projection import (
    authenticated_notice_child_task_to_ingestion_child_task,
    authenticated_notice_execution_from_verified_handoff,
    authenticated_notice_object_refs_from_run_refs,
    authenticated_notice_source_handoff_from_ledger,
    authenticated_notice_source_run_ref_from_ledger,
)
from campus_ingestion_core.source_handoff_state_machine import (
    FailureReason,
    IngestionStep,
    ObjectVerification,
    SourceObjectRef,
    build_stable_id,
    utc_now_dt,
)
from campus_ingestion_core.source_handoff_store import SourceHandoffStore


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeCanonicalExecutionContext:
    handoff_id: str
    execution_id: str
    worker_id: str
    attempt_count: int


def prepare_authenticated_notice_canonical_execution(
    *,
    run_refs: AuthenticatedNoticeCollectorRunObjectRefs,
    site_id: str,
    object_store: object,
    source_handoff_store: SourceHandoffStore,
    worker_id: str,
    lease_seconds: int,
    processor_profile: str,
    requested_result_kind: str = "materialize_only",
    source_run_terminal_at: datetime | str | None = None,
    now: datetime | None = None,
) -> AuthenticatedNoticeCanonicalExecutionContext:
    timestamp = now or utc_now_dt()
    source_run_ref = authenticated_notice_source_run_ref_from_ledger(
        run_refs,
        site_id=site_id,
        source_run_terminal_at=source_run_terminal_at or timestamp,
        source_run_status="success",
    )
    required_objects = authenticated_notice_object_refs_from_run_refs(run_refs)
    handoff = authenticated_notice_source_handoff_from_ledger(
        source_run_ref=source_run_ref,
        run_refs=run_refs,
        required_objects=required_objects,
        created_at=timestamp,
    )
    handoff = source_handoff_store.create_or_get_handoff(handoff)
    source_handoff_store.mark_handoff_verifying(handoff.handoff_id, now=timestamp)
    for object_ref in required_objects:
        _verify_required_object(
            object_store=object_store,
            source_handoff_store=source_handoff_store,
            handoff_id=handoff.handoff_id,
            object_ref=object_ref,
            now=timestamp,
        )
    verified_handoff = source_handoff_store.mark_handoff_verified(
        handoff.handoff_id,
        now=timestamp,
    )
    execution = source_handoff_store.enqueue_execution(
        authenticated_notice_execution_from_verified_handoff(
            verified_handoff,
            processor_profile=processor_profile,
            requested_result_kind=requested_result_kind,
            created_at=timestamp,
        )
    )
    claimed = source_handoff_store.claim_next_execution(
        worker_id=worker_id,
        lease_seconds=lease_seconds,
        now=timestamp,
    )
    if claimed is None or claimed.execution_id != execution.execution_id:
        raise ValueError("canonical authenticated notice execution claim failed")
    context = AuthenticatedNoticeCanonicalExecutionContext(
        handoff_id=handoff.handoff_id,
        execution_id=claimed.execution_id,
        worker_id=worker_id,
        attempt_count=claimed.attempt_count,
    )
    mark_authenticated_notice_canonical_step_passed(
        source_handoff_store=source_handoff_store,
        context=context,
        step_name="verify_objects",
        now=timestamp,
    )
    return context


def mark_authenticated_notice_canonical_step_passed(
    *,
    source_handoff_store: SourceHandoffStore,
    context: AuthenticatedNoticeCanonicalExecutionContext,
    step_name: str,
    input_refs: Sequence[Mapping[str, object]] = (),
    output_refs: Sequence[Mapping[str, object]] = (),
    now: datetime | None = None,
) -> None:
    timestamp = now or utc_now_dt()
    source_handoff_store.upsert_step(
        IngestionStep(
            execution_id=context.execution_id,
            step_id=build_stable_id("an_step", context.execution_id, step_name),
            step_name=step_name,
            status="passed",
            attempt_count=context.attempt_count,
            input_refs=tuple(input_refs),
            output_refs=tuple(output_refs),
            created_at=timestamp,
            updated_at=timestamp,
            started_at=timestamp,
            finished_at=timestamp,
        )
    )


def project_authenticated_notice_canonical_child_tasks(
    *,
    source_handoff_store: SourceHandoffStore,
    context: AuthenticatedNoticeCanonicalExecutionContext,
    child_tasks: Sequence[Mapping[str, object]],
    now: datetime | None = None,
) -> None:
    timestamp = now or utc_now_dt()
    for child_task in child_tasks:
        source_handoff_store.upsert_child_task(
            authenticated_notice_child_task_to_ingestion_child_task(
                execution_id=context.execution_id,
                child_task=child_task,
                created_at=timestamp,
            )
        )


def complete_authenticated_notice_canonical_execution(
    *,
    source_handoff_store: SourceHandoffStore,
    context: AuthenticatedNoticeCanonicalExecutionContext,
    result_kind: str = "materialized",
    now: datetime | None = None,
) -> None:
    source_handoff_store.complete_execution(
        context.execution_id,
        worker_id=context.worker_id,
        result_kind=result_kind,
        now=now,
    )


def fail_authenticated_notice_canonical_execution(
    *,
    source_handoff_store: SourceHandoffStore,
    context: AuthenticatedNoticeCanonicalExecutionContext,
    error_code: str,
    error_message: str,
    failure_class: str,
    retry_after_seconds: int,
    now: datetime | None = None,
) -> None:
    failure_reason = FailureReason(
        code=error_code,
        message=error_message,
        retryable=failure_class == "retryable",
        source_channel="authenticated_notice_portal",
    )
    if failure_class == "retryable":
        source_handoff_store.fail_execution_retryable(
            context.execution_id,
            worker_id=context.worker_id,
            failure_reason=failure_reason,
            retry_after_seconds=retry_after_seconds,
            now=now,
        )
        return
    source_handoff_store.fail_execution_terminal(
        context.execution_id,
        worker_id=context.worker_id,
        failure_reason=failure_reason,
        now=now,
    )


def _verify_required_object(
    *,
    object_store: object,
    source_handoff_store: SourceHandoffStore,
    handoff_id: str,
    object_ref: SourceObjectRef,
    now: datetime,
) -> None:
    get_bytes = getattr(object_store, "get_bytes", None)
    if not callable(get_bytes):
        _record_failed_verification(
            source_handoff_store=source_handoff_store,
            handoff_id=handoff_id,
            object_ref=object_ref,
            status="failed_retryable",
            observed_sha="",
            observed_size=None,
            failure_code="object_store_reader_unavailable",
            now=now,
        )
        raise ValueError("object_store_reader_unavailable")
    try:
        payload_bytes = get_bytes(bucket=object_ref.bucket, key=object_ref.object_key)
    except Exception as exc:
        _record_failed_verification(
            source_handoff_store=source_handoff_store,
            handoff_id=handoff_id,
            object_ref=object_ref,
            status="missing",
            observed_sha="",
            observed_size=None,
            failure_code=_missing_reason_code(object_ref),
            now=now,
        )
        raise ValueError(f"{_missing_reason_code(object_ref)}: {exc}") from exc
    observed_sha = hashlib.sha256(payload_bytes).hexdigest()
    observed_size = len(payload_bytes)
    if observed_sha != object_ref.content_sha256:
        _record_failed_verification(
            source_handoff_store=source_handoff_store,
            handoff_id=handoff_id,
            object_ref=object_ref,
            status="checksum_mismatch",
            observed_sha=observed_sha,
            observed_size=observed_size,
            failure_code="checksum_mismatch",
            now=now,
        )
        raise ValueError(f"checksum_mismatch: {object_ref.object_role}")
    if observed_size != object_ref.byte_size:
        _record_failed_verification(
            source_handoff_store=source_handoff_store,
            handoff_id=handoff_id,
            object_ref=object_ref,
            status="size_mismatch",
            observed_sha=observed_sha,
            observed_size=observed_size,
            failure_code="size_mismatch",
            now=now,
        )
        raise ValueError(f"size_mismatch: {object_ref.object_role}")
    source_handoff_store.record_object_verification(
        ObjectVerification(
            verification_id=build_stable_id(
                "an_object_verification",
                handoff_id,
                object_ref.object_role,
                object_ref.object_key,
            ),
            handoff_id=handoff_id,
            object_role=object_ref.object_role,
            bucket=object_ref.bucket,
            object_key=object_ref.object_key,
            status="matched",
            expected_sha256=object_ref.content_sha256,
            observed_sha256=observed_sha,
            expected_byte_size=object_ref.byte_size or 0,
            observed_byte_size=observed_size,
            checked_at=now,
        )
    )


def _record_failed_verification(
    *,
    source_handoff_store: SourceHandoffStore,
    handoff_id: str,
    object_ref: SourceObjectRef,
    status: str,
    observed_sha: str,
    observed_size: int | None,
    failure_code: str,
    now: datetime,
) -> None:
    failure_reason = FailureReason(
        code=failure_code,
        message=f"{object_ref.object_role} verification failed",
        retryable=status in {"missing", "failed_retryable"},
        source_channel="authenticated_notice_portal",
    )
    source_handoff_store.record_object_verification(
        ObjectVerification(
            verification_id=build_stable_id(
                "an_object_verification",
                handoff_id,
                object_ref.object_role,
                object_ref.object_key,
            ),
            handoff_id=handoff_id,
            object_role=object_ref.object_role,
            bucket=object_ref.bucket,
            object_key=object_ref.object_key,
            status=status,
            expected_sha256=object_ref.content_sha256,
            observed_sha256=observed_sha,
            expected_byte_size=object_ref.byte_size or 0,
            observed_byte_size=observed_size,
            checked_at=now,
            failure_reason=failure_reason,
        )
    )
    source_handoff_store.reject_handoff(handoff_id, failure_reason=failure_reason, now=now)


def _missing_reason_code(object_ref: SourceObjectRef) -> str:
    if object_ref.object_role == "handoff_bundle":
        return "missing_bundle_object"
    if object_ref.object_role == "handoff_manifest":
        return "missing_manifest_object"
    return "source_object_unavailable"


__all__ = [
    "AuthenticatedNoticeCanonicalExecutionContext",
    "complete_authenticated_notice_canonical_execution",
    "fail_authenticated_notice_canonical_execution",
    "mark_authenticated_notice_canonical_step_passed",
    "prepare_authenticated_notice_canonical_execution",
    "project_authenticated_notice_canonical_child_tasks",
]
