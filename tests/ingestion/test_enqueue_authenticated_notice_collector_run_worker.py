from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AuthenticatedNoticeCollectorRunObjectRefs,
)
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)

worker = importlib.import_module(
    "campus_ingestion_worker.enqueue_authenticated_notice_collector_run"
)


class EnqueueAuthenticatedNoticeCollectorRunWorkerTest(unittest.TestCase):
    def test_main_writes_dry_run_plan_without_queue_store(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "enqueue"
            with (
                patch(
                    "campus_ingestion_worker.enqueue_authenticated_notice_collector_run."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.enqueue_authenticated_notice_collector_run."
                    "resolve_authenticated_notice_collector_run_refs",
                    return_value=_run_refs(),
                ) as resolve_refs,
                patch(
                    "campus_ingestion_worker.enqueue_authenticated_notice_collector_run."
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
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            resolve_refs.assert_called_once()
            build_store.assert_not_called()
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertFalse(payload["write_enabled"])
            self.assertEqual(payload["counts"]["planned_job_count"], 1)
            self.assertTrue(
                (output_dir / "authenticated-notice-run-enqueue-plan.dry-run.json").exists()
            )

    def test_execute_writes_queue_job(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "enqueue"
            store = InMemoryNoticeIngestQueueStore()
            with (
                patch(
                    "campus_ingestion_worker.enqueue_authenticated_notice_collector_run."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.enqueue_authenticated_notice_collector_run."
                    "resolve_authenticated_notice_collector_run_refs",
                    return_value=_run_refs(),
                ),
                patch(
                    "campus_ingestion_worker.enqueue_authenticated_notice_collector_run."
                    "build_notice_ingest_queue_store_from_env",
                    return_value=store,
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--run-id",
                        "run-001",
                        "--site-id",
                        "muc_internal_portal",
                        "--output-dir",
                        str(output_dir),
                        "--execute",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "execute")
            self.assertTrue(payload["write_enabled"])
            self.assertEqual(payload["counts"]["queue_write_count"], 1)
            self.assertEqual(store.list_status_counts()["queued"], 1)
            self.assertTrue((output_dir / "authenticated-notice-run-enqueue.execute.json").exists())


def _run_refs() -> AuthenticatedNoticeCollectorRunObjectRefs:
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


if __name__ == "__main__":
    unittest.main()
