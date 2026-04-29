from __future__ import annotations

import importlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.reset_collected_notice_consumption_state")


class ResetCollectedNoticeConsumptionStateWorkerTest(unittest.TestCase):
    def test_execute_requires_yes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            dry_run_path = Path(temp_dir) / "dry-run.json"
            backup_path = Path(temp_dir) / "backup.json"
            output_path = Path(temp_dir) / "execute.json"
            dry_run_path.write_text("{}", encoding="utf-8")
            backup_path.write_text("{}", encoding="utf-8")
            with (
                patch(
                    "campus_ingestion_worker.reset_collected_notice_consumption_state.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.reset_collected_notice_consumption_state.resolve_collected_notice_reset_database_url",
                    return_value="postgresql://example",
                ),
                self.assertRaises(SystemExit),
            ):
                worker.main(
                    [
                        "execute",
                        "--dry-run-report",
                        str(dry_run_path),
                        "--backup-report",
                        str(backup_path),
                        "--output",
                        str(output_path),
                    ]
                )

    def test_execute_requires_dry_run_and_backup_reports(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.reset_collected_notice_consumption_state.load_worker_env"
            ),
            self.assertRaises(SystemExit),
        ):
            worker.main(["execute", "--yes"])

    def test_dry_run_writes_report_to_output_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "dry-run.json"
            with (
                patch(
                    "campus_ingestion_worker.reset_collected_notice_consumption_state.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.reset_collected_notice_consumption_state.resolve_collected_notice_reset_database_url",
                    return_value="postgresql://example",
                ),
                patch(
                    "campus_ingestion_worker.reset_collected_notice_consumption_state.generate_collected_notice_reset_dry_run_report",
                    return_value={"schema_version": "collected_notice_reset_report.v1"},
                ),
            ):
                worker.main(["dry-run", "--output", str(output_path)])

            self.assertTrue(output_path.exists())


if __name__ == "__main__":
    unittest.main()
