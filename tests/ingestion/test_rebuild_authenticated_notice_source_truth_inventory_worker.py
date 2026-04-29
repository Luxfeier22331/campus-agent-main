from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory"
)


class RebuildAuthenticatedNoticeSourceTruthInventoryWorkerCliTest(unittest.TestCase):
    def test_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory.rebuild_authenticated_notice_source_truth_inventory"
            ) as rebuild,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            rebuild.return_value = {
                "corpus": "campus_notices",
                "collection": "internal_notice",
                "selected_notice_ids": ["353301", "354605"],
                "notice_count": 42,
                "expected_document_count": 84,
                "expected_attachment_document_count": 42,
                "expected_ocr_candidate_count": 21,
            }
            worker.main(
                [
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "internal_notice",
                    "--source-projections-path",
                    "/tmp/internal-notice-source-projections.v1.json",
                    "--default-visibility-scope",
                    "campus",
                    "--notice-id",
                    "354605",
                    "--notice-id",
                    "353301",
                    "--notice-id",
                    "354605",
                ]
            )

        request = rebuild.call_args.kwargs["request"]
        self.assertEqual(request.corpus, "campus_notices")
        self.assertEqual(request.collection, "internal_notice")
        self.assertEqual(
            str(request.source_projections_path),
            "/tmp/internal-notice-source-projections.v1.json",
        )
        self.assertEqual(request.default_visibility_scope, "campus")
        self.assertEqual(request.notice_ids, ("353301", "354605"))
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["notice_count"], 42)
        self.assertEqual(payload["selected_notice_ids"], ["353301", "354605"])


if __name__ == "__main__":
    unittest.main()
