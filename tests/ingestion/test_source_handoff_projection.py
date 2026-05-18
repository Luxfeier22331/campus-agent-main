from __future__ import annotations

import unittest
from datetime import UTC, datetime

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AuthenticatedNoticeCollectorRunObjectRefs,
)
from campus_ingestion_core.source_handoff_projection import (
    authenticated_notice_child_task_to_ingestion_child_task,
    authenticated_notice_execution_from_verified_handoff,
    authenticated_notice_object_refs_from_run_refs,
    authenticated_notice_queue_status_to_execution_projection,
    authenticated_notice_source_handoff_from_ledger,
    authenticated_notice_source_run_ref_from_ledger,
    official_web_execution_from_verified_handoff,
    official_web_execution_to_app_api_projection,
    official_web_object_refs_from_artifacts,
    official_web_source_handoff_from_event,
    official_web_source_run_ref_from_projection,
)


class SourceHandoffProjectionTest(unittest.TestCase):
    def test_official_web_projection_builds_handoff_objects_and_app_api_status(self) -> None:
        now = datetime(2026, 5, 1, tzinfo=UTC)
        run_ref = official_web_source_run_ref_from_projection(
            site_id="muc_official",
            run_id="run-001",
            run_status="completed",
            run_intent="baseline",
            terminal_at=now,
        )
        objects = official_web_object_refs_from_artifacts(
            [
                {
                    "artifact_type": "source_truth_bundle",
                    "bucket": "campus-rag-source",
                    "object_key": "official_web/run-001/source_truth_bundle.json",
                    "content_sha256": "a" * 64,
                    "byte_size": 4096,
                },
                {
                    "artifact_type": "quality_audit",
                    "bucket": "campus-rag-source",
                    "object_key": "official_web/run-001/quality.json",
                    "content_sha256": "b" * 64,
                    "byte_size": 512,
                },
            ]
        )
        handoff = official_web_source_handoff_from_event(
            event_id="event-001",
            source_run_ref=run_ref,
            source_bucket="campus-rag-source",
            required_objects=tuple(ref for ref in objects if ref.required),
            optional_objects=tuple(ref for ref in objects if not ref.required),
            created_at=now,
        )
        execution = official_web_execution_from_verified_handoff(
            handoff.mark_verified(now=now),
            created_at=now,
        )
        completed = execution.claim(
            worker_id="worker-001",
            lease_seconds=60,
            now=now,
        ).complete(result_kind="staged", worker_id="worker-001", now=now)
        projection = official_web_execution_to_app_api_projection(completed)

        self.assertEqual(handoff.handoff_kind, "official_web_source_truth_replay")
        self.assertEqual(execution.requested_result_kind, "stage_only")
        self.assertEqual(projection["ingestion_execution_status"], "staged")
        self.assertEqual(projection["ingestion_execution_ref"], execution.execution_id)

    def test_authenticated_notice_projection_preserves_queue_and_child_task_reason(self) -> None:
        now = datetime(2026, 5, 1, tzinfo=UTC)
        run_refs = AuthenticatedNoticeCollectorRunObjectRefs(
            run_id="run-001",
            source_surface="notice",
            source_bucket="campus-rag-source",
            bundle_object_key="authenticated_notice_portal/runs/run-001/bundle.json",
            manifest_object_key="authenticated_notice_portal/runs/run-001/manifest.json",
            bundle_content_sha256="a" * 64,
            bundle_byte_size=4096,
            manifest_content_sha256="b" * 64,
            manifest_byte_size=2048,
        )
        run_ref = authenticated_notice_source_run_ref_from_ledger(
            run_refs,
            site_id="muc_internal_portal",
            source_run_terminal_at=now,
        )
        object_refs = authenticated_notice_object_refs_from_run_refs(run_refs)
        handoff = authenticated_notice_source_handoff_from_ledger(
            source_run_ref=run_ref,
            run_refs=run_refs,
            required_objects=object_refs,
            created_at=now,
        ).mark_verified(now=now)
        execution = authenticated_notice_execution_from_verified_handoff(
            handoff,
            processor_profile="mixed_notice",
            requested_result_kind="materialize_only",
            created_at=now,
        )
        projection = authenticated_notice_queue_status_to_execution_projection(
            queue_status="leased",
            has_running_step=True,
        )
        child_task = authenticated_notice_child_task_to_ingestion_child_task(
            execution_id=execution.execution_id,
            child_task={
                "task_id": "authenticated_notice_child_task:001",
                "task_kind": "downstream_materialization",
                "processor_profile_id": "mixed_notice",
                "state": "manual_review",
                "attempt_ordinal": 1,
                "reason_code": "consumer_admission_missing",
            },
            created_at=now,
        )

        self.assertEqual(handoff.handoff_kind, "authenticated_notice_import")
        self.assertEqual(execution.processor_profile, "mixed_notice")
        self.assertEqual(projection["status"], "running")
        self.assertEqual(child_task.status, "manual_review")
        self.assertEqual(child_task.reason_code, "consumer_admission_missing")


if __name__ == "__main__":
    unittest.main()
