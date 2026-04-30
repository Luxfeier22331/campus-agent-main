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
            self.assertTrue((output_dir / "authenticated-notice-ingest-queue-e2e-smoke.json").exists())


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


if __name__ == "__main__":
    unittest.main()
