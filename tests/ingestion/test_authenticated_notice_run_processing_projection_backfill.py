from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_run_processing_projection_backfill import (
    backfill_authenticated_notice_run_processing_projection,
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


class AuthenticatedNoticeRunProcessingProjectionBackfillTest(unittest.TestCase):
    def test_backfills_collector_run_projection_without_queue_mutation(self) -> None:
        record = _record("muc_internal_portal:notice:20260428T181953007Z:smoke:20260501T012606Z")
        reporter = _RecordingReporter()

        result = backfill_authenticated_notice_run_processing_projection(
            records=(record,),
            trace_rows=(_completed_trace(record),),
            reporter=reporter,
            collector_run_token="20260428T181953007Z",
            projected_at="2026-05-01T10:32:00.000Z",
            producer_version="test.run-backfill@1",
        )

        self.assertEqual(result["candidate_record_count"], 1)
        self.assertEqual(result["reported_snapshot_count"], 1)
        self.assertEqual(result["medium_or_higher_finding_count"], 0)
        self.assertEqual(len(reporter.snapshots), 1)
        snapshot = reporter.snapshots[0]
        self.assertEqual(snapshot["collectorRunToken"], "20260428T181953007Z")
        self.assertEqual(snapshot["queueJobCount"], 1)
        self.assertEqual(snapshot["producerVersion"], "test.run-backfill@1")
        self.assertEqual(record.status, "queued")


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


def _completed_trace(record: NoticeIngestQueueRecord) -> dict[str, object]:
    return {
        "job_id": record.job_id,
        "run_id": record.run_id,
        "status": "completed",
        "generated_at": "2026-05-01T10:31:00.000Z",
        "import_result": {
            "selected_notices": [{"notice_id": "355867", "title": "班车通知"}],
            "selected_notice_ids": ["355867"],
        },
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
                        "release_id": "release-001",
                    }
                ],
            },
        },
    }


if __name__ == "__main__":
    unittest.main()
