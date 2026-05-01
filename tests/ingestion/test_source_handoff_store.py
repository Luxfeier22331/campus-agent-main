from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from campus_ingestion_core.source_handoff_state_machine import (
    FailureReason,
    IngestionExecution,
    ObjectVerification,
    SourceHandoff,
    SourceObjectRef,
    SourceRunRef,
)
from campus_ingestion_core.source_handoff_store import (
    InMemorySourceHandoffStore,
    SourceHandoffConflictError,
    SourceHandoffLeaseError,
)


class SourceHandoffStoreTest(unittest.TestCase):
    def test_handoff_idempotency_and_verified_execution_claim_lifecycle(self) -> None:
        now = datetime(2026, 5, 1, 8, 0, tzinfo=UTC)
        store = InMemorySourceHandoffStore()
        handoff = _handoff(now=now)

        first = store.create_or_get_handoff(handoff)
        second = store.create_or_get_handoff(handoff)

        self.assertEqual(first.handoff_id, second.handoff_id)
        with self.assertRaises(SourceHandoffConflictError):
            store.create_or_get_handoff(
                SourceHandoff(
                    **{
                        **handoff.to_payload(),
                        "handoff_id": "handoff-conflict",
                        "source_run_ref": handoff.source_run_ref,
                        "required_objects": handoff.required_objects,
                        "optional_objects": handoff.optional_objects,
                    }
                )
            )

        store.record_object_verification(
            ObjectVerification(
                verification_id="verification-001",
                handoff_id=handoff.handoff_id,
                object_role="handoff_bundle",
                bucket="campus-rag-source",
                object_key="official_web/run-001/source_truth_bundle.json",
                status="matched",
                expected_sha256="a" * 64,
                observed_sha256="a" * 64,
                expected_byte_size=4096,
                observed_byte_size=4096,
                checked_at=now,
            )
        )
        verified = store.mark_handoff_verified(handoff.handoff_id, now=now)
        execution = store.enqueue_execution(_execution(verified.handoff_id, now=now))

        claimed = store.claim_next_execution(
            worker_id="worker-001",
            lease_seconds=60,
            now=now,
        )

        self.assertIsNotNone(claimed)
        assert claimed is not None
        self.assertEqual(claimed.execution_id, execution.execution_id)
        self.assertEqual(claimed.status, "claimed")
        self.assertEqual(claimed.attempt_count, 1)

        heartbeat = store.heartbeat_execution(
            claimed.execution_id,
            worker_id="worker-001",
            lease_seconds=60,
            now=now + timedelta(seconds=30),
        )
        self.assertEqual(heartbeat.lease_owner, "worker-001")
        with self.assertRaises(SourceHandoffLeaseError):
            store.heartbeat_execution(
                claimed.execution_id,
                worker_id="worker-002",
                lease_seconds=60,
                now=now + timedelta(seconds=40),
            )

        completed = store.complete_execution(
            claimed.execution_id,
            worker_id="worker-001",
            result_kind="staged",
            now=now + timedelta(seconds=45),
        )

        self.assertEqual(completed.status, "completed")
        self.assertEqual(completed.result_kind, "staged")

    def test_retryable_failure_exhausts_to_dead_letter(self) -> None:
        now = datetime(2026, 5, 1, 8, 0, tzinfo=UTC)
        store = InMemorySourceHandoffStore()
        handoff = store.mark_handoff_verified(
            store.create_or_get_handoff(_handoff(now=now)).handoff_id,
            now=now,
        )
        execution = store.enqueue_execution(_execution(handoff.handoff_id, now=now, max_attempts=1))
        claimed = store.claim_next_execution(worker_id="worker-001", lease_seconds=60, now=now)
        assert claimed is not None

        failed = store.fail_execution_retryable(
            execution.execution_id,
            worker_id="worker-001",
            failure_reason=FailureReason(code="object_store_timeout", message="timeout"),
            retry_after_seconds=30,
            now=now + timedelta(seconds=5),
        )

        self.assertEqual(failed.status, "dead_letter")
        self.assertEqual(failed.result_kind, "failed")
        self.assertIsNone(store.claim_next_execution(worker_id="worker-001", lease_seconds=60))


def _handoff(*, now: datetime) -> SourceHandoff:
    run_ref = SourceRunRef(
        source_channel="official_web",
        source_surface="baseline",
        site_id="muc_official",
        source_run_id="run-001",
        source_run_owner="app_api_official_web",
        source_run_status="completed",
        source_run_terminal_at=now,
        source_run_ref="official_web:crawl_run:run-001",
    )
    bundle = SourceObjectRef(
        object_role="handoff_bundle",
        bucket="campus-rag-source",
        object_key="official_web/run-001/source_truth_bundle.json",
        content_sha256="a" * 64,
        byte_size=4096,
        required=True,
    )
    return SourceHandoff(
        handoff_id="handoff-001",
        schema_version="source_handoff.v1",
        source_run_ref=run_ref,
        handoff_kind="official_web_source_truth_replay",
        source_bucket="campus-rag-source",
        required_objects=(bundle,),
        idempotency_key="official_web:event-001",
        status="created",
        created_at=now,
        updated_at=now,
    )


def _execution(
    handoff_id: str,
    *,
    now: datetime,
    max_attempts: int = 3,
) -> IngestionExecution:
    return IngestionExecution(
        execution_id=f"exec-{handoff_id}",
        handoff_id=handoff_id,
        processor_profile="official_web_source_truth_replay",
        requested_result_kind="stage_only",
        status="queued",
        result_kind="none",
        attempt_count=0,
        max_attempts=max_attempts,
        created_at=now,
        updated_at=now,
    )


if __name__ == "__main__":
    unittest.main()
