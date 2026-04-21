from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.check_authenticated_notice_file_release_readiness"
)


class CheckAuthenticatedNoticeFileReleaseReadinessWorkerCliTest(unittest.TestCase):
    def test_main_builds_inventory_store_lookup_from_cli_args(self) -> None:
        inventory_store = object()
        with (
            patch(
                "campus_ingestion_worker.check_authenticated_notice_file_release_readiness.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_file_release_readiness.build_authenticated_notice_file_release_inventory_store_from_env",
                return_value=inventory_store,
            ) as build_store,
            patch(
                "campus_ingestion_worker.check_authenticated_notice_file_release_readiness.resolve_file_release_owner_recovery_readiness_from_inventory_store"
            ) as resolve_readiness,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            resolve_readiness.return_value = {
                "status": "ready",
                "owner_title_hint": "中央民族大学差旅费管理办法",
                "match_count": 1,
            }
            worker.main(
                [
                    "--owner-title-hint",
                    "中央民族大学差旅费管理办法",
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "file_release_capture",
                    "--file-release-id",
                    "646",
                    "--file-release-id",
                    "647",
                ]
            )

        build_store.assert_called_once_with(prefer_operator=True)
        self.assertEqual(
            resolve_readiness.call_args.kwargs,
            {
                "owner_title_hint": "中央民族大学差旅费管理办法",
                "inventory_store": inventory_store,
                "corpus": "campus_notices",
                "collection": "file_release_capture",
                "owner_kind": "file_release_document",
                "relation_type": "file_release_ref",
                "file_release_ids": ("646", "647"),
            },
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["status"], "ready")


if __name__ == "__main__":
    unittest.main()
