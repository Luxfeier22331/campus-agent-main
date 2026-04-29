from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.execute_collected_notice_regulation_owner_text"
)


class ExecuteCollectedNoticeRegulationOwnerTextWorkerTests(unittest.TestCase):
    def test_main_requires_execute_for_writes_and_emits_evidence_report(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            attempt_plan_path = tmp_path / "attempt-plan.json"
            output_dir = tmp_path / "phase-06-r1b"
            attempt_plan_path.write_text('{"attempts":[]}\n', encoding="utf-8")
            fake_report = {
                "schema_version": "collected_notice_regulation_owner_text_execution_report.v1",
                "phase": "phase-06-r1b-regulation-owner-text-recovery-execution",
                "mode": "execute",
                "write_enabled": True,
                "provider_calls_enabled": True,
                "counts": {
                    "selected_count": 1,
                    "succeeded_count": 1,
                    "failed_count": 0,
                },
                "attempt_results": [],
            }

            with (
                patch(
                    "campus_ingestion_worker."
                    "execute_collected_notice_regulation_owner_text.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.execute_collected_notice_regulation_owner_text."
                    "build_runtime_object_store"
                ) as build_store,
                patch(
                    "campus_ingestion_worker.execute_collected_notice_regulation_owner_text."
                    "build_runtime_online_ocr_clients"
                ) as build_clients,
                patch(
                    "campus_ingestion_worker.execute_collected_notice_regulation_owner_text."
                    "execute_collected_notice_regulation_owner_text_attempts",
                    return_value=fake_report,
                ) as execute_attempts,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--attempt-plan-path",
                        str(attempt_plan_path),
                        "--output-dir",
                        str(output_dir),
                        "--execute",
                    ]
                )

            build_store.assert_called_once()
            build_clients.assert_called_once()
            execute_attempts.assert_called_once()
            report_path = output_dir / "regulation-owner-text-execution-report.json"
            self.assertTrue(report_path.exists())
            self.assertEqual(json.loads(report_path.read_text(encoding="utf-8")), fake_report)
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "execute")
            self.assertTrue(payload["write_enabled"])
            self.assertTrue(payload["provider_calls_enabled"])
            self.assertEqual(payload["succeeded_count"], 1)


if __name__ == "__main__":
    unittest.main()
