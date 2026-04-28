from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.internal_notice_pipeline_quality import (
    InternalNoticePipelineQualityFinding,
    InternalNoticePipelineQualityReport,
)

worker = importlib.import_module("campus_ingestion_worker.check_internal_notice_pipeline_quality")


class CheckInternalNoticePipelineQualityWorkerCliTest(unittest.TestCase):
    def test_main_prints_quality_report_for_selected_notice_ids(self) -> None:
        report = InternalNoticePipelineQualityReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("355001",),
            source_truth_notice_count=1,
            projection_entry_count=1,
            read_model_entry_count=1,
            queryable_read_model_card_count=1,
            ready_regulation_target_count=0,
            target_surface_counts={"notice_level_query": 1},
            consumption_status_counts={"retained_for_notice_query": 1},
            read_model_target_surface_counts={"notice_level_query": 1},
            asset_edges=(),
            findings=(),
            ok=True,
        )

        with (
            patch("campus_ingestion_worker.check_internal_notice_pipeline_quality.load_worker_env"),
            patch(
                "campus_ingestion_worker.check_internal_notice_pipeline_quality.build_authenticated_notice_source_truth_inventory_store_from_env"
            ) as build_inventory,
            patch(
                "campus_ingestion_worker.check_internal_notice_pipeline_quality.build_notice_consumption_projection_store_from_env"
            ) as build_projection,
            patch(
                "campus_ingestion_worker.check_internal_notice_pipeline_quality.build_internal_notice_read_model_store_from_env"
            ) as build_read_model,
            patch(
                "campus_ingestion_worker.check_internal_notice_pipeline_quality.check_internal_notice_pipeline_quality",
                return_value=report,
            ) as check,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "355001"])

        build_inventory.assert_called_once()
        build_projection.assert_called_once()
        build_read_model.assert_called_once()
        self.assertEqual(check.call_args.kwargs["notice_ids"], ("355001",))
        payload = json.loads(stdout.getvalue())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["selected_notice_ids"], ["355001"])

    def test_main_requires_selection_unless_full_scope_is_explicit(self) -> None:
        with (
            patch("campus_ingestion_worker.check_internal_notice_pipeline_quality.load_worker_env"),
            self.assertRaises(SystemExit),
            patch("sys.stderr", new_callable=io.StringIO) as stderr,
        ):
            worker.main([])

        self.assertIn("--notice-id or --selection-path", stderr.getvalue())

    def test_main_merges_selection_file_and_prints_findings(self) -> None:
        report = InternalNoticePipelineQualityReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("355001", "355002"),
            source_truth_notice_count=2,
            projection_entry_count=2,
            read_model_entry_count=1,
            queryable_read_model_card_count=1,
            ready_regulation_target_count=1,
            target_surface_counts={"regulations/institutional_rules": 1},
            consumption_status_counts={"ready_for_target_materialization": 1},
            read_model_target_surface_counts={"notice_level_query": 1},
            asset_edges=(),
            findings=(
                InternalNoticePipelineQualityFinding(
                    severity="error",
                    reason_code="regulation_ready_without_quality_gate",
                    stage="target_materialization",
                    source_notice_id="355002",
                    unit_id="notice_unit:355002:regulation",
                ),
            ),
            ok=False,
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            selection_path = Path(temp_dir) / "selected-notices.json"
            selection_path.write_text(
                json.dumps({"selected_notice_ids": ["355001", "355002", "355001"]}),
                encoding="utf-8",
            )
            with (
                patch(
                    "campus_ingestion_worker.check_internal_notice_pipeline_quality.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.check_internal_notice_pipeline_quality.build_authenticated_notice_source_truth_inventory_store_from_env"
                ),
                patch(
                    "campus_ingestion_worker.check_internal_notice_pipeline_quality.build_notice_consumption_projection_store_from_env"
                ),
                patch(
                    "campus_ingestion_worker.check_internal_notice_pipeline_quality.build_internal_notice_read_model_store_from_env"
                ),
                patch(
                    "campus_ingestion_worker.check_internal_notice_pipeline_quality.check_internal_notice_pipeline_quality",
                    return_value=report,
                ) as check,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(["--notice-id", "355002", "--selection-path", str(selection_path)])

        self.assertEqual(check.call_args.kwargs["notice_ids"], ("355002", "355001"))
        payload = json.loads(stdout.getvalue())
        self.assertFalse(payload["ok"])
        self.assertEqual(
            payload["findings"][0]["reason_code"],
            "regulation_ready_without_quality_gate",
        )


if __name__ == "__main__":
    unittest.main()
