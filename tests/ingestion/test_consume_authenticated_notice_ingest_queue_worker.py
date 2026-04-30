from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_run_queue_consumer import (
    AuthenticatedNoticeRunQueueConsumeResult,
)

worker = importlib.import_module(
    "campus_ingestion_worker.consume_authenticated_notice_ingest_queue"
)


class ConsumeAuthenticatedNoticeIngestQueueWorkerTest(unittest.TestCase):
    def test_main_passes_run_id_filter_and_writes_evidence_files(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "consume"
            result = AuthenticatedNoticeRunQueueConsumeResult(
                queue_consume={
                    "mode": "execute",
                    "counts": {"leased_count": 1, "completed_count": 1},
                },
                trace={"trace_rows": [{"job_id": "job-1"}]},
                failed_report={"failed_count": 0},
            )
            with (
                patch(
                    "campus_ingestion_worker.consume_authenticated_notice_ingest_queue."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.consume_authenticated_notice_ingest_queue."
                    "build_notice_ingest_queue_store_from_env",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_worker.consume_authenticated_notice_ingest_queue."
                    "build_object_store_from_env",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_worker.consume_authenticated_notice_ingest_queue."
                    "consume_authenticated_notice_ingest_queue",
                    return_value=result,
                ) as consume,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--execute",
                        "--run-id",
                        "run-001",
                        "--site-id",
                        "muc_internal_portal",
                        "--source-home-url",
                        "https://my.muc.edu.cn",
                        "--output-dir",
                        str(output_dir),
                        "--require-media-gate",
                        "--media-gate-evidence-dir",
                        str(output_dir / "media-gate"),
                    ]
                )

            kwargs = consume.call_args.kwargs
            self.assertEqual(kwargs["mode"], "execute")
            self.assertEqual(kwargs["run_id"], "run-001")
            self.assertEqual(kwargs["site_id"], "muc_internal_portal")
            self.assertEqual(kwargs["source_home_url"], "https://my.muc.edu.cn")
            self.assertTrue(kwargs["require_media_gate"])
            self.assertEqual(str(kwargs["media_gate_evidence_dir"]), str(output_dir / "media-gate"))
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "execute")
            self.assertTrue(payload["write_enabled"])
            self.assertTrue(
                (output_dir / "authenticated-notice-run-queue-consume.execute.json").exists()
            )
            self.assertTrue(
                (output_dir / "authenticated-notice-run-queue-consume.trace.json").exists()
            )
            self.assertTrue(
                (
                    output_dir
                    / "authenticated-notice-run-queue-consume-failed-report.json"
                ).exists()
            )


if __name__ == "__main__":
    unittest.main()
