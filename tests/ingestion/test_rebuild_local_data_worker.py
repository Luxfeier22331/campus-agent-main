from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core import LocalDataRebuildReport

rebuild_worker = importlib.import_module("campus_ingestion_worker.rebuild_local_data")


class RebuildLocalDataWorkerCliTest(unittest.TestCase):
    def test_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch("campus_ingestion_worker.rebuild_local_data.load_worker_env"),
            patch("campus_ingestion_worker.rebuild_local_data.rebuild_local_data") as rebuild,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            rebuild.return_value = LocalDataRebuildReport(
                import_context={"k": "v"}, import_result={"status": "ok"}
            )
            rebuild_worker.main(
                [
                    "--mode",
                    "provider_response_replay",
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_handbook",
                    "--raw-version-id",
                    "sha256:test-001",
                    "--index-qdrant",
                ]
            )

        request = rebuild.call_args.kwargs["request"]
        self.assertEqual(request.import_mode, "provider_response_replay")
        self.assertEqual(request.corpus, "regulations")
        self.assertEqual(request.collection, "student_handbook")
        self.assertEqual(request.raw_version_id, "sha256:test-001")
        self.assertTrue(request.index_qdrant)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["import_result"]["status"], "ok")


if __name__ == "__main__":
    unittest.main()
