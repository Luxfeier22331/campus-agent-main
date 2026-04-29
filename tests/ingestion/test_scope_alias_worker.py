from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.scope_alias import ScopeAliasReport

worker = importlib.import_module("campus_ingestion_worker.scope_alias")


class ScopeAliasWorkerCliTest(unittest.TestCase):
    def test_main_publishes_existing_scope_alias(self) -> None:
        report = ScopeAliasReport(
            corpus="official_web",
            collection="stable_reference",
            serving_alias="official_web_stable_reference",
            action="publish",
            previous_physical_collection_name=None,
            current_physical_collection_name="official_web_stable_reference__r20260404_204033",
        )
        with (
            patch("campus_ingestion_worker.scope_alias.load_worker_env"),
            patch(
                "campus_ingestion_worker.scope_alias.set_scope_release_alias"
            ) as set_scope_release_alias,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            set_scope_release_alias.return_value = report
            worker.main(
                [
                    "--corpus",
                    "official_web",
                    "--collection",
                    "stable_reference",
                    "--physical-collection-name",
                    "official_web_stable_reference__r20260404_204033",
                ]
            )

        self.assertEqual(set_scope_release_alias.call_args.kwargs["corpus"], "official_web")
        self.assertEqual(set_scope_release_alias.call_args.kwargs["collection"], "stable_reference")
        self.assertEqual(
            set_scope_release_alias.call_args.kwargs["physical_collection_name"],
            "official_web_stable_reference__r20260404_204033",
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["action"], "publish")

    def test_main_can_unpublish_scope_alias(self) -> None:
        report = ScopeAliasReport(
            corpus="official_web",
            collection="muc_public_pages",
            serving_alias="muc_public_pages",
            action="unpublish",
            previous_physical_collection_name="muc_public_pages__r20260402_152206",
            current_physical_collection_name=None,
        )
        with (
            patch("campus_ingestion_worker.scope_alias.load_worker_env"),
            patch(
                "campus_ingestion_worker.scope_alias.set_scope_release_alias"
            ) as set_scope_release_alias,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            set_scope_release_alias.return_value = report
            worker.main(
                [
                    "--corpus",
                    "official_web",
                    "--collection",
                    "muc_public_pages",
                    "--unpublish",
                ]
            )

        self.assertIsNone(set_scope_release_alias.call_args.kwargs["physical_collection_name"])
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["action"], "unpublish")


if __name__ == "__main__":
    unittest.main()
