from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.preview_collected_notice_reimport")


class PreviewCollectedNoticeReimportWorkerTests(unittest.TestCase):
    def test_main_writes_phase_four_evidence_files(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            output_dir = tmp_path / "phase-04"
            output_dir.mkdir()
            inventory_path = tmp_path / "captured-runs.json"
            inventory_path.write_text('{"runs":[]}\n', encoding="utf-8")
            fake_preview = worker.CollectedNoticeReimportPreview(
                reimport_plan={
                    "schema_version": "collected_notice_reimport_dry_run.v1",
                    "mode": "dry_run",
                    "write_enabled": False,
                },
                source_truth_preview={"schema_version": "source_truth_preview.v1"},
                searchable_notice_preview={
                    "schema_version": "collected_notice_searchable_preview.v1",
                    "units": [],
                    "unit_count": 0,
                },
                coverage_report={"schema_version": "searchable_coverage_report.v1"},
                invalid_defer_multimodal_report={
                    "schema_version": "invalid_defer_multimodal_report.v1"
                },
            )

            with (
                patch("campus_ingestion_worker.preview_collected_notice_reimport.load_worker_env"),
                patch(
                    "campus_ingestion_worker.preview_collected_notice_reimport."
                    "build_collected_notice_reimport_preview_from_inventory_path",
                    return_value=fake_preview,
                ) as build_preview,
                redirect_stdout(StringIO()),
            ):
                worker.main(
                    [
                        "--captured-runs-inventory-path",
                        str(inventory_path),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            build_preview.assert_called_once()
            expected_files = {
                "reimport-plan.dry-run.json",
                "source-truth-preview.json",
                "searchable-notice-preview.json",
                "searchable-coverage-report.json",
                "invalid-defer-requires-multimodal-report.json",
            }
            self.assertEqual({path.name for path in output_dir.glob("*.json")}, expected_files)
            plan = json.loads((output_dir / "reimport-plan.dry-run.json").read_text())
            self.assertFalse(plan["write_enabled"])
            self.assertEqual(plan["mode"], "dry_run")


if __name__ == "__main__":
    unittest.main()
