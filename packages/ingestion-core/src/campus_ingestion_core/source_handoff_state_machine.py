from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any

SOURCE_HANDOFF_SCHEMA_VERSION = "source_handoff.v1"
INGESTION_EXECUTION_SCHEMA_VERSION = "ingestion_execution.v1"
INGESTION_STEP_SCHEMA_VERSION = "ingestion_step.v1"
INGESTION_CHILD_TASK_SCHEMA_VERSION = "ingestion_child_task.v1"
INGESTION_EVENT_SCHEMA_VERSION = "ingestion_event.v1"

SOURCE_CHANNELS = frozenset(("official_web", "authenticated_notice_portal"))
SOURCE_RUN_OWNERS = frozenset(("app_api_official_web", "authenticated_notice_collector_ledger"))
SOURCE_OBJECT_ROLES = frozenset(
    (
        "handoff_bundle",
        "handoff_manifest",
        "official_web_page_manifest",
        "official_web_content_blocks",
        "notice_attachment_source_bytes",
        "file_release_released_source_bytes",
        "provider_capture",
        "quality_audit",
    )
)
SOURCE_HANDOFF_KINDS = frozenset(
    (
        "official_web_source_truth_replay",
        "authenticated_notice_import",
        "authenticated_file_release_import",
        "source_repair",
    )
)
SOURCE_HANDOFF_STATUSES = frozenset(
    ("created", "verifying", "verified", "rejected", "superseded", "cancelled")
)
OBJECT_VERIFICATION_STATUSES = frozenset(
    (
        "pending",
        "checking",
        "matched",
        "missing",
        "checksum_mismatch",
        "size_mismatch",
        "skipped_optional",
        "failed_retryable",
    )
)
INGESTION_EXECUTION_STATUSES = frozenset(
    (
        "queued",
        "claimed",
        "running",
        "completed",
        "failed_retryable",
        "failed_terminal",
        "dead_letter",
        "cancelled",
    )
)
INGESTION_RESULT_KINDS = frozenset(
    ("none", "noop", "staged", "promoted", "materialized", "failed", "cancelled")
)
INGESTION_REQUESTED_RESULT_KINDS = frozenset(
    ("stage_only", "promote", "materialize_only", "validate_only")
)
INGESTION_STEP_STATUSES = frozenset(
    (
        "pending",
        "running",
        "passed",
        "skipped",
        "failed_retryable",
        "failed_terminal",
        "cancelled",
    )
)
INGESTION_CHILD_TASK_STATUSES = frozenset(
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
FORBIDDEN_PAYLOAD_FIELDS = frozenset(
    (
        "body_text",
        "raw_html",
        "html",
        "content_blocks",
        "attachment_bytes",
        "ocr_payload",
        "ocr_raw_text",
        "image_bytes",
        "cookie",
        "jwt",
        "token",
        "sso_tgc",
        "authorization",
        "secret",
        "raw_prompt",
        "raw_query",
        "local_path",
        "bundle_path",
        "manifest_path",
        "source_file_path",
    )
)


@dataclass(frozen=True, slots=True)
class FailureReason:
    code: str
    message: str = ""
    retryable: bool = False
    source_channel: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(self, "code", _required_text(self.code, "failure_reason.code"))
        object.__setattr__(self, "message", " ".join(str(self.message or "").split()))
        object.__setattr__(self, "source_channel", str(self.source_channel or "").strip())

    def to_payload(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": bool(self.retryable),
            "source_channel": self.source_channel,
        }


@dataclass(frozen=True, slots=True)
class SourceRunRef:
    source_channel: str
    source_surface: str
    site_id: str
    source_run_id: str
    source_run_owner: str
    source_run_status: str
    source_run_terminal_at: datetime | str | None
    source_run_ref: str

    def __post_init__(self) -> None:
        source_channel = _allowlisted_text(
            self.source_channel,
            "source_channel",
            SOURCE_CHANNELS,
        )
        source_run_owner = _allowlisted_text(
            self.source_run_owner,
            "source_run_owner",
            SOURCE_RUN_OWNERS,
        )
        source_run_ref = _required_text(self.source_run_ref, "source_run_ref")
        _reject_local_path(source_run_ref, "source_run_ref")
        object.__setattr__(self, "source_channel", source_channel)
        object.__setattr__(
            self, "source_surface", _required_text(self.source_surface, "source_surface")
        )
        object.__setattr__(self, "site_id", _required_text(self.site_id, "site_id"))
        object.__setattr__(
            self, "source_run_id", _required_text(self.source_run_id, "source_run_id")
        )
        object.__setattr__(self, "source_run_owner", source_run_owner)
        object.__setattr__(
            self,
            "source_run_status",
            _required_text(self.source_run_status, "source_run_status"),
        )
        object.__setattr__(
            self,
            "source_run_terminal_at",
            _coerce_datetime(self.source_run_terminal_at),
        )
        object.__setattr__(self, "source_run_ref", source_run_ref)

    def to_payload(self) -> dict[str, Any]:
        return {
            "source_channel": self.source_channel,
            "source_surface": self.source_surface,
            "site_id": self.site_id,
            "source_run_id": self.source_run_id,
            "source_run_owner": self.source_run_owner,
            "source_run_status": self.source_run_status,
            "source_run_terminal_at": _format_datetime(self.source_run_terminal_at),
            "source_run_ref": self.source_run_ref,
        }


@dataclass(frozen=True, slots=True)
class SourceObjectRef:
    object_role: str
    bucket: str
    object_key: str
    content_sha256: str = ""
    byte_size: int | None = None
    required: bool = True
    content_type: str = ""
    source_unit_id: str = ""
    declared_at: datetime | str | None = None

    def __post_init__(self) -> None:
        object_role = _allowlisted_text(self.object_role, "object_role", SOURCE_OBJECT_ROLES)
        bucket = _required_text(self.bucket, "bucket")
        object_key = _required_text(self.object_key, "object_key")
        _reject_local_path(bucket, "bucket")
        _reject_local_path(object_key, "object_key")
        content_sha256 = str(self.content_sha256 or "").strip()
        if content_sha256:
            content_sha256 = _required_sha256(content_sha256, "content_sha256")
        byte_size = _optional_non_negative_int(self.byte_size, "byte_size")
        if bool(self.required):
            if not content_sha256:
                raise ValueError("content_sha256 is required for required object refs")
            if byte_size is None:
                raise ValueError("byte_size is required for required object refs")
        object.__setattr__(self, "object_role", object_role)
        object.__setattr__(self, "bucket", bucket)
        object.__setattr__(self, "object_key", object_key)
        object.__setattr__(self, "content_sha256", content_sha256)
        object.__setattr__(self, "byte_size", byte_size)
        object.__setattr__(self, "required", bool(self.required))
        object.__setattr__(self, "content_type", str(self.content_type or "").strip())
        object.__setattr__(self, "source_unit_id", str(self.source_unit_id or "").strip())
        object.__setattr__(self, "declared_at", _coerce_datetime(self.declared_at))

    def to_payload(self) -> dict[str, Any]:
        return {
            "object_role": self.object_role,
            "bucket": self.bucket,
            "object_key": self.object_key,
            "content_sha256": self.content_sha256,
            "byte_size": self.byte_size,
            "required": self.required,
            "content_type": self.content_type,
            "source_unit_id": self.source_unit_id,
            "declared_at": _format_datetime(self.declared_at),
        }


@dataclass(frozen=True, slots=True)
class SourceHandoff:
    handoff_id: str
    schema_version: str
    source_run_ref: SourceRunRef | Mapping[str, Any]
    handoff_kind: str
    source_bucket: str
    required_objects: tuple[SourceObjectRef | Mapping[str, Any], ...]
    idempotency_key: str
    status: str
    created_at: datetime | str
    updated_at: datetime | str
    optional_objects: tuple[SourceObjectRef | Mapping[str, Any], ...] = ()
    bundle_ref: SourceObjectRef | Mapping[str, Any] | None = None
    manifest_ref: SourceObjectRef | Mapping[str, Any] | None = None
    page_or_unit_changes: tuple[Mapping[str, Any], ...] = ()
    verified_at: datetime | str | None = None
    superseded_by: str = ""
    failure_reason: FailureReason | Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        source_run_ref = _source_run_ref_from_value(self.source_run_ref)
        required_objects = tuple(_object_ref_from_value(item) for item in self.required_objects)
        optional_objects = tuple(_object_ref_from_value(item) for item in self.optional_objects)
        if not required_objects:
            raise ValueError("required_objects is required")
        for payload in self.page_or_unit_changes:
            validate_operator_safe_payload(payload)
        source_bucket = _required_text(self.source_bucket, "source_bucket")
        _reject_local_path(source_bucket, "source_bucket")
        object.__setattr__(self, "handoff_id", _required_text(self.handoff_id, "handoff_id"))
        object.__setattr__(
            self,
            "schema_version",
            _required_text(self.schema_version, "schema_version"),
        )
        object.__setattr__(self, "source_run_ref", source_run_ref)
        object.__setattr__(
            self,
            "handoff_kind",
            _allowlisted_text(self.handoff_kind, "handoff_kind", SOURCE_HANDOFF_KINDS),
        )
        object.__setattr__(self, "source_bucket", source_bucket)
        object.__setattr__(self, "required_objects", required_objects)
        object.__setattr__(self, "optional_objects", optional_objects)
        object.__setattr__(self, "bundle_ref", _optional_object_ref_from_value(self.bundle_ref))
        object.__setattr__(self, "manifest_ref", _optional_object_ref_from_value(self.manifest_ref))
        object.__setattr__(
            self, "idempotency_key", _required_text(self.idempotency_key, "idempotency_key")
        )
        object.__setattr__(
            self,
            "status",
            _allowlisted_text(self.status, "status", SOURCE_HANDOFF_STATUSES),
        )
        object.__setattr__(
            self, "created_at", _coerce_required_datetime(self.created_at, "created_at")
        )
        object.__setattr__(
            self, "updated_at", _coerce_required_datetime(self.updated_at, "updated_at")
        )
        object.__setattr__(self, "verified_at", _coerce_datetime(self.verified_at))
        object.__setattr__(self, "superseded_by", str(self.superseded_by or "").strip())
        object.__setattr__(self, "failure_reason", _failure_reason_from_value(self.failure_reason))
        if self.status == "verified" and self.verified_at is None:
            raise ValueError("verified handoff requires verified_at")
        if self.status == "rejected" and self.failure_reason is None:
            raise ValueError("rejected handoff requires failure_reason")

    @property
    def source_channel(self) -> str:
        return self.source_run_ref.source_channel

    @property
    def source_surface(self) -> str:
        return self.source_run_ref.source_surface

    @property
    def site_id(self) -> str:
        return self.source_run_ref.site_id

    @property
    def source_run_id(self) -> str:
        return self.source_run_ref.source_run_id

    def mark_verifying(self, *, now: datetime | None = None) -> SourceHandoff:
        timestamp = now or utc_now_dt()
        return replace(self, status="verifying", updated_at=timestamp)

    def mark_verified(self, *, now: datetime | None = None) -> SourceHandoff:
        timestamp = now or utc_now_dt()
        return replace(self, status="verified", verified_at=timestamp, updated_at=timestamp)

    def reject(
        self,
        *,
        failure_reason: FailureReason,
        now: datetime | None = None,
    ) -> SourceHandoff:
        timestamp = now or utc_now_dt()
        return replace(
            self,
            status="rejected",
            failure_reason=failure_reason,
            updated_at=timestamp,
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "handoff_id": self.handoff_id,
            "schema_version": self.schema_version,
            "source_run_ref": self.source_run_ref.to_payload(),
            "handoff_kind": self.handoff_kind,
            "source_bucket": self.source_bucket,
            "required_objects": [item.to_payload() for item in self.required_objects],
            "optional_objects": [item.to_payload() for item in self.optional_objects],
            "bundle_ref": self.bundle_ref.to_payload() if self.bundle_ref else None,
            "manifest_ref": self.manifest_ref.to_payload() if self.manifest_ref else None,
            "page_or_unit_changes": [dict(item) for item in self.page_or_unit_changes],
            "idempotency_key": self.idempotency_key,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "verified_at": self.verified_at,
            "superseded_by": self.superseded_by,
            "failure_reason": self.failure_reason.to_payload() if self.failure_reason else None,
        }


@dataclass(frozen=True, slots=True)
class ObjectVerification:
    verification_id: str
    handoff_id: str
    object_role: str
    bucket: str
    object_key: str
    status: str
    expected_sha256: str
    expected_byte_size: int
    checked_at: datetime | str
    observed_sha256: str = ""
    observed_byte_size: int | None = None
    failure_reason: FailureReason | Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        bucket = _required_text(self.bucket, "bucket")
        object_key = _required_text(self.object_key, "object_key")
        _reject_local_path(bucket, "bucket")
        _reject_local_path(object_key, "object_key")
        observed_sha256 = str(self.observed_sha256 or "").strip()
        if observed_sha256:
            observed_sha256 = _required_sha256(observed_sha256, "observed_sha256")
        object.__setattr__(
            self,
            "verification_id",
            _required_text(self.verification_id, "verification_id"),
        )
        object.__setattr__(self, "handoff_id", _required_text(self.handoff_id, "handoff_id"))
        object.__setattr__(
            self,
            "object_role",
            _allowlisted_text(self.object_role, "object_role", SOURCE_OBJECT_ROLES),
        )
        object.__setattr__(self, "bucket", bucket)
        object.__setattr__(self, "object_key", object_key)
        object.__setattr__(
            self,
            "status",
            _allowlisted_text(self.status, "status", OBJECT_VERIFICATION_STATUSES),
        )
        object.__setattr__(
            self,
            "expected_sha256",
            _required_sha256(self.expected_sha256, "expected_sha256"),
        )
        object.__setattr__(
            self,
            "expected_byte_size",
            _required_non_negative_int(self.expected_byte_size, "expected_byte_size"),
        )
        object.__setattr__(self, "observed_sha256", observed_sha256)
        object.__setattr__(
            self,
            "observed_byte_size",
            _optional_non_negative_int(self.observed_byte_size, "observed_byte_size"),
        )
        object.__setattr__(
            self, "checked_at", _coerce_required_datetime(self.checked_at, "checked_at")
        )
        object.__setattr__(self, "failure_reason", _failure_reason_from_value(self.failure_reason))

    def to_payload(self) -> dict[str, Any]:
        return {
            "verification_id": self.verification_id,
            "handoff_id": self.handoff_id,
            "object_role": self.object_role,
            "bucket": self.bucket,
            "object_key": self.object_key,
            "status": self.status,
            "expected_sha256": self.expected_sha256,
            "observed_sha256": self.observed_sha256,
            "expected_byte_size": self.expected_byte_size,
            "observed_byte_size": self.observed_byte_size,
            "checked_at": self.checked_at,
            "failure_reason": self.failure_reason.to_payload() if self.failure_reason else None,
        }


@dataclass(frozen=True, slots=True)
class IngestionExecution:
    execution_id: str
    handoff_id: str
    processor_profile: str
    requested_result_kind: str
    status: str
    result_kind: str
    attempt_count: int
    max_attempts: int
    created_at: datetime | str
    updated_at: datetime | str
    idempotency_key: str = ""
    lease_owner: str = ""
    lease_expires_at: datetime | str | None = None
    next_retry_after: datetime | str | None = None
    started_at: datetime | str | None = None
    finished_at: datetime | str | None = None
    failure_reason: FailureReason | Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        status = _allowlisted_text(self.status, "status", INGESTION_EXECUTION_STATUSES)
        result_kind = _allowlisted_text(self.result_kind, "result_kind", INGESTION_RESULT_KINDS)
        attempt_count = _required_non_negative_int(self.attempt_count, "attempt_count")
        max_attempts = _positive_int(self.max_attempts, "max_attempts")
        if status == "completed" and result_kind == "none":
            raise ValueError("completed execution requires non-none result_kind")
        if (
            status in ("failed_retryable", "failed_terminal", "dead_letter")
            and result_kind != "failed"
        ):
            raise ValueError("failed execution requires result_kind=failed")
        if status == "cancelled" and result_kind != "cancelled":
            raise ValueError("cancelled execution requires result_kind=cancelled")
        object.__setattr__(self, "execution_id", _required_text(self.execution_id, "execution_id"))
        object.__setattr__(self, "handoff_id", _required_text(self.handoff_id, "handoff_id"))
        object.__setattr__(
            self,
            "processor_profile",
            _required_text(self.processor_profile, "processor_profile"),
        )
        object.__setattr__(
            self,
            "requested_result_kind",
            _allowlisted_text(
                self.requested_result_kind,
                "requested_result_kind",
                INGESTION_REQUESTED_RESULT_KINDS,
            ),
        )
        object.__setattr__(self, "status", status)
        object.__setattr__(self, "result_kind", result_kind)
        object.__setattr__(self, "attempt_count", attempt_count)
        object.__setattr__(self, "max_attempts", max_attempts)
        object.__setattr__(
            self, "created_at", _coerce_required_datetime(self.created_at, "created_at")
        )
        object.__setattr__(
            self, "updated_at", _coerce_required_datetime(self.updated_at, "updated_at")
        )
        object.__setattr__(
            self,
            "idempotency_key",
            str(
                self.idempotency_key
                or f"{self.handoff_id}:{self.processor_profile}:{self.requested_result_kind}"
            ).strip(),
        )
        object.__setattr__(self, "lease_owner", str(self.lease_owner or "").strip())
        object.__setattr__(self, "lease_expires_at", _coerce_datetime(self.lease_expires_at))
        object.__setattr__(self, "next_retry_after", _coerce_datetime(self.next_retry_after))
        object.__setattr__(self, "started_at", _coerce_datetime(self.started_at))
        object.__setattr__(self, "finished_at", _coerce_datetime(self.finished_at))
        object.__setattr__(self, "failure_reason", _failure_reason_from_value(self.failure_reason))

    @property
    def is_terminal(self) -> bool:
        return self.status in ("completed", "failed_terminal", "dead_letter", "cancelled")

    def claim(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> IngestionExecution:
        timestamp = now or utc_now_dt()
        return replace(
            self,
            status="claimed",
            lease_owner=_required_text(worker_id, "worker_id"),
            lease_expires_at=timestamp + _seconds_delta(lease_seconds),
            attempt_count=self.attempt_count + 1,
            next_retry_after=None,
            updated_at=timestamp,
        )

    def heartbeat(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> IngestionExecution:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now_dt()
        return replace(
            self,
            lease_expires_at=timestamp + _seconds_delta(lease_seconds),
            updated_at=timestamp,
        )

    def mark_running(
        self,
        *,
        worker_id: str,
        now: datetime | None = None,
    ) -> IngestionExecution:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now_dt()
        return replace(
            self,
            status="running",
            started_at=self.started_at or timestamp,
            updated_at=timestamp,
        )

    def complete(
        self,
        *,
        result_kind: str,
        worker_id: str,
        now: datetime | None = None,
    ) -> IngestionExecution:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now_dt()
        return replace(
            self,
            status="completed",
            result_kind=_allowlisted_text(result_kind, "result_kind", INGESTION_RESULT_KINDS),
            lease_owner="",
            lease_expires_at=None,
            next_retry_after=None,
            finished_at=timestamp,
            updated_at=timestamp,
        )

    def fail_retryable(
        self,
        *,
        failure_reason: FailureReason,
        worker_id: str,
        retry_after_seconds: int,
        now: datetime | None = None,
    ) -> IngestionExecution:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now_dt()
        exhausted = self.attempt_count >= self.max_attempts
        return replace(
            self,
            status="dead_letter" if exhausted else "failed_retryable",
            result_kind="failed",
            lease_owner="",
            lease_expires_at=None,
            next_retry_after=None if exhausted else timestamp + _seconds_delta(retry_after_seconds),
            failure_reason=replace(failure_reason, retryable=not exhausted),
            finished_at=timestamp if exhausted else None,
            updated_at=timestamp,
        )

    def fail_terminal(
        self,
        *,
        failure_reason: FailureReason,
        worker_id: str,
        now: datetime | None = None,
    ) -> IngestionExecution:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now_dt()
        return replace(
            self,
            status="failed_terminal",
            result_kind="failed",
            lease_owner="",
            lease_expires_at=None,
            next_retry_after=None,
            failure_reason=replace(failure_reason, retryable=False),
            finished_at=timestamp,
            updated_at=timestamp,
        )

    def require_lease_owner(self, *, worker_id: str, now: datetime | None = None) -> None:
        normalized_worker_id = _required_text(worker_id, "worker_id")
        timestamp = now or utc_now_dt()
        if self.status not in ("claimed", "running") or self.lease_owner != normalized_worker_id:
            raise ValueError("ingestion execution is not leased by this worker")
        if self.lease_expires_at is not None and self.lease_expires_at <= timestamp:
            raise ValueError("ingestion execution lease has expired")

    def is_retry_due(self, *, now: datetime | None = None) -> bool:
        timestamp = now or utc_now_dt()
        return self.status == "failed_retryable" and (
            self.next_retry_after is None or self.next_retry_after <= timestamp
        )

    def is_lease_expired(self, *, now: datetime | None = None) -> bool:
        timestamp = now or utc_now_dt()
        return self.status in ("claimed", "running") and (
            self.lease_expires_at is None or self.lease_expires_at <= timestamp
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "execution_id": self.execution_id,
            "handoff_id": self.handoff_id,
            "processor_profile": self.processor_profile,
            "requested_result_kind": self.requested_result_kind,
            "status": self.status,
            "result_kind": self.result_kind,
            "idempotency_key": self.idempotency_key,
            "lease_owner": self.lease_owner,
            "lease_expires_at": self.lease_expires_at,
            "attempt_count": self.attempt_count,
            "max_attempts": self.max_attempts,
            "next_retry_after": self.next_retry_after,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "failure_reason": self.failure_reason.to_payload() if self.failure_reason else None,
        }


@dataclass(frozen=True, slots=True)
class IngestionStep:
    execution_id: str
    step_id: str
    step_name: str
    status: str
    attempt_count: int
    created_at: datetime | str
    updated_at: datetime | str
    input_refs: tuple[Mapping[str, Any], ...] = ()
    output_refs: tuple[Mapping[str, Any], ...] = ()
    started_at: datetime | str | None = None
    finished_at: datetime | str | None = None
    failure_reason: FailureReason | Mapping[str, Any] | None = None
    retry_after: datetime | str | None = None

    def __post_init__(self) -> None:
        for ref in (*self.input_refs, *self.output_refs):
            validate_operator_safe_payload(ref)
        object.__setattr__(self, "execution_id", _required_text(self.execution_id, "execution_id"))
        object.__setattr__(self, "step_id", _required_text(self.step_id, "step_id"))
        object.__setattr__(self, "step_name", _required_text(self.step_name, "step_name"))
        object.__setattr__(
            self,
            "status",
            _allowlisted_text(self.status, "status", INGESTION_STEP_STATUSES),
        )
        object.__setattr__(
            self,
            "attempt_count",
            _required_non_negative_int(self.attempt_count, "attempt_count"),
        )
        object.__setattr__(
            self, "created_at", _coerce_required_datetime(self.created_at, "created_at")
        )
        object.__setattr__(
            self, "updated_at", _coerce_required_datetime(self.updated_at, "updated_at")
        )
        object.__setattr__(self, "started_at", _coerce_datetime(self.started_at))
        object.__setattr__(self, "finished_at", _coerce_datetime(self.finished_at))
        object.__setattr__(self, "retry_after", _coerce_datetime(self.retry_after))
        object.__setattr__(self, "failure_reason", _failure_reason_from_value(self.failure_reason))


@dataclass(frozen=True, slots=True)
class IngestionChildTask:
    execution_id: str
    child_task_id: str
    task_kind: str
    processor_profile: str
    status: str
    attempt_count: int
    created_at: datetime | str
    updated_at: datetime | str
    source_unit_id: str = ""
    reason_code: str = ""
    input_refs: tuple[Mapping[str, Any], ...] = ()
    output_refs: tuple[Mapping[str, Any], ...] = ()
    started_at: datetime | str | None = None
    finished_at: datetime | str | None = None

    def __post_init__(self) -> None:
        for ref in (*self.input_refs, *self.output_refs):
            validate_operator_safe_payload(ref)
        object.__setattr__(self, "execution_id", _required_text(self.execution_id, "execution_id"))
        object.__setattr__(
            self, "child_task_id", _required_text(self.child_task_id, "child_task_id")
        )
        object.__setattr__(self, "task_kind", _required_text(self.task_kind, "task_kind"))
        object.__setattr__(
            self,
            "processor_profile",
            _required_text(self.processor_profile, "processor_profile"),
        )
        object.__setattr__(
            self,
            "status",
            _allowlisted_text(self.status, "status", INGESTION_CHILD_TASK_STATUSES),
        )
        object.__setattr__(
            self,
            "attempt_count",
            _required_non_negative_int(self.attempt_count, "attempt_count"),
        )
        object.__setattr__(
            self, "created_at", _coerce_required_datetime(self.created_at, "created_at")
        )
        object.__setattr__(
            self, "updated_at", _coerce_required_datetime(self.updated_at, "updated_at")
        )
        object.__setattr__(self, "source_unit_id", str(self.source_unit_id or "").strip())
        object.__setattr__(self, "reason_code", str(self.reason_code or "").strip())
        object.__setattr__(self, "started_at", _coerce_datetime(self.started_at))
        object.__setattr__(self, "finished_at", _coerce_datetime(self.finished_at))


@dataclass(frozen=True, slots=True)
class IngestionEvent:
    event_id: str
    event_type: str
    payload: Mapping[str, Any]
    occurred_at: datetime | str
    handoff_id: str = ""
    execution_id: str = ""
    step_id: str = ""
    child_task_id: str = ""

    def __post_init__(self) -> None:
        validate_operator_safe_payload(self.payload)
        object.__setattr__(self, "event_id", _required_text(self.event_id, "event_id"))
        object.__setattr__(self, "event_type", _required_text(self.event_type, "event_type"))
        object.__setattr__(
            self, "occurred_at", _coerce_required_datetime(self.occurred_at, "occurred_at")
        )
        object.__setattr__(self, "handoff_id", str(self.handoff_id or "").strip())
        object.__setattr__(self, "execution_id", str(self.execution_id or "").strip())
        object.__setattr__(self, "step_id", str(self.step_id or "").strip())
        object.__setattr__(self, "child_task_id", str(self.child_task_id or "").strip())


def build_stable_id(prefix: str, *parts: object) -> str:
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode("utf-8")).hexdigest()
    return f"{prefix}:{digest[:32]}"


def validate_operator_safe_payload(payload: Mapping[str, Any] | Sequence[Any]) -> None:
    _validate_operator_safe_payload(payload, path=())


def utc_now_dt() -> datetime:
    return datetime.now(UTC)


def _validate_operator_safe_payload(value: object, *, path: tuple[str, ...]) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            if key_text in FORBIDDEN_PAYLOAD_FIELDS:
                dotted = ".".join((*path, key_text))
                raise ValueError(f"forbidden payload field: {dotted}")
            if isinstance(item, str):
                _reject_local_path(item, ".".join((*path, key_text)))
            _validate_operator_safe_payload(item, path=(*path, key_text))
    elif isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        for index, item in enumerate(value):
            _validate_operator_safe_payload(item, path=(*path, str(index)))


def _required_text(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} is required")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


def _allowlisted_text(value: object, label: str, allowed: frozenset[str]) -> str:
    normalized = _required_text(value, label)
    if normalized not in allowed:
        raise ValueError(f"unsupported {label}: {normalized}")
    return normalized


def _required_sha256(value: object, label: str) -> str:
    normalized = _required_text(value, label)
    if len(normalized) != 64 or any(char not in "0123456789abcdef" for char in normalized):
        raise ValueError(f"{label} must be a lowercase sha256 hex digest")
    return normalized


def _required_non_negative_int(value: object, label: str) -> int:
    parsed = _optional_non_negative_int(value, label)
    if parsed is None:
        raise ValueError(f"{label} must be a non-negative integer")
    return parsed


def _optional_non_negative_int(value: object, label: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a non-negative integer")
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a non-negative integer") from exc
    if parsed < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return parsed


def _positive_int(value: object, label: str) -> int:
    parsed = _required_non_negative_int(value, label)
    if parsed <= 0:
        raise ValueError(f"{label} must be greater than zero")
    return parsed


def _seconds_delta(seconds: int):
    from datetime import timedelta

    return timedelta(seconds=_positive_int(seconds, "lease_seconds"))


def _coerce_datetime(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    raise ValueError("datetime value must be a datetime or ISO string")


def _coerce_required_datetime(value: datetime | str | None, label: str) -> datetime:
    parsed = _coerce_datetime(value)
    if parsed is None:
        raise ValueError(f"{label} is required")
    return parsed


def _format_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _reject_local_path(value: str, label: str) -> None:
    normalized = str(value or "").strip()
    local_prefixes = ("/", "./", "../", ".tmp/", "tmp/", "var/", "./var/", "file://")
    if normalized.startswith(local_prefixes) or "\\\\" in normalized:
        raise ValueError(f"{label} must not be a local path")


def _failure_reason_from_value(
    value: FailureReason | Mapping[str, Any] | None,
) -> FailureReason | None:
    if value is None or isinstance(value, FailureReason):
        return value
    return FailureReason(
        code=str(value.get("code") or ""),
        message=str(value.get("message") or ""),
        retryable=bool(value.get("retryable")),
        source_channel=str(value.get("source_channel") or ""),
    )


def _source_run_ref_from_value(value: SourceRunRef | Mapping[str, Any]) -> SourceRunRef:
    if isinstance(value, SourceRunRef):
        return value
    return SourceRunRef(**dict(value))


def _object_ref_from_value(value: SourceObjectRef | Mapping[str, Any]) -> SourceObjectRef:
    if isinstance(value, SourceObjectRef):
        return value
    return SourceObjectRef(**dict(value))


def _optional_object_ref_from_value(
    value: SourceObjectRef | Mapping[str, Any] | None,
) -> SourceObjectRef | None:
    if value is None:
        return None
    return _object_ref_from_value(value)


__all__ = [
    "FORBIDDEN_PAYLOAD_FIELDS",
    "INGESTION_CHILD_TASK_SCHEMA_VERSION",
    "INGESTION_CHILD_TASK_STATUSES",
    "INGESTION_EVENT_SCHEMA_VERSION",
    "INGESTION_EXECUTION_SCHEMA_VERSION",
    "INGESTION_EXECUTION_STATUSES",
    "INGESTION_REQUESTED_RESULT_KINDS",
    "INGESTION_RESULT_KINDS",
    "INGESTION_STEP_SCHEMA_VERSION",
    "INGESTION_STEP_STATUSES",
    "OBJECT_VERIFICATION_STATUSES",
    "SOURCE_CHANNELS",
    "SOURCE_HANDOFF_KINDS",
    "SOURCE_HANDOFF_SCHEMA_VERSION",
    "SOURCE_HANDOFF_STATUSES",
    "SOURCE_OBJECT_ROLES",
    "SOURCE_RUN_OWNERS",
    "FailureReason",
    "IngestionChildTask",
    "IngestionEvent",
    "IngestionExecution",
    "IngestionStep",
    "ObjectVerification",
    "SourceHandoff",
    "SourceObjectRef",
    "SourceRunRef",
    "build_stable_id",
    "utc_now_dt",
    "validate_operator_safe_payload",
]
