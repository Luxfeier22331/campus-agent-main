from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
RUN_SCRIPT = REPO_ROOT / "scripts/run-internal-notice-multimodal-drain.sh"
RUN_BATCH_SCRIPT = REPO_ROOT / "scripts/run-ingestion-worker-batch.sh"
RUN_OFFICIAL_WEB_SCRIPT = REPO_ROOT / "scripts/run-official-web-handoffs.sh"
RUN_CLOSEOUT_SCRIPT = REPO_ROOT / "scripts/run-authenticated-notice-closeout.sh"
RUN_WECHAT_SCRIPT = REPO_ROOT / "scripts/run-wechat-public-notices.sh"
SERVICE_UNIT = REPO_ROOT / "infra/local/systemd/campus-ingestion-internal-notice.service"
TIMER_UNIT = REPO_ROOT / "infra/local/systemd/campus-ingestion-internal-notice.timer"
OFFICIAL_WEB_SERVICE_UNIT = (
    REPO_ROOT / "infra/local/systemd/campus-ingestion-official-web-handoffs.service"
)
OFFICIAL_WEB_TIMER_UNIT = (
    REPO_ROOT / "infra/local/systemd/campus-ingestion-official-web-handoffs.timer"
)
AUTH_CLOSEOUT_SERVICE_UNIT = (
    REPO_ROOT / "infra/local/systemd/campus-ingestion-authenticated-notice-closeout.service"
)
AUTH_CLOSEOUT_TIMER_UNIT = (
    REPO_ROOT / "infra/local/systemd/campus-ingestion-authenticated-notice-closeout.timer"
)
WECHAT_SERVICE_UNIT = (
    REPO_ROOT / "infra/local/systemd/campus-ingestion-wechat-public-notices.service"
)
INGESTION_DOCKERFILE = REPO_ROOT / "apps/ingestion-worker/Dockerfile"
INGESTION_DOCKER_ENTRYPOINT = REPO_ROOT / "apps/ingestion-worker/docker-entrypoint.sh"
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
    def test_internal_notice_drain_script_routes_to_unified_batch_shell(self) -> None:
        script = RUN_SCRIPT.read_text(encoding="utf-8")
        batch_script = RUN_BATCH_SCRIPT.read_text(encoding="utf-8")
        official_web_script = RUN_OFFICIAL_WEB_SCRIPT.read_text(encoding="utf-8")
        closeout_script = RUN_CLOSEOUT_SCRIPT.read_text(encoding="utf-8")
        wechat_script = RUN_WECHAT_SCRIPT.read_text(encoding="utf-8")

        self.assertTrue(script.startswith("#!/usr/bin/env bash\n"))
        self.assertTrue(batch_script.startswith("#!/usr/bin/env bash\n"))
        self.assertIn("set -euo pipefail", script)
        self.assertIn("run-ingestion-worker-batch.sh", script)
        self.assertIn("internal-notice-multimodal-drain", script)
        self.assertIn("INGESTION_ON_DEMAND_DRAIN_LIMIT:-100", script)
        self.assertIn("INGESTION_ON_DEMAND_DRAIN_BATCH_SIZE:-20", script)
        self.assertIn("INGESTION_ON_DEMAND_DRAIN_MAX_ATTEMPTS:-3", script)
        self.assertIn("INGESTION_ON_DEMAND_DRAIN_CONSUMER_ADMISSION_MANIFEST_PATH", script)
        self.assertIn("--consumer-admission-manifest-path", script)
        self.assertIn("INGESTION_ON_DEMAND_REPORT_DIR:-.tmp/ingestion-reports", batch_script)
        self.assertIn("flock -n 9", batch_script)
        self.assertIn("campus-ingestion-preflight", batch_script)
        self.assertIn("campus_ingestion_worker.on_demand_batch_runner", batch_script)
        self.assertIn("campus-ingestion-prune-reports", batch_script)
        self.assertIn("retention_keep_failed_flag", batch_script)
        self.assertIn("--no-keep-failed", batch_script)
        self.assertIn("batch_command=(", batch_script)
        self.assertIn("uv", batch_script)
        self.assertIn("--all-packages", batch_script)
        self.assertIn("batch_exit_code=$?", batch_script)
        self.assertGreater(
            batch_script.index("campus-ingestion-prune-reports"),
            batch_script.index("batch_command=("),
        )
        self.assertIn("official-web-handoffs", official_web_script)
        self.assertIn("authenticated-notice-closeout", closeout_script)
        self.assertIn("wechat-public-notices", wechat_script)
        self.assertIn("wechat-public-notice-multimodal-drain", wechat_script)
        self.assertIn("INGESTION_ON_DEMAND_WECHAT_WORKFLOW_LOCK_FILE", wechat_script)
        self.assertIn("wechat-public-notice-workflow.lock", wechat_script)
        self.assertIn("exec 8>", wechat_script)
        self.assertIn("flock -n 8", wechat_script)
        self.assertIn("INGESTION_ON_DEMAND_WECHAT_MULTIMODAL_DRAIN:-1", wechat_script)
        self.assertIn(
            "INGESTION_ON_DEMAND_WECHAT_MULTIMODAL_DRAIN_BATCH_SIZE:-20",
            wechat_script,
        )
        self.assertNotIn("--promote", script)

    def test_systemd_units_are_hardened_for_oneshot_batch_execution(self) -> None:
        service = SERVICE_UNIT.read_text(encoding="utf-8")
        timer = TIMER_UNIT.read_text(encoding="utf-8")
        official_web_service = OFFICIAL_WEB_SERVICE_UNIT.read_text(encoding="utf-8")
        official_web_timer = OFFICIAL_WEB_TIMER_UNIT.read_text(encoding="utf-8")
        closeout_service = AUTH_CLOSEOUT_SERVICE_UNIT.read_text(encoding="utf-8")
        closeout_timer = AUTH_CLOSEOUT_TIMER_UNIT.read_text(encoding="utf-8")
        wechat_service = WECHAT_SERVICE_UNIT.read_text(encoding="utf-8")

        self.assertIn("Type=oneshot", service)
        self.assertIn("User=campus-agent", service)
        self.assertIn("EnvironmentFile=-/etc/campus-agent/ingestion-worker.env", service)
        self.assertIn("Environment=UV_CACHE_DIR=/srv/campus-agent/.tmp/uv-cache", service)
        self.assertIn("NoNewPrivileges=true", service)
        self.assertIn("PrivateTmp=true", service)
        self.assertIn("ProtectSystem=strict", service)
        self.assertIn("ProtectHome=true", service)
        self.assertIn("/srv/campus-agent/.tmp/uv-cache", service)
        self.assertIn("MemoryMax=768M", service)
        self.assertIn("CPUQuota=100%", service)
        self.assertIn("WorkingDirectory=/srv/campus-agent", service)
        self.assertIn(
            "ExecStart=/srv/campus-agent/scripts/run-internal-notice-multimodal-drain.sh",
            service,
        )
        self.assertNotIn("--promote", service)
        self.assertIn("OnCalendar=*-*-* 03:30:00", timer)
        self.assertIn("Persistent=true", timer)
        self.assertIn("WantedBy=timers.target", timer)
        self.assertIn(
            "ExecStart=/srv/campus-agent/scripts/run-official-web-handoffs.sh",
            official_web_service,
        )
        self.assertIn("OnCalendar=hourly", official_web_timer)
        self.assertIn(
            "ExecStart=/srv/campus-agent/scripts/run-authenticated-notice-closeout.sh",
            closeout_service,
        )
        self.assertIn("OnCalendar=*-*-* 04:10:00", closeout_timer)
        self.assertIn(
            "ExecStart=/srv/campus-agent/scripts/run-wechat-public-notices.sh",
            wechat_service,
        )

    def test_ingestion_worker_docker_artifacts_exist_and_use_batch_entrypoint(self) -> None:
        dockerfile = INGESTION_DOCKERFILE.read_text(encoding="utf-8")
        entrypoint = INGESTION_DOCKER_ENTRYPOINT.read_text(encoding="utf-8")

        self.assertIn("FROM ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim", dockerfile)
        self.assertIn("INGESTION_ON_DEMAND_BATCH_KIND=internal-notice-multimodal-drain", dockerfile)
        self.assertIn('ENTRYPOINT ["/app/apps/ingestion-worker/docker-entrypoint.sh"]', dockerfile)
        self.assertTrue(entrypoint.startswith("#!/usr/bin/env bash\n"))
        self.assertIn("run-ingestion-worker-batch.sh", entrypoint)

    def test_runbook_documents_local_dev_flow_before_server_timer_install(self) -> None:
        runbook = RUNBOOK.read_text(encoding="utf-8")

        self.assertIn("## Local Development Flow", runbook)
        self.assertIn("不要安装或启动 systemd timer", runbook)
        self.assertIn("Read-Only Preflight", runbook)
        self.assertIn("campus-ingestion-run-on-demand-batch --help", runbook)
        self.assertIn("campus-ingestion-prune-reports", runbook)
        self.assertIn("run-ingestion-worker-batch.sh", runbook)
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
