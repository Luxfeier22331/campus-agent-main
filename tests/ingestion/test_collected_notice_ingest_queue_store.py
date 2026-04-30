from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from campus_ingestion_core.collected_notice_ingest_queue import (
    NoticeIngestObjectRef,
    build_notice_ingest_job,
)
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    NoticeIngestQueueLeaseError,
)


def _object_ref(role: str, suffix: str) -> NoticeIngestObjectRef:
    return NoticeIngestObjectRef(
        bucket="campus-rag-source",
        key=f"authenticated_notice_portal/runs/run-001/{suffix}.json",
        role=role,
    )


def _job(
    source_identity: str,
    *,
    content_hash: str,
    priority: int,
) -> object:
    return build_notice_ingest_job(
        source_channel="authenticated_notice_portal",
        source_surface="notice",
        source_identity=source_identity,
        capture_id=f"capture:{source_identity}:{content_hash}",
        capture_manifest_object_ref=_object_ref("source-truth/notice-manifest.json", content_hash),
        source_object_refs=(_object_ref("collector-run/bundle.json", f"bundle-{content_hash}"),),
        content_hash=content_hash,
        run_id="run-001",
        enqueue_source="historical_backfill",
        replay_batch_id="phase-4-7-backfill",
        priority=priority,
    )


