from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_processing_projection_backfill import (
    backfill_authenticated_notice_processing_projection,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    NoticeIngestQueueRecord,
    build_notice_ingest_queue_record,
)

from tests.ingestion import authenticated_notice_run_queue_consumer_support as support


class _RecordingReporter:
    def __init__(self) -> None:
        self.snapshots: list[dict[str, object]] = []

    def report(self, *, snapshots):
        self.snapshots.extend(dict(snapshot) for snapshot in snapshots)


class AuthenticatedNoticeProcessingProjectionBackfillTest(unittest.TestCase):
    def test_backfills_selected_notice_from_historical_trace_without_queue_mutation(self) -> None:
        record = _record("run-001")
        reporter = _RecordingReporter()

        result = backfill_authenticated_notice_processing_projection(
            records=(record,),
            trace_rows=(_completed_transport_trace(record),),
            reporter=reporter,
            notice_ids=("355867",),
            projected_at="2026-05-01T09:00:00.000Z",
            producer_version="test.backfill@1",
        )

        self.assertEqual(result["candidate_record_count"], 1)
        self.assertEqual(result["reported_snapshot_count"], 1)
        self.assertEqual(result["medium_or_higher_finding_count"], 0)
        self.assertEqual(len(reporter.snapshots), 1)
        snapshot = reporter.snapshots[0]
        self.assertEqual(snapshot["noticeId"], "355867")
        self.assertEqual(snapshot["candidateKind"], "transport_schedule")
        self.assertEqual(snapshot["targetSurface"], "campus_services")
        self.assertEqual(snapshot["readModelCounts"]["scheduledDepartures"], 49)
        self.assertTrue(snapshot["toolReady"])
        self.assertEqual(snapshot["producerVersion"], "test.backfill@1")
        self.assertEqual(record.status, "queued")

    def test_merges_failed_and_successful_attempt_events_into_effective_snapshot(self) -> None:
        record = _record("run-001")
        reporter = _RecordingReporter()

        result = backfill_authenticated_notice_processing_projection(
            records=(record,),
            trace_rows=(
                _failed_trace(record, generated_at="2026-05-01T07:00:00.000Z"),
                _completed_transport_trace(record, generated_at="2026-05-01T08:00:00.000Z"),
            ),
            reporter=reporter,
            notice_ids=("355867",),
            projected_at="2026-05-01T09:00:00.000Z",
        )

        self.assertEqual(result["reported_snapshot_count"], 1)
        snapshot = reporter.snapshots[0]
        self.assertEqual(snapshot["lifecycleStatus"], "tool_ready")
        timeline_summaries = [item["summary"] for item in snapshot["timeline"]]
        self.assertIn("import failed before downstream materialization", timeline_summaries)
        self.assertIn("downstream materialization completed", timeline_summaries)

    def test_reports_medium_findings_for_missing_trace_rows_and_empty_projection(self) -> None:
        record = _record("run-001")
        reporter = _RecordingReporter()

        result = backfill_authenticated_notice_processing_projection(
            records=(record, _record("run-002")),
            trace_rows=(
                {
                    "job_id": record.job_id,
                    "run_id": record.run_id,
                    "status": "completed",
                    "import_result": {},
                },
            ),
            reporter=reporter,
            projected_at="2026-05-01T09:00:00.000Z",
        )

        self.assertEqual(result["reported_snapshot_count"], 0)
        self.assertEqual(result["medium_or_higher_finding_count"], 2)
        self.assertEqual(
            [finding["code"] for finding in result["findings"]],
            ["projection_empty", "trace_missing"],
        )


def _record(run_id: str) -> NoticeIngestQueueRecord:
    bundle_bytes = support._json_bytes([{"notice_id": "355867"}])
    manifest_bytes = support._json_bytes({"run_id": run_id})
    job = support._job(
        run_id=run_id,
        bundle_sha=support._sha(bundle_bytes),
        bundle_size=len(bundle_bytes),
        manifest_sha=support._sha(manifest_bytes),
        manifest_size=len(manifest_bytes),
    )
    return build_notice_ingest_queue_record(job)


def _completed_transport_trace(
    record: NoticeIngestQueueRecord,
    *,
    generated_at: str = "2026-05-01T08:00:00.000Z",
) -> dict[str, object]:
    return {
        "job_id": record.job_id,
        "run_id": record.run_id,
        "status": "completed",
        "import_result": {
            "selected_notices": [
                {
                    "notice_id": "355867",
                    "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                }
            ],
            "selected_notice_ids": ["355867"],
        },
        "progress_events": [
            {
                "event_id": f"{record.job_id}:downstream",
                "generated_at": generated_at,
                "stage": "downstream_materialization",
                "transition": "completed",
                "reason_code": "downstream_materialization_completed",
                "message": "downstream materialization completed",
            }
        ],
        "downstream_materialization": {
            "status": "completed",
            "typed_materialization": {
                "status": "completed",
                "materialized_releases": [
                    {
                        "candidate_kind": "transport_schedule",
                        "current": True,
                        "notice_ids": ["355867"],
                        "release_id": "transport-schedule-run-001-job-001",
                        "notice_read_model_counts": {
                            "355867": {
                                "currentSnapshots": 1,
                                "rejectedSources": 0,
                                "scheduledDepartures": 49,
                                "snapshots": 1,
                            }
                        },
                    }
                ],
            },
        },
    }


def _failed_trace(record: NoticeIngestQueueRecord, *, generated_at: str) -> dict[str, object]:
    return {
        "job_id": record.job_id,
        "run_id": record.run_id,
        "status": "failed_retryable",
        "error_code": "import_failed_retryable",
        "error_message": "import failed before downstream materialization",
        "import_result": {
            "selected_notices": [
                {
                    "notice_id": "355867",
                    "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                }
            ],
            "selected_notice_ids": ["355867"],
        },
        "progress_events": [
            {
                "event_id": f"{record.job_id}:failed",
                "generated_at": generated_at,
                "stage": "source_truth_import",
                "transition": "failed_retryable",
                "reason_code": "import_failed_retryable",
                "message": "import failed before downstream materialization",
            }
        ],
    }


if __name__ == "__main__":
    unittest.main()
