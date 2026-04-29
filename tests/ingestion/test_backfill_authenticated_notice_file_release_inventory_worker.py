from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.backfill_authenticated_notice_file_release_inventory"
)


class BackfillAuthenticatedNoticeFileReleaseInventoryWorkerCliTest(unittest.TestCase):
    def test_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.backfill_authenticated_notice_file_release_inventory.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.backfill_authenticated_notice_file_release_inventory.backfill_authenticated_notice_file_release_inventory"
            ) as run_backfill,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            run_backfill.return_value = {
                "corpus": "campus_notices",
                "collection": "file_release_capture",
                "inventory_upsert_count": 1,
                "raw_asset_upsert_count": 1,
                "targeted_upsert": False,
            }
            worker.main(
                [
                    "--bundle-path",
                    "/tmp/file-releases-bundle.json",
                    "--manifest-path",
                    "/tmp/file-releases-manifest.json",
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "file_release_capture",
                ]
            )

        request = run_backfill.call_args.kwargs["request"]
        self.assertEqual(str(request.bundle_path), "/tmp/file-releases-bundle.json")
        self.assertEqual(str(request.manifest_path), "/tmp/file-releases-manifest.json")
        self.assertEqual(request.corpus, "campus_notices")
        self.assertEqual(request.collection, "file_release_capture")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["inventory_upsert_count"], 1)


if __name__ == "__main__":
    unittest.main()
