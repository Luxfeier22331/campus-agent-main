from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts import execution_control_process_smoke_runtime as runtime


class ExecutionControlProcessSmokeStructuredSeedTest(unittest.TestCase):
    def test_structured_seed_fails_closed_after_python_db_runtime_retirement(self) -> None:
        with (
            TemporaryDirectory() as temp_dir,
            self.assertRaisesRegex(RuntimeError, "tool read-model projection"),
        ):
            runtime._seed_tool_read_model_projection_smoke(
                repo_root=Path(temp_dir),
                runtime_database_url="postgresql://process-smoke/runtime",
                log_path=Path(temp_dir) / "structured-seed.log",
                timeout_seconds=1.0,
                collections=("transport_schedule",),
                generated_at="2026-04-24T20:30:00+08:00",
            )

    def test_notice_read_model_seed_fails_closed_after_python_db_runtime_retirement(
        self,
    ) -> None:
        with (
            TemporaryDirectory() as temp_dir,
            self.assertRaisesRegex(RuntimeError, "notice read-model"),
        ):
            runtime._seed_notice_read_model_smoke(
                runtime_database_url="postgresql://process-smoke/runtime",
                log_path=Path(temp_dir) / "notice-seed.log",
            )

    def test_temporary_postgres_bootstrap_fails_closed_after_python_runtime_retirement(
        self,
    ) -> None:
        with self.assertRaisesRegex(RuntimeError, "Python temporary Postgres"):
            runtime._create_temporary_postgres_database(
                "postgresql://process-smoke/postgres",
                "campus_agent_process_smoke",
            )


if __name__ == "__main__":
    unittest.main()
