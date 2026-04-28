from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.smoke_authenticated_notice_bootstrap_local"
)


class SmokeAuthenticatedNoticeBootstrapLocalWorkerCliTest(unittest.TestCase):
    def test_main_passes_attachment_blob_root_into_import_request(self) -> None:
        with TemporaryDirectory() as temp_dir:
            summary_path = Path(temp_dir) / "summary.json"
            with (
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_bootstrap_local.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.smoke_authenticated_notice_bootstrap_local.import_authenticated_notice_export"
                ) as run_import,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                run_import.return_value = {
                    "notice_count": 1,
                    "created_document_ids": ["notice:muc_internal_portal:351118"],
                    "updated_document_ids": [],
                    "skipped_document_ids": [],
                    "raw_uploaded_count": 1,
                    "raw_reused_count": 0,
                    "errors": [],
                }

                worker.main(
                    [
                        "--bundle-path",
                        "/tmp/notices-bundle.json",
                        "--manifest-path",
                        "/tmp/export-manifest.json",
                        "--attachment-blob-root",
                        "/tmp/blob-store",
                        "--site-id",
                        "muc_internal_portal",
                        "--source-home-url",
                        "https://portal.example.edu/home",
                        "--local-output-dir",
                        str(Path(temp_dir) / "local-smoke"),
                        "--summary-output-path",
                        str(summary_path),
                    ]
                )

            request = run_import.call_args.kwargs["request"]
            self.assertEqual(str(request.attachment_blob_root), "/tmp/blob-store")
            self.assertEqual(request.mode, "admit_and_materialize")
            payload = json.loads(stdout.getvalue())
            self.assertEqual(
                payload["execution"]["attachment_blob_root"],
                "/tmp/blob-store",
            )


if __name__ == "__main__":
    unittest.main()
