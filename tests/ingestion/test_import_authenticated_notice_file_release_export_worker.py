from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.import_authenticated_notice_file_release_export"
)


class ImportAuthenticatedNoticeFileReleaseExportWorkerCliTest(unittest.TestCase):
    def test_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.import_authenticated_notice_file_release_export.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.import_authenticated_notice_file_release_export.import_authenticated_notice_file_release_export"
            ) as run_import,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            run_import.return_value = {
                "file_release_count": 1,
                "created_document_ids": ["file-release:muc_internal_portal:646"],
                "errors": [],
            }
            worker.main(
                [
                    "--bundle-path",
                    "/tmp/file-releases-bundle.json",
                    "--manifest-path",
                    "/tmp/file-releases-manifest.json",
                    "--site-id",
                    "muc_internal_portal",
                    "--source-home-url",
                    "https://portal.example.edu/",
                ]
            )

        request = run_import.call_args.kwargs["request"]
        self.assertEqual(str(request.bundle_path), "/tmp/file-releases-bundle.json")
        self.assertEqual(str(request.manifest_path), "/tmp/file-releases-manifest.json")
        self.assertEqual(request.site_id, "muc_internal_portal")
        self.assertEqual(request.source_home_url, "https://portal.example.edu/")
        self.assertEqual(request.mode, "plan")
        self.assertFalse(request.replace_scope)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["file_release_count"], 1)


if __name__ == "__main__":
    unittest.main()
