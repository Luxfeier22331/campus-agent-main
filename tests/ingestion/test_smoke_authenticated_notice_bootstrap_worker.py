from __future__ import annotations

import importlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.smoke_authenticated_notice_bootstrap")


class SmokeAuthenticatedNoticeBootstrapWorkerCliTest(unittest.TestCase):
    def test_main_emits_success_summary_for_clean_import_result(self) -> None:
        with TemporaryDirectory() as temp_dir:
            summary_path = Path(temp_dir) / "summary.json"
            with (
                patch("campus_ingestion_worker.smoke_authenticated_notice_bootstrap.load_worker_env"),
                patch("campus_ingestion_worker.smoke_authenticated_notice_bootstrap.import_authenticated_notice_export") as run_import,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                run_import.return_value = {
                    "notice_count": 2,
                    "created_document_ids": ["notice:muc_internal_portal:355119"],
                    "updated_document_ids": [],
                    "skipped_document_ids": ["notice:muc_internal_portal:355120"],
                    "raw_uploaded_count": 1,
                    "raw_reused_count": 1,
                    "errors": [],
                }

                worker.main(
                    [
                        "--bundle-path",
                        "/tmp/notices-bundle.json",
                        "--manifest-path",
                        "/tmp/export-manifest.json",
                        "--site-id",
                        "muc_internal_portal",
                        "--source-home-url",
                        "https://portal.example.edu/home",
                        "--expect-notice-count",
                        "2",
                        "--summary-output-path",
                        str(summary_path),
                    ]
                )

            request = run_import.call_args.kwargs["request"]
            self.assertEqual(str(request.bundle_path), "/tmp/notices-bundle.json")
            self.assertEqual(str(request.export_manifest_path), "/tmp/export-manifest.json")
            self.assertEqual(request.site_id, "muc_internal_portal")
            payload = json.loads(stdout.getvalue())
            written = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["result"]["notice_count"], 2)
            self.assertEqual(payload["checks"]["document_outcomes_match_notice_count"], "passed")
            self.assertEqual(written, payload)
            self.assertEqual(written["execution"]["bundle_path"], "/tmp/notices-bundle.json")
            self.assertEqual(written["execution"]["manifest_path"], "/tmp/export-manifest.json")
            self.assertEqual(written["execution"]["site_id"], "muc_internal_portal")

    def test_main_exits_non_zero_when_smoke_checks_fail(self) -> None:
        with TemporaryDirectory() as temp_dir:
            summary_path = Path(temp_dir) / "failed-summary.json"
            with (
                patch("campus_ingestion_worker.smoke_authenticated_notice_bootstrap.load_worker_env"),
                patch("campus_ingestion_worker.smoke_authenticated_notice_bootstrap.import_authenticated_notice_export") as run_import,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                run_import.return_value = {
                    "notice_count": 0,
                    "created_document_ids": [],
                    "updated_document_ids": [],
                    "skipped_document_ids": [],
                    "raw_uploaded_count": 0,
                    "raw_reused_count": 0,
                    "errors": ["bundle payload was empty"],
                }

                with self.assertRaises(SystemExit) as raised:
                    worker.main(
                        [
                            "--bundle-path",
                            "/tmp/notices-bundle.json",
                            "--site-id",
                            "muc_internal_portal",
                            "--source-home-url",
                            "https://portal.example.edu/home",
                            "--summary-output-path",
                            str(summary_path),
                        ]
                    )

            self.assertEqual(raised.exception.code, 1)
            payload = json.loads(stdout.getvalue())
            written = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertFalse(payload["ok"])
            self.assertEqual(payload["checks"]["non_empty_notice_count"], "failed")
            self.assertEqual(payload["checks"]["no_import_errors"], "failed")
            self.assertEqual(written, payload)


if __name__ == "__main__":
    unittest.main()
