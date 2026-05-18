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
    "campus_ingestion_worker.create_authenticated_notice_smoke_replay_run"
)


class CreateAuthenticatedNoticeSmokeReplayRunWorkerTest(unittest.TestCase):
    def test_main_writes_dry_run_replay_plan(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "replay"
            with (
                patch(
                    "campus_ingestion_worker.create_authenticated_notice_smoke_replay_run."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.create_authenticated_notice_smoke_replay_run."
                    "collector_run_ledger_database_url_from_env",
                    return_value="postgresql://example/db",
                ),
                patch(
                    "campus_ingestion_worker.create_authenticated_notice_smoke_replay_run."
                    "fetch_authenticated_notice_collector_run_row",
                    return_value=_source_row(),
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--source-run-id",
                        "run-001",
                        "--purpose",
                        "phase1_wrapper_execute_smoke",
                        "--synthetic-run-id",
                        "run-001:smoke:test",
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertFalse(payload["write_enabled"])
            self.assertEqual(payload["synthetic_run_id"], "run-001:smoke:test")
            self.assertTrue(
                (output_dir / "authenticated-notice-smoke-replay-run.dry-run.json").exists()
            )
            self.assertEqual(
                (output_dir / "synthetic-run-id.txt").read_text(encoding="utf-8").strip(),
                "run-001:smoke:test",
            )


def _source_row() -> dict[str, object]:
    from tests.ingestion.test_authenticated_notice_smoke_replay_run import _source_row

    return _source_row()


if __name__ == "__main__":
    unittest.main()
