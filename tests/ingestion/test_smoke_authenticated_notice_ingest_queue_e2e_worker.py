from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e"
)


class SmokeAuthenticatedNoticeIngestQueueE2EWorkerTest(unittest.TestCase):
    def test_dry_run_reports_planned_unattended_path_without_queue_mutation(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "smoke"
            with (
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "resolve_authenticated_notice_collector_run_refs",
                    return_value=_run_refs(),
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "build_notice_ingest_queue_store_from_env"
                ) as build_store,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--run-id",
                        "run-001",
                        "--site-id",
                        "muc_internal_portal",
                        "--source-home-url",
                        "https://my.muc.edu.cn",
                        "--sample-id",
                        "355867",
                        "--require-child-task-contract",
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            build_store.assert_not_called()
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertEqual(payload["sample_id"], "355867")
            self.assertEqual(payload["verdict"], "passed")
            self.assertEqual(payload["medium_or_higher_finding_count"], 0)
            report_path = output_dir / "authenticated-notice-ingest-queue-e2e-smoke.json"
            self.assertTrue(report_path.exists())
            report = json.loads(report_path.read_text(encoding="utf-8"))
            child_contract = report["child_task_contract"]
            self.assertEqual(child_contract["verdict"], "passed")
            self.assertEqual(
                child_contract["processor_profile"]["profile_id"], "image_schedule_notice"
            )
            self.assertEqual(
                child_contract["processor_profile"]["processor_order"][0],
                "ocr_table_extraction",
            )

    def test_execute_passes_lease_seconds_to_queue_consumer(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "smoke"
            with (
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "resolve_authenticated_notice_collector_run_refs",
                    return_value=_run_refs(),
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "build_notice_ingest_queue_store_from_env",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "execute_authenticated_notice_run_enqueue_plan",
                    return_value={"enqueued_count": 1},
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "build_object_store_from_env",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "consume_authenticated_notice_ingest_queue",
                    return_value=_consume_result(),
                ) as consume,
                redirect_stdout(StringIO()),
            ):
                worker.main(
                    [
                        "--run-id",
                        "run-001",
                        "--site-id",
                        "muc_internal_portal",
                        "--source-home-url",
                        "https://my.muc.edu.cn",
                        "--execute",
                        "--lease-seconds",
                        "3600",
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            self.assertEqual(consume.call_args.kwargs["lease_seconds"], 3600)
            trace_path = output_dir / "operations/authenticated-notice-run-queue-consume.trace.json"
            self.assertTrue(trace_path.exists())
            trace = json.loads(trace_path.read_text(encoding="utf-8"))
            self.assertEqual(trace["trace_rows"][0]["lease_heartbeat"]["heartbeat_failed"], False)
            failed_report_path = (
                output_dir / "operations/authenticated-notice-run-queue-consume-failed-report.json"
            )
            self.assertTrue(failed_report_path.exists())

    def test_execute_fails_when_queue_consumer_makes_no_progress(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "smoke"
            with (
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "resolve_authenticated_notice_collector_run_refs",
                    return_value=_run_refs(),
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "build_notice_ingest_queue_store_from_env",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "execute_authenticated_notice_run_enqueue_plan",
                    return_value={"enqueued_count": 0, "existing_count": 1},
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "build_object_store_from_env",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e."
                    "consume_authenticated_notice_ingest_queue",
                    return_value=_consume_result(completed_count=0, failed_count=0),
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--run-id",
                        "run-001",
                        "--site-id",
                        "muc_internal_portal",
                        "--source-home-url",
                        "https://my.muc.edu.cn",
                        "--execute",
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["verdict"], "failed")
            self.assertEqual(payload["medium_or_higher_finding_count"], 1)
            report = json.loads(
                (output_dir / "authenticated-notice-ingest-queue-e2e-smoke.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(report["findings"][0]["code"], "queue_consume_no_progress")


def _run_refs():
    from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
        AuthenticatedNoticeCollectorRunObjectRefs,
    )

    return AuthenticatedNoticeCollectorRunObjectRefs(
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


class _ConsumeResult:
    def __init__(self, *, completed_count: int, failed_count: int) -> None:
        self.queue_consume = {
            "mode": "execute",
            "counts": {
                "completed_count": completed_count,
                "failed_count": failed_count,
            },
        }
        self.trace = {
            "trace_rows": [
                {
                    "lease_heartbeat": {
                        "heartbeat_failed": False,
                    }
                }
            ]
        }
        self.failed_report = {"failed_items": []}

    def to_output_files(self):
        return {
            "authenticated-notice-run-queue-consume.execute.json": self.queue_consume,
            "authenticated-notice-run-queue-consume.trace.json": self.trace,
            "authenticated-notice-run-queue-consume-failed-report.json": self.failed_report,
        }


def _consume_result(*, completed_count: int = 1, failed_count: int = 0):
    return _ConsumeResult(completed_count=completed_count, failed_count=failed_count)


if __name__ == "__main__":
    unittest.main()
