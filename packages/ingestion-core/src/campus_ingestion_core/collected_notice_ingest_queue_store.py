from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from campus_ingestion_core.collected_notice_ingest_queue import (
    NOTICE_INGEST_QUEUE_STATUSES,
    NoticeIngestJob,
    NoticeIngestObjectRef,
    validate_notice_ingest_job_payload,
)

DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS = 3
DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS = 300


class NoticeIngestQueueError(RuntimeError):
    pass


class NoticeIngestQueueLeaseError(NoticeIngestQueueError):
    pass


class NoticeIngestQueueNotFoundError(NoticeIngestQueueError):
    pass


@dataclass(frozen=True, slots=True)
class NoticeIngestQueueRecord:
    job: NoticeIngestJob
    status: str = "queued"
    attempt_count: int = 0
    max_attempts: int = DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS
    leased_by: str | None = None
    lease_expires_at: datetime | None = None
    next_retry_after: datetime | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    def __post_init__(self) -> None:
        if self.status not in NOTICE_INGEST_QUEUE_STATUSES:
            raise ValueError(f"unsupported notice ingest queue status: {self.status}")
        if int(self.attempt_count) < 0:
            raise ValueError("attempt_count must be non-negative")
        if int(self.max_attempts) <= 0:
            raise ValueError("max_attempts must be greater than zero")
        created_at = _coerce_datetime(self.created_at) or utc_now_dt()
        updated_at = _coerce_datetime(self.updated_at) or created_at
        object.__setattr__(self, "attempt_count", int(self.attempt_count))
        object.__setattr__(self, "max_attempts", int(self.max_attempts))
        object.__setattr__(self, "created_at", created_at)
        object.__setattr__(self, "updated_at", updated_at)
        object.__setattr__(self, "lease_expires_at", _coerce_datetime(self.lease_expires_at))
        object.__setattr__(self, "next_retry_after", _coerce_datetime(self.next_retry_after))

    @property
    def job_id(self) -> str:
        return self.job.job_id

    @property
    def idempotency_key(self) -> str:
        return self.job.idempotency_key

    @property
    def job_kind(self) -> str:
        return self.job.job_kind

    @property
    def source_channel(self) -> str:
        return self.job.source_channel

    @property
    def source_surface(self) -> str:
        return self.job.source_surface

    @property
    def source_identity(self) -> str:
        return self.job.source_identity

    @property
    def capture_id(self) -> str:
        return self.job.capture_id

    @property
    def capture_manifest_object_ref(self) -> NoticeIngestObjectRef:
        return self.job.capture_manifest_object_ref

    @property
    def source_object_refs(self) -> tuple[NoticeIngestObjectRef, ...]:
        return self.job.source_object_refs

    @property
    def content_hash(self) -> str:
        return self.job.content_hash

    @property
    def run_id(self) -> str:
        return self.job.run_id

    @property
    def enqueue_source(self) -> str:
        return self.job.enqueue_source

    @property
    def replay_batch_id(self) -> str:
        return self.job.replay_batch_id

    @property
    def priority(self) -> int:
        return self.job.priority

    def claim(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        timestamp = _coerce_datetime(now) or utc_now_dt()
        normalized_worker_id = _required_text(worker_id, "worker_id")
        return replace(
            self,
            status="leased",
            leased_by=normalized_worker_id,
            lease_expires_at=timestamp + timedelta(seconds=_positive_int(lease_seconds)),
            next_retry_after=None,
            updated_at=timestamp,
        )

    def heartbeat(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        timestamp = _coerce_datetime(now) or utc_now_dt()
        self.require_lease_owner(worker_id=worker_id, now=timestamp)
        return replace(
            self,
            lease_expires_at=timestamp + timedelta(seconds=_positive_int(lease_seconds)),
            updated_at=timestamp,
        )

    def complete(
        self,
        *,
        worker_id: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        timestamp = _coerce_datetime(now) or utc_now_dt()
        self.require_lease_owner(worker_id=worker_id, now=timestamp)
        return replace(
            self,
            status="succeeded",
            leased_by=None,
            lease_expires_at=None,
            next_retry_after=None,
            last_error_code=None,
            last_error_message=None,
            updated_at=timestamp,
        )

    def fail_retryable(
        self,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        retry_after_seconds: int = 0,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        timestamp = _coerce_datetime(now) or utc_now_dt()
        self.require_lease_owner(worker_id=worker_id, now=timestamp)
        next_attempt_count = self.attempt_count + 1
        status = "dead_letter" if next_attempt_count >= self.max_attempts else "failed_retryable"
        next_retry_after = (
            None
            if status == "dead_letter"
            else timestamp + timedelta(seconds=_non_negative_int(retry_after_seconds))
        )
        return replace(
            self,
            status=status,
            attempt_count=next_attempt_count,
            leased_by=None,
            lease_expires_at=None,
            next_retry_after=next_retry_after,
            last_error_code=_required_text(error_code, "error_code"),
            last_error_message=str(error_message or ""),
            updated_at=timestamp,
        )

    def fail_terminal(
        self,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        timestamp = _coerce_datetime(now) or utc_now_dt()
        self.require_lease_owner(worker_id=worker_id, now=timestamp)
        return replace(
            self,
            status="failed_terminal",
            leased_by=None,
            lease_expires_at=None,
            next_retry_after=None,
            last_error_code=_required_text(error_code, "error_code"),
            last_error_message=str(error_message or ""),
            updated_at=timestamp,
        )

    def dead_letter(
        self,
        *,
        error_code: str | None = None,
        error_message: str | None = None,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        timestamp = _coerce_datetime(now) or utc_now_dt()
        return replace(
            self,
            status="dead_letter",
            leased_by=None,
            lease_expires_at=None,
            next_retry_after=None,
            last_error_code=error_code if error_code is not None else self.last_error_code,
            last_error_message=(
                error_message if error_message is not None else self.last_error_message
            ),
            updated_at=timestamp,
        )

    def manual_review(
        self,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        timestamp = _coerce_datetime(now) or utc_now_dt()
        self.require_lease_owner(worker_id=worker_id, now=timestamp)
        return replace(
            self,
            status="manual_review",
            leased_by=None,
            lease_expires_at=None,
            next_retry_after=None,
            last_error_code=_required_text(error_code, "error_code"),
            last_error_message=str(error_message or ""),
            updated_at=timestamp,
        )

    def block(
        self,
        *,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        timestamp = _coerce_datetime(now) or utc_now_dt()
        return replace(
            self,
            status="blocked",
            leased_by=None,
            lease_expires_at=None,
            next_retry_after=None,
            last_error_code=_required_text(error_code, "error_code"),
            last_error_message=str(error_message or ""),
            updated_at=timestamp,
        )

    def cancel(
        self,
        *,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        timestamp = _coerce_datetime(now) or utc_now_dt()
        return replace(
            self,
            status="cancelled",
            leased_by=None,
            lease_expires_at=None,
            next_retry_after=None,
            last_error_code=_required_text(error_code, "error_code"),
            last_error_message=str(error_message or ""),
            updated_at=timestamp,
        )

    def require_lease_owner(self, *, worker_id: str, now: datetime | None = None) -> None:
        normalized_worker_id = _required_text(worker_id, "worker_id")
        timestamp = _coerce_datetime(now) or utc_now_dt()
        if self.status != "leased" or self.leased_by != normalized_worker_id:
            raise NoticeIngestQueueLeaseError("notice ingest job is not leased by this worker")
        if self.lease_expires_at is not None and self.lease_expires_at <= timestamp:
            raise NoticeIngestQueueLeaseError("notice ingest job lease has expired")

    def is_lease_expired(self, *, now: datetime | None = None) -> bool:
        timestamp = _coerce_datetime(now) or utc_now_dt()
        return self.status == "leased" and (
            self.lease_expires_at is None or self.lease_expires_at <= timestamp
        )

    def is_retry_due(self, *, now: datetime | None = None) -> bool:
        timestamp = _coerce_datetime(now) or utc_now_dt()
        return self.status == "failed_retryable" and (
            self.next_retry_after is None or self.next_retry_after <= timestamp
        )

    def to_persisted_payload(self) -> dict[str, Any]:
        return {
            "job": self.job.to_payload(),
            "status": self.status,
            "attempt_count": self.attempt_count,
            "max_attempts": self.max_attempts,
            "leased_by": self.leased_by,
            "lease_expires_at": _format_datetime(self.lease_expires_at),
            "next_retry_after": _format_datetime(self.next_retry_after),
            "last_error_code": self.last_error_code,
            "last_error_message": self.last_error_message,
            "created_at": _format_datetime(self.created_at),
            "updated_at": _format_datetime(self.updated_at),
        }


class NoticeIngestQueueStore(Protocol):
    def enqueue(
        self,
        job: NoticeIngestJob,
        *,
        max_attempts: int = DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord: ...

    def enqueue_many(
        self,
        jobs: Sequence[NoticeIngestJob],
        *,
        max_attempts: int = DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS,
        now: datetime | None = None,
    ) -> tuple[NoticeIngestQueueRecord, ...]: ...

    def lease_next(
        self,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
        replay_batch_id: str | None = None,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord | None: ...

    def heartbeat(
        self,
        job_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord: ...

    def complete(
        self,
        job_id: str,
        *,
        worker_id: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord: ...

    def fail_retryable(
        self,
        job_id: str,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        retry_after_seconds: int = 0,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord: ...

    def fail_terminal(
        self,
        job_id: str,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord: ...

    def dead_letter(
        self,
        job_id: str,
        *,
        error_code: str | None = None,
        error_message: str | None = None,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord: ...

    def manual_review(
        self,
        job_id: str,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord: ...

    def block(
        self,
        job_id: str,
        *,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord: ...

    def cancel(
        self,
        job_id: str,
        *,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord: ...

    def list_status_counts(self) -> dict[str, int]: ...


def build_notice_ingest_queue_record(
    job: NoticeIngestJob,
    *,
    max_attempts: int = DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS,
    now: datetime | None = None,
) -> NoticeIngestQueueRecord:
    timestamp = _coerce_datetime(now) or utc_now_dt()
    validate_notice_ingest_job_payload(job.to_payload())
    return NoticeIngestQueueRecord(
        job=job,
        max_attempts=_positive_int(max_attempts),
        created_at=timestamp,
        updated_at=timestamp,
    )


def notice_ingest_job_from_payload(payload: Mapping[str, Any]) -> NoticeIngestJob:
    validate_notice_ingest_job_payload(payload)
    manifest_ref = _object_ref_from_payload(payload["capture_manifest_object_ref"])
    source_refs_raw = payload["source_object_refs"]
    if not isinstance(source_refs_raw, Sequence) or isinstance(source_refs_raw, str | bytes):
        raise ValueError("source_object_refs must be a sequence")
    source_refs = tuple(_object_ref_from_payload(item) for item in source_refs_raw)
    return NoticeIngestJob(
        job_id=str(payload["job_id"]),
        job_kind=str(payload["job_kind"]),
        source_channel=str(payload["source_channel"]),
        source_surface=str(payload["source_surface"]),
        source_identity=str(payload["source_identity"]),
        capture_id=str(payload["capture_id"]),
        capture_manifest_object_ref=manifest_ref,
        source_object_refs=source_refs,
        content_hash=str(payload["content_hash"]),
        run_id=str(payload["run_id"]),
        enqueue_source=str(payload["enqueue_source"]),
        replay_batch_id=str(payload["replay_batch_id"]),
        priority=int(payload["priority"]),
        idempotency_key=str(payload["idempotency_key"]),
        schema_version=str(payload["schema_version"]),
        site_id=str(payload.get("site_id") or ""),
        source_bucket=str(payload.get("source_bucket") or ""),
        bundle_object_key=str(payload.get("bundle_object_key") or ""),
        bundle_content_sha256=str(payload.get("bundle_content_sha256") or ""),
        bundle_byte_size=payload.get("bundle_byte_size"),
        manifest_object_key=str(payload.get("manifest_object_key") or ""),
        manifest_content_sha256=str(payload.get("manifest_content_sha256") or ""),
        manifest_byte_size=payload.get("manifest_byte_size"),
        retry_policy=(
            dict(payload["retry_policy"])
            if isinstance(payload.get("retry_policy"), Mapping)
            else None
        ),
        provenance=(
            dict(payload["provenance"]) if isinstance(payload.get("provenance"), Mapping) else None
        ),
    )


def zero_status_counts() -> dict[str, int]:
    return dict.fromkeys(NOTICE_INGEST_QUEUE_STATUSES, 0)


def utc_now_dt() -> datetime:
    return datetime.now(UTC)


def _object_ref_from_payload(payload: object) -> NoticeIngestObjectRef:
    if not isinstance(payload, Mapping):
        raise ValueError("object ref payload must be an object")
    return NoticeIngestObjectRef(
        bucket=str(payload.get("bucket") or ""),
        key=str(payload.get("key") or ""),
        role=str(payload.get("role") or ""),
        content_sha256=str(payload.get("content_sha256") or ""),
        byte_size=payload.get("byte_size"),
    )


def _coerce_datetime(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _format_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _coerce_datetime(value).isoformat()


def _positive_int(value: int) -> int:
    normalized = int(value)
    if normalized <= 0:
        raise ValueError("value must be greater than zero")
    return normalized


def _non_negative_int(value: int) -> int:
    normalized = int(value)
    if normalized < 0:
        raise ValueError("value must be non-negative")
    return normalized


def _required_text(value: object, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field_name} is required")
    return text


__all__ = [
    "DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS",
    "DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS",
    "NoticeIngestQueueError",
    "NoticeIngestQueueLeaseError",
    "NoticeIngestQueueNotFoundError",
    "NoticeIngestQueueRecord",
    "NoticeIngestQueueStore",
    "build_notice_ingest_queue_record",
    "notice_ingest_job_from_payload",
    "utc_now_dt",
    "zero_status_counts",
]
