from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
RUN_SCRIPT = REPO_ROOT / "scripts/run-internal-notice-multimodal-drain.sh"
SERVICE_UNIT = REPO_ROOT / "infra/local/systemd/campus-ingestion-internal-notice.service"
TIMER_UNIT = REPO_ROOT / "infra/local/systemd/campus-ingestion-internal-notice.timer"
RUNBOOK = REPO_ROOT / "docs/runbooks/ingestion-worker-on-demand-batch-runbook.md"
ROOT_ENV_EXAMPLE = REPO_ROOT / ".env.example"

INTERNAL_NOTICE_DB_ENV_KEYS = (
    "NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL",
    "NOTICE_CONSUMPTION_PROJECTION_OPERATOR_DATABASE_URL",
    "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",
    "INTERNAL_NOTICE_READ_MODEL_TABLE",
    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL",
    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_DATABASE_URL",
    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL",
    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_DATABASE_URL",
)


class IngestionWorkerOnDemandOpsTest(unittest.TestCase):
    def test_internal_notice_drain_script_runs_bounded_batch_without_promotion(self) -> None:
        script = RUN_SCRIPT.read_text(encoding="utf-8")

        self.assertTrue(script.startswith("#!/usr/bin/env bash\n"))
        self.assertIn("set -euo pipefail", script)
        self.assertIn("campus_ingestion_worker.on_demand_batch_runner", script)
        self.assertIn("internal-notice-multimodal-drain", script)
        self.assertIn("INGESTION_ON_DEMAND_DRAIN_LIMIT:-100", script)
        self.assertIn("INGESTION_ON_DEMAND_DRAIN_BATCH_SIZE:-20", script)
        self.assertIn("INGESTION_ON_DEMAND_DRAIN_MAX_ATTEMPTS:-3", script)
        self.assertIn("INGESTION_ON_DEMAND_REPORT_DIR:-.tmp/ingestion-reports", script)
        self.assertIn("date -u +%Y%m%dT%H%M%SZ", script)
        self.assertNotIn("--promote", script)

    def test_systemd_units_call_tracked_script_as_oneshot_daily_timer(self) -> None:
        service = SERVICE_UNIT.read_text(encoding="utf-8")
        timer = TIMER_UNIT.read_text(encoding="utf-8")

        self.assertIn("Type=oneshot", service)
        self.assertIn("WorkingDirectory=/srv/campus-agent", service)
        self.assertIn(
            "ExecStart=/srv/campus-agent/scripts/run-internal-notice-multimodal-drain.sh",
            service,
        )
        self.assertNotIn("--promote", service)
        self.assertIn("OnCalendar=*-*-* 03:30:00", timer)
        self.assertIn("Persistent=true", timer)
        self.assertIn("WantedBy=timers.target", timer)

    def test_runbook_documents_local_dev_flow_before_server_timer_install(self) -> None:
        runbook = RUNBOOK.read_text(encoding="utf-8")

        self.assertIn("## Local Development Flow", runbook)
        self.assertIn("不要安装或启动 systemd timer", runbook)
        self.assertIn("Read-Only Preflight", runbook)
        self.assertIn("campus-ingestion-run-on-demand-batch --help", runbook)
        self.assertIn("list_internal_notice_consumption_admissions", runbook)
        self.assertIn("worktree `.env`", runbook)
        self.assertIn("dev DB 与 dev object store", runbook)
        self.assertIn("--limit 1", runbook)
        self.assertIn("--batch-size 1", runbook)
        self.assertIn("--max-attempts 1", runbook)
        self.assertIn("--skip-read-model-rebuild", runbook)
        self.assertIn(".tmp/ingestion-reports", runbook)
        self.assertIn("CAMPUS_SHARED_POSTGRES_URL=postgresql://...dev...", runbook)
        self.assertIn("CAMPUS_SHARED_POSTGRES_OPERATOR_URL=postgresql://...dev...", runbook)
        self.assertIn("CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL=postgresql://...dev...", runbook)
        for env_key in INTERNAL_NOTICE_DB_ENV_KEYS:
            self.assertIn(env_key, runbook)

    def test_root_env_example_does_not_carry_internal_notice_db_overrides(self) -> None:
        env_example = ROOT_ENV_EXAMPLE.read_text(encoding="utf-8")

        self.assertIn("CAMPUS_SHARED_POSTGRES_URL=", env_example)
        for env_key in INTERNAL_NOTICE_DB_ENV_KEYS:
            self.assertNotIn(f"{env_key}=", env_example)


if __name__ == "__main__":
    unittest.main()
