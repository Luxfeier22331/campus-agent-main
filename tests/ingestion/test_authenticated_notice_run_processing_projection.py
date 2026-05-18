from __future__ import annotations

import unittest
from datetime import UTC, datetime

from campus_ingestion_core.authenticated_notice_run_processing_projection import (
    build_authenticated_notice_run_processing_snapshots,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import NoticeIngestQueueRecord

from tests.ingestion import authenticated_notice_run_queue_consumer_support as support


class AuthenticatedNoticeRunProcessingProjectionTest(unittest.TestCase):
    def test_groups_queue_attempts_by_collector_run_token(self) -> None:
        collector_run_token = "20260428T181953007Z"
        bundle_bytes = support._json_bytes([{"notice_id": "355867"}])
        manifest_bytes = support._json_bytes({"run_id": collector_run_token})
        first_job = support._job(
            run_id=f"muc_internal_portal:notice:{collector_run_token}:smoke:20260501T012606Z",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        failed_job = support._job(
            run_id=f"muc_internal_portal:notice:{collector_run_token}:downstream-repair:20260501T103000Z",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        records = (
            NoticeIngestQueueRecord(
                job=first_job,
                status="succeeded",
                attempt_count=0,
                created_at=datetime(2026, 5, 1, 1, 26, 6, tzinfo=UTC),
                updated_at=datetime(2026, 5, 1, 1, 27, 0, tzinfo=UTC),
            ),
            NoticeIngestQueueRecord(
                job=failed_job,
                status="failed_terminal",
                attempt_count=1,
                last_error_code="downstream_materialization_failed",
                last_error_message="typed materializer returned terminal failure",
                created_at=datetime(2026, 5, 1, 10, 30, 0, tzinfo=UTC),
                updated_at=datetime(2026, 5, 1, 10, 31, 0, tzinfo=UTC),
            ),
        )
        trace_rows = (
            {
                "job_id": first_job.job_id,
                "status": "completed",
                "generated_at": "2026-05-01T01:27:00.000Z",
                "import_result": {
                    "selected_notices": [{"notice_id": "355867", "title": "通勤班车调整通知"}],
                    "selected_notice_ids": ["355867"],
                },
                "child_task_summary": {
                    "by_kind": {"downstream_materialization": 1},
                    "by_state": {"completed": 3},
                    "task_count": 3,
                },
                "progress_events": [
                    {
                        "event_id": "run-event-001",
                        "generated_at": "2026-05-01T01:27:00.000Z",
                        "stage": "downstream_materialization",
                        "transition": "completed",
                        "message": "downstream materialization completed",
                        "object_key": "derived/raw-object-key-must-not-leak.json",
                    }
                ],
                "downstream_materialization": {
                    "status": "completed",
                    "typed_materialization": {
                        "status": "completed",
                        "materialized_releases": [
                            {
                                "candidate_kind": "transport_schedule",
                                "collection": "transport_schedule",
                                "current": True,
                                "notice_ids": ["355867"],
                                "release_id": "transport-schedule-run-001",
                            }
                        ],
                    },
                },
            },
            {
                "job_id": failed_job.job_id,
                "status": "failed_terminal",
                "generated_at": "2026-05-01T10:31:00.000Z",
                "error_code": "downstream_materialization_failed",
                "error_message": "typed materializer returned terminal failure",
                "progress_events": [
                    {
                        "event_id": "run-event-002",
                        "generated_at": "2026-05-01T10:31:00.000Z",
                        "stage": "downstream_materialization",
                        "transition": "failed_terminal",
                        "message": "downstream materialization failed",
                        "artifact_path": "/tmp/raw-operation-path-must-not-leak",
                    }
                ],
            },
        )

        snapshots = build_authenticated_notice_run_processing_snapshots(
            records=records,
            trace_rows=trace_rows,
            projected_at="2026-05-01T10:32:00.000Z",
            producer_version="test@1",
        )

        self.assertEqual(len(snapshots), 1)
        snapshot = snapshots[0]
        self.assertEqual(snapshot["collectorRunToken"], collector_run_token)
        self.assertEqual(snapshot["queueJobCount"], 2)
        self.assertEqual(snapshot["queueStatusCounts"]["succeeded"], 1)
        self.assertEqual(snapshot["queueStatusCounts"]["failed_terminal"], 1)
        self.assertEqual(snapshot["lifecycleStatus"], "mixed_terminal")
        self.assertEqual(snapshot["latestQueueStatus"], "failed_terminal")
        self.assertEqual(snapshot["attemptCount"], 2)
        self.assertEqual(snapshot["sourceTruth"]["selectedNoticeCount"], 1)
        self.assertEqual(snapshot["downstream"]["materializedReleaseCount"], 1)
        self.assertEqual(snapshot["downstream"]["candidateKinds"], ["transport_schedule"])
        self.assertEqual(len(snapshot["jobSummaries"]), 2)
        self.assertFalse(_contains_forbidden_key(snapshot))

    def test_source_truth_only_collector_run_uses_import_count(self) -> None:
        collector_run_token = "20260428T181953007Z"
        bundle_bytes = support._json_bytes([{"notice_id": "355867"}])
        manifest_bytes = support._json_bytes({"run_id": collector_run_token})
        job = support._job(
            run_id=f"muc_internal_portal:notice:{collector_run_token}",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        record = NoticeIngestQueueRecord(
            job=job,
            status="succeeded",
            attempt_count=0,
            created_at=datetime(2026, 5, 1, 0, 8, 0, tzinfo=UTC),
            updated_at=datetime(2026, 5, 1, 0, 9, 11, tzinfo=UTC),
        )

        snapshots = build_authenticated_notice_run_processing_snapshots(
            records=(record,),
            trace_rows=(
                {
                    "job_id": job.job_id,
                    "status": "completed",
                    "generated_at": "2026-05-01T00:09:11.528648+00:00",
                    "import_result": {
                        "attachment_fetch_status_record_count": 305,
                        "mode": "admit_and_materialize",
                        "notice_count": 282,
                        "raw_reused_count": 75,
                        "raw_uploaded_count": 207,
                        "source_truth_only": True,
                    },
                },
            ),
            projected_at="2026-05-01T00:10:00.000Z",
            producer_version="test@1",
        )

        source_truth = snapshots[0]["sourceTruth"]
        self.assertEqual(source_truth["selectedNoticeCount"], 282)
        self.assertEqual(source_truth["importedNoticeCount"], 282)
        self.assertEqual(source_truth["attachmentFetchStatusRecordCount"], 305)
        self.assertEqual(source_truth["rawUploadedCount"], 207)
        self.assertEqual(source_truth["rawReusedCount"], 75)
        self.assertEqual(snapshots[0]["jobSummaries"][0]["selectedNoticeCount"], 282)


def _contains_forbidden_key(value: object) -> bool:
    forbidden = {
        "artifact_path",
        "attachmentBytes",
        "attachments",
        "bodyText",
        "bucket",
        "key",
        "localPath",
        "objectKey",
        "object_key",
        "ocrText",
        "output_refs",
        "rawHtml",
        "sourceObjectRefs",
        "source_object_refs",
    }
    if isinstance(value, dict):
        return any(key in forbidden or _contains_forbidden_key(item) for key, item in value.items())
    if isinstance(value, list):
        return any(_contains_forbidden_key(item) for item in value)
    return False


if __name__ == "__main__":
    unittest.main()
