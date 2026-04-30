from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from threading import RLock

from campus_ingestion_core.collected_notice_ingest_queue import NoticeIngestJob
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
    DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS,
    NoticeIngestQueueNotFoundError,
    NoticeIngestQueueRecord,
    build_notice_ingest_queue_record,
    utc_now_dt,
    zero_status_counts,
)


class InMemoryNoticeIngestQueueStore:
    def __init__(self) -> None:
        self._records_by_job_id: dict[str, NoticeIngestQueueRecord] = {}
        self._job_id_by_idempotency_key: dict[str, str] = {}
        self._lock = RLock()

    def enqueue(
        self,
        job: NoticeIngestJob,
        *,
        max_attempts: int = DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        timestamp = now or utc_now_dt()
        with self._lock:
            existing_job_id = self._job_id_by_idempotency_key.get(job.idempotency_key)
            if existing_job_id is not None:
                return self._records_by_job_id[existing_job_id]
            record = build_notice_ingest_queue_record(
                job,
                max_attempts=max_attempts,
                now=timestamp,
            )
            self._records_by_job_id[record.job_id] = record
            self._job_id_by_idempotency_key[record.idempotency_key] = record.job_id
            return record

    def enqueue_many(
        self,
        jobs: Sequence[NoticeIngestJob],
        *,
        max_attempts: int = DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS,
        now: datetime | None = None,
    ) -> tuple[NoticeIngestQueueRecord, ...]:
        return tuple(self.enqueue(job, max_attempts=max_attempts, now=now) for job in jobs)

    def get(self, job_id: str) -> NoticeIngestQueueRecord | None:
        with self._lock:
            return self._records_by_job_id.get(str(job_id))

    def lease_next(
        self,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
        replay_batch_id: str | None = None,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord | None:
        timestamp = now or utc_now_dt()
        normalized_replay_batch_id = str(replay_batch_id or "").strip()
        with self._lock:
            candidates = [
                record
                for record in self._records_by_job_id.values()
                if (
                    record.status == "queued"
                    or record.is_retry_due(now=timestamp)
                    or record.is_lease_expired(now=timestamp)
                )
            ]
            if normalized_replay_batch_id:
                candidates = [
                    record
                    for record in candidates
                    if record.replay_batch_id == normalized_replay_batch_id
                ]
            if not candidates:
                return None
            selected = sorted(
                candidates,
                key=lambda record: (record.priority, record.created_at, record.job_id),
            )[0]
            claimed = selected.claim(
                worker_id=worker_id,
                lease_seconds=lease_seconds,
                now=timestamp,
            )
            self._records_by_job_id[claimed.job_id] = claimed
            return claimed

    def heartbeat(
        self,
        job_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        with self._lock:
            record = self._require(job_id)
            updated = record.heartbeat(worker_id=worker_id, lease_seconds=lease_seconds, now=now)
            self._records_by_job_id[updated.job_id] = updated
            return updated

    def complete(
        self,
        job_id: str,
        *,
        worker_id: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        with self._lock:
            record = self._require(job_id)
            updated = record.complete(worker_id=worker_id, now=now)
            self._records_by_job_id[updated.job_id] = updated
            return updated

    def fail_retryable(
        self,
        job_id: str,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        retry_after_seconds: int = 0,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        with self._lock:
            record = self._require(job_id)
            updated = record.fail_retryable(
                worker_id=worker_id,
                error_code=error_code,
                error_message=error_message,
                retry_after_seconds=retry_after_seconds,
                now=now,
            )
            self._records_by_job_id[updated.job_id] = updated
            return updated

    def fail_terminal(
        self,
        job_id: str,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        with self._lock:
            record = self._require(job_id)
            updated = record.fail_terminal(
                worker_id=worker_id,
                error_code=error_code,
                error_message=error_message,
                now=now,
            )
            self._records_by_job_id[updated.job_id] = updated
            return updated

    def dead_letter(
        self,
        job_id: str,
        *,
        error_code: str | None = None,
        error_message: str | None = None,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        with self._lock:
            record = self._require(job_id)
            updated = record.dead_letter(
                error_code=error_code,
                error_message=error_message,
                now=now,
            )
            self._records_by_job_id[updated.job_id] = updated
            return updated

    def manual_review(
        self,
        job_id: str,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        with self._lock:
            record = self._require(job_id)
            updated = record.manual_review(
                worker_id=worker_id,
                error_code=error_code,
                error_message=error_message,
                now=now,
            )
            self._records_by_job_id[updated.job_id] = updated
            return updated

    def block(
        self,
        job_id: str,
        *,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        with self._lock:
            record = self._require(job_id)
            updated = record.block(
                error_code=error_code,
                error_message=error_message,
                now=now,
            )
            self._records_by_job_id[updated.job_id] = updated
            return updated

    def cancel(
        self,
        job_id: str,
        *,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        with self._lock:
            record = self._require(job_id)
            updated = record.cancel(
                error_code=error_code,
                error_message=error_message,
                now=now,
            )
            self._records_by_job_id[updated.job_id] = updated
            return updated

    def list_status_counts(self) -> dict[str, int]:
        counts = zero_status_counts()
        with self._lock:
            for record in self._records_by_job_id.values():
                counts[record.status] += 1
        return counts

    def _require(self, job_id: str) -> NoticeIngestQueueRecord:
        record = self._records_by_job_id.get(str(job_id))
        if record is None:
            raise NoticeIngestQueueNotFoundError(f"notice ingest job not found: {job_id}")
        return record


__all__ = ["InMemoryNoticeIngestQueueStore"]
