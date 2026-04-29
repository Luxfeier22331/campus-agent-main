from __future__ import annotations

import importlib
import json
import os
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

retention = importlib.import_module("campus_ingestion_worker.report_retention")


class ReportRetentionWorkerTest(unittest.TestCase):
    def test_prune_report_directory_keeps_failed_and_prunes_old_succeeded(self) -> None:
        with TemporaryDirectory() as temp_dir:
            report_dir = Path(temp_dir)
            old_succeeded = report_dir / "old-succeeded.json"
            old_failed = report_dir / "old-failed.json"
            new_succeeded = report_dir / "new-succeeded.json"

            old_succeeded.write_text(
                json.dumps(
                    {"status": "succeeded", "batch_kind": "internal_notice_multimodal_drain"}
                ),
                encoding="utf-8",
            )
            old_failed.write_text(
                json.dumps({"status": "failed", "batch_kind": "authenticated_notice_closeout"}),
                encoding="utf-8",
            )
            new_succeeded.write_text(
                json.dumps({"status": "succeeded", "batch_kind": "official_web_handoffs"}),
                encoding="utf-8",
            )

            old_epoch = (datetime.now(UTC) - timedelta(days=30)).timestamp()
            os.utime(old_succeeded, (old_epoch, old_epoch))
            os.utime(old_failed, (old_epoch, old_epoch))

            report = retention.prune_report_directory(
                report_dir=report_dir,
                max_age_days=14,
                max_count=10,
                keep_failed=True,
            )

            self.assertEqual(report["status"], "succeeded")
            self.assertFalse(old_succeeded.exists())
            self.assertTrue(old_failed.exists())
            self.assertTrue(new_succeeded.exists())

            failed_index = report_dir / "failed-index.json"
            self.assertTrue(failed_index.exists())
            payload = json.loads(failed_index.read_text(encoding="utf-8"))
            self.assertEqual(payload["failed_report_count"], 1)
            self.assertEqual(
                payload["failed_reports"][0]["batch_kind"],
                "authenticated_notice_closeout",
            )

    def test_prune_report_directory_applies_max_count_when_reports_are_recent(self) -> None:
        with TemporaryDirectory() as temp_dir:
            report_dir = Path(temp_dir)
            for idx in range(3):
                path = report_dir / f"report-{idx}.json"
                path.write_text(
                    json.dumps(
                        {"status": "succeeded", "batch_kind": "internal_notice_multimodal_drain"}
                    ),
                    encoding="utf-8",
                )
                recent_epoch = (datetime.now(UTC) - timedelta(hours=2 - idx)).timestamp()
                os.utime(path, (recent_epoch, recent_epoch))

            report = retention.prune_report_directory(
                report_dir=report_dir,
                max_age_days=14,
                max_count=2,
                keep_failed=False,
            )

            self.assertEqual(report["status"], "succeeded")
            self.assertEqual(report["deleted_count"], 1)
            remaining = sorted(item.name for item in report_dir.glob("report-*.json"))
            self.assertEqual(remaining, ["report-1.json", "report-2.json"])

    def test_prune_report_directory_dry_run_reports_candidates_without_deleting(self) -> None:
        with TemporaryDirectory() as temp_dir:
            report_dir = Path(temp_dir)
            old_succeeded = report_dir / "old-succeeded.json"
            old_succeeded.write_text(
                json.dumps({"status": "succeeded", "batch_kind": "official_web_handoffs"}),
                encoding="utf-8",
            )
            old_epoch = (datetime.now(UTC) - timedelta(days=30)).timestamp()
            os.utime(old_succeeded, (old_epoch, old_epoch))

            report = retention.prune_report_directory(
                report_dir=report_dir,
                max_age_days=14,
                max_count=10,
                keep_failed=False,
                dry_run=True,
            )

            self.assertTrue(old_succeeded.exists())
            self.assertEqual(report["deleted_count"], 1)
            self.assertEqual(report["policy"]["dry_run"], True)


if __name__ == "__main__":
    unittest.main()
