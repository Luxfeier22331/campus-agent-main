from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.collected_notice_replay_closeout_acceptance import (
    CollectedNoticeReplayCloseoutReport,
)

worker = importlib.import_module(
    "campus_ingestion_worker.generate_collected_notice_replay_closeout_acceptance"
)


class GenerateCollectedNoticeReplayCloseoutAcceptanceWorkerTests(unittest.TestCase):
    def test_main_writes_closeout_evidence_files(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir) / "workstream"
            output_dir = root / "evidence/phase-07-acceptance-and-closeout"
            fake_report = CollectedNoticeReplayCloseoutReport(
                acceptance_report={
                    "schema_version": "collected_notice_replay_closeout_acceptance.v1",
                    "verdict": "passed_with_deferred_items",
                    "acceptance_checks": [],
                },
                source_to_downstream_trace={
                    "schema_version": "collected_notice_replay_closeout_trace.v1",
                },
            )

            with (
                patch(
                    "campus_ingestion_worker."
                    "generate_collected_notice_replay_closeout_acceptance.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker."
                    "generate_collected_notice_replay_closeout_acceptance."
                    "build_closeout_acceptance_report_from_root",
                    return_value=fake_report,
                ) as build_report,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--workstream-root",
                        str(root),
                        "--output-dir",
                        str(output_dir),
                        "--generated-at",
                        "2026-04-29T16:00:00+08:00",
                    ]
                )

            build_report.assert_called_once()
            self.assertEqual(
                {path.name for path in output_dir.glob("*.json")},
                {
                    "acceptance-summary.json",
                    "source-to-queue-to-search-to-downstream-trace.json",
                },
            )
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertFalse(payload["write_enabled"])
            self.assertEqual(payload["verdict"], "passed_with_deferred_items")


if __name__ == "__main__":
    unittest.main()
