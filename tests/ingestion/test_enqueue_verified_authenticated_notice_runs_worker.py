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
from campus_ingestion_core.verified_authenticated_notice_run_enqueue_scan import (
    VerifiedAuthenticatedNoticeRunEnqueueCandidate,
)

worker = importlib.import_module(
    "campus_ingestion_worker.enqueue_verified_authenticated_notice_runs"
)


class EnqueueVerifiedAuthenticatedNoticeRunsWorkerTest(unittest.TestCase):
    def test_main_writes_scheduled_enqueue_scan_plan(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "scan"
            store = InMemoryNoticeIngestQueueStore()
            with (
                patch(
                    "campus_ingestion_worker.enqueue_verified_authenticated_notice_runs."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.enqueue_verified_authenticated_notice_runs."
                    "collector_run_ledger_database_url_from_env",
                    return_value="postgresql://example/db",
                ),
                patch(
                    "campus_ingestion_worker.enqueue_verified_authenticated_notice_runs."
                    "build_notice_ingest_queue_store_from_env",
                    return_value=store,
                ),
                patch(
                    "campus_ingestion_worker.enqueue_verified_authenticated_notice_runs."
                    "list_verified_authenticated_notice_run_enqueue_candidates",
                    return_value=(_candidate("run-001"),),
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--replay-batch-id",
                        "scheduled:20260501",
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertEqual(payload["counts"]["planned_job_count"], 1)
            self.assertTrue(
                (
                    output_dir / "verified-authenticated-notice-run-enqueue-scan.dry-run.json"
                ).exists()
            )


def _candidate(run_id: str) -> VerifiedAuthenticatedNoticeRunEnqueueCandidate:
    return VerifiedAuthenticatedNoticeRunEnqueueCandidate(
        site_id="muc_internal_portal",
        run_refs=AuthenticatedNoticeCollectorRunObjectRefs(
            run_id=run_id,
            source_surface="notice",
            source_bucket="campus-rag-source",
            bundle_object_key=f"runs/{run_id}/bundle.json",
            manifest_object_key=f"runs/{run_id}/manifest.json",
            bundle_content_sha256="a" * 64,
            bundle_byte_size=4096,
            manifest_content_sha256="b" * 64,
            manifest_byte_size=2048,
        ),
    )


if __name__ == "__main__":
    unittest.main()
