from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core import LocalDataRebuildReport

worker = importlib.import_module("campus_ingestion_worker.release_index")


class ReleaseIndexWorkerCliTest(unittest.TestCase):
    def test_main_defaults_provider_replay_to_no_alias_publish(self) -> None:
        with (
            patch("campus_ingestion_worker.release_index.load_worker_env"),
            patch("campus_ingestion_worker.release_index.rebuild_local_data") as rebuild,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            rebuild.return_value = LocalDataRebuildReport(
                import_context={"REBUILD_PUBLISH_ALIAS": "0"},
                import_result={"status": "ok"},
            )
            worker.main(
                [
                    "--corpus",
                    "curriculum",
                    "--collection",
                    "curriculum_plan",
                    "--raw-version-id",
                    "sha256:test-001",
                ]
            )

        request = rebuild.call_args.kwargs["request"]
        self.assertFalse(request.publish_qdrant_alias)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["import_result"]["status"], "ok")

    def test_main_rejects_provider_replay_alias_publish(self) -> None:
        with (
            patch("campus_ingestion_worker.release_index.load_worker_env"),
            self.assertRaisesRegex(
                ValueError,
                "provider_response_replay cannot publish qdrant alias",
            ),
        ):
            worker.main(
                [
                    "--corpus",
                    "curriculum",
                    "--collection",
                    "curriculum_plan",
                    "--raw-version-id",
                    "sha256:test-001",
                    "--publish-alias",
                ]
            )


if __name__ == "__main__":
    unittest.main()
