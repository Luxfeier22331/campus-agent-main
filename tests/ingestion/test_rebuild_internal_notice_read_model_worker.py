from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.internal_notice_read_model import InternalNoticeReadModelEntry

worker = importlib.import_module("campus_ingestion_worker.rebuild_internal_notice_read_model")


class RebuildInternalNoticeReadModelWorkerCliTest(unittest.TestCase):
    def test_main_refuses_implicit_full_scope_rebuild(self) -> None:
        with (
            patch("campus_ingestion_worker.rebuild_internal_notice_read_model.load_worker_env"),
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_read_model.rebuild_internal_notice_read_model"
            ) as rebuild,
            patch("sys.stderr", new_callable=io.StringIO),
            self.assertRaises(SystemExit),
        ):
            worker.main([])

        rebuild.assert_not_called()

    def test_main_rebuilds_read_model_for_selected_notice_ids(self) -> None:
        rows = (
            InternalNoticeReadModelEntry(
                source_family="internal_notice_restricted",
                source_corpus="campus_notices",
                source_collection="internal_notice",
                source_notice_id="355222",
                unit_id="notice_unit:355222:procurement_notice",
                primary_role="procurement_notice",
                target_surface="procurement_notice_history",
                consumption_status="retained_for_notice_query",
                queryable=True,
                title="中央民族大学丰台校区家具采购项目比选公告",
                published_at="2026-04-12",
                canonical_document_id="notice:muc_internal_portal:355222",
                canonical_markdown_object_key=(
                    "campus_notices/documents/internal_notice/355222/canonical.md"
                ),
                search_text="家具采购项目",
                projection_updated_at="2026-04-24T00:00:00+00:00",
            ),
        )

        with (
            patch("campus_ingestion_worker.rebuild_internal_notice_read_model.load_worker_env"),
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_read_model.rebuild_internal_notice_read_model",
                return_value=rows,
            ) as rebuild,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "355222"])

        self.assertEqual(rebuild.call_args.kwargs["notice_ids"], ("355222",))
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["read_model_entry_count"], 1)
        self.assertEqual(payload["queryable_count"], 1)
        self.assertEqual(payload["body_excerpt_max_chars"], 800)
        self.assertEqual(payload["search_text_max_chars"], 2000)
        self.assertEqual(payload["observed_max_search_text_chars"], len("家具采购项目"))
        self.assertEqual(payload["total_search_text_chars"], len("家具采购项目"))
        self.assertEqual(payload["target_surface_counts"]["procurement_notice_history"], 1)

    def test_main_merges_notice_ids_from_selection_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            selection_path = Path(temp_dir) / "selected-notices.json"
            selection_path.write_text(
                json.dumps({"selected_notice_ids": ["355111", "355222", "355111"]}),
                encoding="utf-8",
            )

            with (
                patch("campus_ingestion_worker.rebuild_internal_notice_read_model.load_worker_env"),
                patch(
                    "campus_ingestion_worker.rebuild_internal_notice_read_model.rebuild_internal_notice_read_model",
                    return_value=(),
                ) as rebuild,
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(
                    [
                        "--notice-id",
                        "355222",
                        "--selection-path",
                        str(selection_path),
                    ]
                )

        self.assertEqual(rebuild.call_args.kwargs["notice_ids"], ("355222", "355111"))


if __name__ == "__main__":
    unittest.main()