class NoticeIngestQueueStoreTest(unittest.TestCase):
    def test_duplicate_enqueue_returns_existing_job_without_new_active_work(self) -> None:
        store = InMemoryNoticeIngestQueueStore()
        job = _job("muc_internal_portal:355512", content_hash="sha256-a", priority=50)

        first = store.enqueue(job, max_attempts=3, now=_dt(0))
        second = store.enqueue(job, max_attempts=5, now=_dt(10))

        self.assertEqual(second.job_id, first.job_id)
        self.assertEqual(second.idempotency_key, first.idempotency_key)
        self.assertEqual(second.priority, 50)
        self.assertEqual(second.max_attempts, 3)
        self.assertEqual(store.list_status_counts()["queued"], 1)

    def test_lease_next_uses_priority_then_fifo_ordering(self) -> None:
        store = InMemoryNoticeIngestQueueStore()
        low_priority = _job("muc_internal_portal:355512", content_hash="sha256-a", priority=50)
        first_high = _job("muc_internal_portal:355513", content_hash="sha256-b", priority=10)
        second_high = _job("muc_internal_portal:355514", content_hash="sha256-c", priority=10)
        store.enqueue(low_priority, now=_dt(0))
        store.enqueue(first_high, now=_dt(1))
        store.enqueue(second_high, now=_dt(2))

        first_lease = store.lease_next(worker_id="worker-a", lease_seconds=60, now=_dt(3))
        second_lease = store.lease_next(worker_id="worker-a", lease_seconds=60, now=_dt(4))
        third_lease = store.lease_next(worker_id="worker-a", lease_seconds=60, now=_dt(5))

        self.assertIsNotNone(first_lease)
        self.assertIsNotNone(second_lease)
        self.assertIsNotNone(third_lease)
        self.assertEqual(first_lease.job_id, first_high.job_id)
        self.assertEqual(second_lease.job_id, second_high.job_id)
        self.assertEqual(third_lease.job_id, low_priority.job_id)

    def test_expired_lease_can_be_reclaimed_by_another_worker(self) -> None:
        store = InMemoryNoticeIngestQueueStore()
        job = _job("muc_internal_portal:355512", content_hash="sha256-a", priority=50)
        store.enqueue(job, now=_dt(0))

        first_lease = store.lease_next(worker_id="worker-a", lease_seconds=30, now=_dt(1))
        blocked = store.lease_next(worker_id="worker-b", lease_seconds=30, now=_dt(20))
        reclaimed = store.lease_next(worker_id="worker-b", lease_seconds=30, now=_dt(32))

        self.assertIsNotNone(first_lease)
        self.assertIsNone(blocked)
        self.assertIsNotNone(reclaimed)
        self.assertEqual(reclaimed.job_id, job.job_id)
        self.assertEqual(reclaimed.leased_by, "worker-b")

    def test_non_owner_cannot_heartbeat_complete_or_fail(self) -> None:
        store = InMemoryNoticeIngestQueueStore()
        job = _job("muc_internal_portal:355512", content_hash="sha256-a", priority=50)
        store.enqueue(job, now=_dt(0))
        leased = store.lease_next(worker_id="worker-a", lease_seconds=60, now=_dt(1))
        self.assertIsNotNone(leased)

        with self.assertRaises(NoticeIngestQueueLeaseError):
            store.heartbeat(job.job_id, worker_id="worker-b", lease_seconds=60, now=_dt(2))
        with self.assertRaises(NoticeIngestQueueLeaseError):
            store.complete(job.job_id, worker_id="worker-b", now=_dt(3))
        with self.assertRaises(NoticeIngestQueueLeaseError):
            store.fail_retryable(
                job.job_id,
                worker_id="worker-b",
                error_code="not-owner",
                error_message="worker mismatch",
                now=_dt(4),
            )

        still_leased = store.get(job.job_id)
        self.assertIsNotNone(still_leased)
        self.assertEqual(still_leased.status, "leased")
        self.assertEqual(still_leased.leased_by, "worker-a")

    def test_retryable_failures_dead_letter_after_max_attempts(self) -> None:
        store = InMemoryNoticeIngestQueueStore()
        job = _job("muc_internal_portal:355512", content_hash="sha256-a", priority=50)
        store.enqueue(job, max_attempts=2, now=_dt(0))

        store.lease_next(worker_id="worker-a", lease_seconds=60, now=_dt(1))
        first_failure = store.fail_retryable(
            job.job_id,
            worker_id="worker-a",
            error_code="temporary",
            error_message="first failure",
            now=_dt(2),
        )
        too_early = store.lease_next(worker_id="worker-a", lease_seconds=60, now=_dt(1))
        retry_lease = store.lease_next(worker_id="worker-a", lease_seconds=60, now=_dt(3))
        self.assertIsNone(too_early)
        self.assertIsNotNone(retry_lease)
        final_failure = store.fail_retryable(
            job.job_id,
            worker_id="worker-a",
            error_code="temporary",
            error_message="second failure",
            now=_dt(4),
        )

        self.assertEqual(first_failure.status, "failed_retryable")
        self.assertEqual(first_failure.attempt_count, 1)
        self.assertEqual(first_failure.next_retry_after, _dt(2))
        self.assertEqual(final_failure.status, "dead_letter")
        self.assertEqual(final_failure.attempt_count, 2)
        self.assertEqual(store.list_status_counts()["dead_letter"], 1)

    def test_retryable_failure_can_delay_next_lease_until_retry_after(self) -> None:
        store = InMemoryNoticeIngestQueueStore()
        job = _job("muc_internal_portal:355512", content_hash="sha256-a", priority=50)
        store.enqueue(job, max_attempts=3, now=_dt(0))
        store.lease_next(worker_id="worker-a", lease_seconds=60, now=_dt(1))

        failure = store.fail_retryable(
            job.job_id,
            worker_id="worker-a",
            error_code="temporary",
            error_message="wait before retry",
            retry_after_seconds=30,
            now=_dt(2),
        )
        too_early = store.lease_next(worker_id="worker-b", lease_seconds=60, now=_dt(20))
        due = store.lease_next(worker_id="worker-b", lease_seconds=60, now=_dt(33))

        self.assertEqual(failure.status, "failed_retryable")
        self.assertEqual(failure.next_retry_after, _dt(32))
        self.assertIsNone(too_early)
        self.assertIsNotNone(due)
        self.assertEqual(due.leased_by, "worker-b")

    def test_manual_review_block_and_cancel_states_are_visible(self) -> None:
        store = InMemoryNoticeIngestQueueStore()
        review_job = _job("muc_internal_portal:355512", content_hash="sha256-a", priority=50)
        blocked_job = _job("muc_internal_portal:355513", content_hash="sha256-b", priority=50)
        cancelled_job = _job("muc_internal_portal:355514", content_hash="sha256-c", priority=50)
        store.enqueue_many((review_job, blocked_job, cancelled_job), now=_dt(0))

        store.lease_next(worker_id="worker-a", lease_seconds=60, now=_dt(1))
        review = store.manual_review(
            review_job.job_id,
            worker_id="worker-a",
            error_code="media_gate_failed",
            error_message="strict audit requires operator review",
            now=_dt(2),
        )
        blocked = store.block(
            blocked_job.job_id,
            error_code="missing_repair_ledger",
            error_message="local-only artifact requires repair ledger",
            now=_dt(3),
        )
        cancelled = store.cancel(
            cancelled_job.job_id,
            error_code="operator_cancelled",
            error_message="superseded run",
            now=_dt(4),
        )

        self.assertEqual(review.status, "manual_review")
        self.assertEqual(blocked.status, "blocked")
        self.assertEqual(cancelled.status, "cancelled")
        counts = store.list_status_counts()
        self.assertEqual(counts["manual_review"], 1)
        self.assertEqual(counts["blocked"], 1)
        self.assertEqual(counts["cancelled"], 1)

    def test_terminal_failure_and_status_counts_are_visible(self) -> None:
        store = InMemoryNoticeIngestQueueStore()
        job = _job("muc_internal_portal:355512", content_hash="sha256-a", priority=50)
        store.enqueue(job, now=_dt(0))
        store.lease_next(worker_id="worker-a", lease_seconds=60, now=_dt(1))

        terminal = store.fail_terminal(
            job.job_id,
            worker_id="worker-a",
            error_code="invalid_capture",
            error_message="missing source object",
            now=_dt(2),
        )

        self.assertEqual(terminal.status, "failed_terminal")
        counts = store.list_status_counts()
        self.assertEqual(counts["failed_terminal"], 1)
        for status in (
            "queued",
            "leased",
            "succeeded",
            "failed_retryable",
            "failed_terminal",
            "dead_letter",
            "manual_review",
            "blocked",
            "cancelled",
        ):
            self.assertIn(status, counts)


def _dt(offset_seconds: int) -> datetime:
    return datetime(2026, 4, 29, 12, 0, tzinfo=UTC) + timedelta(seconds=offset_seconds)


if __name__ == "__main__":
    unittest.main()
