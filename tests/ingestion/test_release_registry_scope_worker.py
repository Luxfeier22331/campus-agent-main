from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.registry_scope_release import RegistryScopeReleaseReport

worker = importlib.import_module("campus_ingestion_worker.release_registry_scope")


class ReleaseRegistryScopeWorkerCliTest(unittest.TestCase):
    def test_main_passes_cli_args_into_registry_scope_release(self) -> None:
        report = RegistryScopeReleaseReport(
            corpus="official_web",
            collection="muc_public_pages",
            release_id="r20260402_120000",
            serving_alias="muc_public_pages",
            physical_collection_name="muc_public_pages__r20260402_120000",
            previous_physical_collection_name=None,
            manifest_object_key=(
                "official_web/releases/muc_public_pages/r20260402_120000/index-release.json"
            ),
            validation_summary_object_key=(
                "official_web/releases/muc_public_pages/r20260402_120000/validation-summary.json"
            ),
            validation_status="passed",
            document_count=2,
            point_count=6,
            indexed_at="2026-04-02T12:00:00+00:00",
            published_at=None,
        )
        with (
            patch("campus_ingestion_worker.release_registry_scope.load_worker_env"),
            patch(
                "campus_ingestion_worker.release_registry_scope.release_registry_scope"
            ) as release_scope,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            release_scope.return_value = report
            worker.main(
                [
                    "--corpus",
                    "official_web",
                    "--collection",
                    "muc_public_pages",
                    "--reset-index",
                    "--no-publish-alias",
                ]
            )

        self.assertEqual(release_scope.call_args.kwargs["corpus"], "official_web")
        self.assertEqual(release_scope.call_args.kwargs["collection"], "muc_public_pages")
        self.assertTrue(release_scope.call_args.kwargs["reset_index"])
        self.assertFalse(release_scope.call_args.kwargs["publish_alias"])
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["physical_collection_name"], "muc_public_pages__r20260402_120000")


if __name__ == "__main__":
    unittest.main()
