from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.internal_notice_read_model import (
    InternalNoticeReadModelConsistencyReport,
)

worker = importlib.import_module(
    "campus_ingestion_worker.check_internal_notice_read_model_consistency"
)


class CheckInternalNoticeReadModelConsistencyWorkerCliTest(unittest.TestCase):
    def test_main_prints_consistency_report_for_selected_notice_ids(self) -> None:
        report = InternalNoticeReadModelConsistencyReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("355222",),
            projection_entry_count=2,
            projection_queryable_count=1,
            read_model_entry_count=1,
            missing_queryable_projection_unit_ids=(),
            extra_read_model_unit_ids=(),
            ok=True,
        )

        with (
            patch(
                "campus_ingestion_worker.check_internal_notice_read_model_consistency.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.check_internal_notice_read_model_consistency.check_internal_notice_read_model_consistency",
                return_value=report,
            ) as check,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "355222"])

        self.assertEqual(check.call_args.kwargs["notice_ids"], ("355222",))
        payload = json.loads(stdout.getvalue())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["projection_queryable_count"], 1)
        self.assertEqual(payload["selected_notice_ids"], ["355222"])

    def test_main_merges_notice_ids_from_selection_path(self) -> None:
        report = InternalNoticeReadModelConsistencyReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("355111", "355222"),
            projection_entry_count=0,
            projection_queryable_count=0,
            read_model_entry_count=0,
            missing_queryable_projection_unit_ids=(),
            extra_read_model_unit_ids=(),
            ok=True,
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            selection_path = Path(temp_dir) / "selected-notices.json"
            selection_path.write_text(
                json.dumps({"selected_notice_ids": ["355111", "355222", "355111"]}),
                encoding="utf-8",
            )
            with (
                patch(
                    "campus_ingestion_worker.check_internal_notice_read_model_consistency.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.check_internal_notice_read_model_consistency.check_internal_notice_read_model_consistency",
                    return_value=report,
                ) as check,
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(["--notice-id", "355222", "--selection-path", str(selection_path)])

        self.assertEqual(check.call_args.kwargs["notice_ids"], ("355222", "355111"))


if __name__ == "__main__":
    unittest.main()
