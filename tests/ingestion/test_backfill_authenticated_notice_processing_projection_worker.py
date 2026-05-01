from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.collected_notice_ingest_queue_store import (
    build_notice_ingest_queue_record,
)

from tests.ingestion import authenticated_notice_run_queue_consumer_support as support

worker = importlib.import_module(
    "campus_ingestion_worker.backfill_authenticated_notice_processing_projection"
)


class _RecordingReporter:
    def __init__(self) -> None:
        self.snapshots: list[dict[str, object]] = []

    def report(self, *, snapshots):
        self.snapshots.extend(dict(snapshot) for snapshot in snapshots)


class BackfillAuthenticatedNoticeProcessingProjectionWorkerTest(unittest.TestCase):
    def test_backfills_trace_file_into_app_api_projection_reporter(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001"})
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        record = build_notice_ingest_queue_record(job)
        reporter = _RecordingReporter()

        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            queue_records_path = root / "queue-records.json"
            trace_path = root / "trace.json"
            output_path = root / "backfill.json"
            queue_records_path.write_text(
                json.dumps([record.to_persisted_payload()], ensure_ascii=False),
                encoding="utf-8",
            )
            trace_path.write_text(
                json.dumps(
                    {
                        "trace_rows": [
                            {
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
                                "downstream_materialization": {
                                    "status": "completed",
                                    "typed_materialization": {
                                        "status": "completed",
                                        "materialized_releases": [
                                            {
                                                "candidate_kind": "transport_schedule",
                                                "current": True,
                                                "notice_ids": ["355867"],
                                                "notice_read_model_counts": {
                                                    "355867": {
                                                        "rejectedSources": 0,
                                                        "scheduledDepartures": 49,
                                                    }
                                                },
                                            }
                                        ],
                                    },
                                },
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ingestion_worker.backfill_authenticated_notice_processing_projection."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.backfill_authenticated_notice_processing_projection."
                    "build_processing_projection_reporter_from_env",
                    return_value=reporter,
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--queue-records-path",
                        str(queue_records_path),
                        "--trace-path",
                        str(trace_path),
                        "--notice-id",
                        "355867",
                        "--output-path",
                        str(output_path),
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["verdict"], "passed")
            self.assertEqual(len(reporter.snapshots), 1)
            self.assertEqual(reporter.snapshots[0]["noticeId"], "355867")
            self.assertEqual(reporter.snapshots[0]["readModelCounts"]["scheduledDepartures"], 49)
            self.assertTrue(output_path.exists())


if __name__ == "__main__":
    unittest.main()
