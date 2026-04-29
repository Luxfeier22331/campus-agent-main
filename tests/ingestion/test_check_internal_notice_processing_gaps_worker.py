from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumption_projection import (
    InternalNoticeProcessingGapsReport,
    InternalNoticeProcessingGapUnit,
)

worker = importlib.import_module("campus_ingestion_worker.check_internal_notice_processing_gaps")


class CheckInternalNoticeProcessingGapsWorkerCliTest(unittest.TestCase):
    def test_main_prints_processing_gap_report_for_selected_notice_ids(self) -> None:
        report = InternalNoticeProcessingGapsReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("355222",),
            projection_entry_count=2,
            pending_multimodal_processing_count=1,
            authority_pending_count=0,
            unsupported_count=0,
            no_adoption_count=0,
            ready_for_target_count=1,
            retained_for_notice_query_count=0,
            consumption_status_counts={
                "pending_multimodal_processing": 1,
                "ready_for_target_materialization": 1,
            },
            target_surface_counts={
                "multimodal_processing_candidate": 1,
                "regulations/institutional_rules": 1,
            },
            gap_units=(
                InternalNoticeProcessingGapUnit(
                    source_notice_id="355222",
                    unit_id="notice_unit:355222:pending_multimodal",
                    primary_role="attachment_rule_body",
                    semantic_owner="notice_body",
                    target_surface="multimodal_processing_candidate",
                    consumption_status="pending_multimodal_processing",
                    reasons=("multimodal_processing_required",),
                    consumer_admission_batch_id="batch-projection-001",
                ),
            ),
        )

        with (
            patch("campus_ingestion_worker.check_internal_notice_processing_gaps.load_worker_env"),
            patch(
                "campus_ingestion_worker.check_internal_notice_processing_gaps.build_notice_consumption_projection_store_from_env"
            ) as build_store,
            patch(
                "campus_ingestion_worker.check_internal_notice_processing_gaps.check_internal_notice_processing_gaps",
                return_value=report,
            ) as check,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "355222"])

        build_store.assert_called_once()
        self.assertEqual(check.call_args.kwargs["notice_ids"], ("355222",))
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["pending_multimodal_processing_count"], 1)
        self.assertNotIn("legacy_manual_review_required_count", payload)
        self.assertEqual(
            payload["gap_units"][0]["target_surface"],
            "multimodal_processing_candidate",
        )
        self.assertEqual(
            payload["gap_units"][0]["consumer_admission_batch_id"],
            "batch-projection-001",
        )

    def test_main_merges_notice_ids_from_selection_path(self) -> None:
        report = InternalNoticeProcessingGapsReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("355111", "355222"),
            projection_entry_count=0,
            pending_multimodal_processing_count=0,
            authority_pending_count=0,
            unsupported_count=0,
            no_adoption_count=0,
            ready_for_target_count=0,
            retained_for_notice_query_count=0,
            consumption_status_counts={},
            target_surface_counts={},
            gap_units=(),
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            selection_path = Path(temp_dir) / "selected-notices.json"
            selection_path.write_text(
                json.dumps({"selected_notice_ids": ["355111", "355222", "355111"]}),
                encoding="utf-8",
            )
            with (
                patch(
                    "campus_ingestion_worker.check_internal_notice_processing_gaps.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.check_internal_notice_processing_gaps.build_notice_consumption_projection_store_from_env"
                ),
                patch(
                    "campus_ingestion_worker.check_internal_notice_processing_gaps.check_internal_notice_processing_gaps",
                    return_value=report,
                ) as check,
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(["--notice-id", "355222", "--selection-path", str(selection_path)])

        self.assertEqual(check.call_args.kwargs["notice_ids"], ("355222", "355111"))


if __name__ == "__main__":
    unittest.main()
