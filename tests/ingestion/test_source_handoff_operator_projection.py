from __future__ import annotations

import unittest
from datetime import UTC, datetime

from campus_ingestion_core.source_handoff_operator_projection import (
    build_source_handoff_operator_projection,
)
from campus_ingestion_core.source_handoff_state_machine import (
    IngestionChildTask,
    IngestionExecution,
    IngestionStep,
    ObjectVerification,
    SourceHandoff,
    SourceObjectRef,
    SourceRunRef,
)
from campus_ingestion_core.source_handoff_store import InMemorySourceHandoffStore


class SourceHandoffOperatorProjectionTest(unittest.TestCase):
    def test_projection_returns_operator_safe_per_execution_summary(self) -> None:
        now = datetime(2026, 5, 1, tzinfo=UTC)
        store = InMemorySourceHandoffStore()
        handoff = store.create_or_get_handoff(_handoff(now=now))
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
        claimed = store.claim_next_execution(worker_id="worker-001", lease_seconds=60, now=now)
        assert claimed is not None
        completed = store.complete_execution(
            execution.execution_id,
            worker_id="worker-001",
            result_kind="staged",
            now=now,
        )
        store.upsert_step(
            IngestionStep(
                execution_id=completed.execution_id,
                step_id="step-001",
                step_name="source_truth_import",
                status="passed",
                attempt_count=1,
                output_refs=(
                    {
                        "role": "source_truth_bundle",
                        "bucket": "campus-rag-source",
                        "object_key": "official_web/run-001/source_truth_bundle.json",
                        "content_sha256": "a" * 64,
                    },
                    {"role": "debug_report", "artifact_path": "debug/local-report.json"},
                ),
                created_at=now,
                updated_at=now,
            )
        )
        store.upsert_child_task(
            IngestionChildTask(
                execution_id=completed.execution_id,
                child_task_id="child-001",
                task_kind="cleanup_guard",
                processor_profile="official_web_source_truth_replay",
                status="completed",
                reason_code="dry_run_recorded",
                attempt_count=1,
                created_at=now,
                updated_at=now,
            )
        )

        projection = build_source_handoff_operator_projection(store=store, now=now)
        record = projection["records"][0]

        self.assertEqual(projection["schema_version"], "source_handoff_operator_projection.v1")
        self.assertEqual(record["source_channel"], "official_web")
        self.assertEqual(record["handoff"]["status"], "verified")
        self.assertEqual(record["handoff"]["required_object_count"], 1)
        self.assertEqual(record["handoff"]["verified_object_count"], 1)
        self.assertEqual(record["execution"]["execution_id"], completed.execution_id)
        self.assertEqual(record["execution"]["status"], "completed")
        self.assertEqual(record["execution"]["result_kind"], "staged")
        self.assertEqual(record["steps"]["by_status"], {"passed": 1})
        self.assertEqual(record["child_tasks"]["by_status"], {"completed": 1})
        self.assertEqual(
            record["safe_output_refs"],
            [
                {
                    "role": "source_truth_bundle",
                    "bucket": "campus-rag-source",
                    "object_key": "official_web/run-001/source_truth_bundle.json",
                    "content_sha256": "a" * 64,
                }
            ],
        )


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


def _execution(handoff_id: str, *, now: datetime) -> IngestionExecution:
    return IngestionExecution(
        execution_id="execution-001",
        handoff_id=handoff_id,
        processor_profile="official_web_source_truth_replay",
        requested_result_kind="stage_only",
        status="queued",
        result_kind="none",
        attempt_count=0,
        max_attempts=3,
        created_at=now,
        updated_at=now,
    )


if __name__ == "__main__":
    unittest.main()
