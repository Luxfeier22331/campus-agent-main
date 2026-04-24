import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SupervisorApiExecutionAuditRuntimeTest(unittest.TestCase):
    def test_supervisor_runtime_compose_passes_execution_audit_env(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.supervisor-runtime.yml").read_text(
            encoding="utf-8"
        )

        for key in (
            "SUPERVISOR_API_EXECUTION_AUDIT_ENABLED",
            "SUPERVISOR_API_EXECUTION_AUDIT_URL",
            "SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET",
            "SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS",
            "SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY",
        ):
            self.assertIn(key, compose)

    def test_supervisor_api_staging_derives_execution_audit_from_app_api_config(self) -> None:
        script = (ROOT / "infra/local/staging/supervisor-api-staging-common.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn('"APP_API_INTERNAL_SHARED_SECRET"', script)
        self.assertIn('"SUPERVISOR_API_EXECUTION_AUDIT_ENABLED"', script)
        self.assertIn('"SUPERVISOR_API_EXECUTION_AUDIT_URL"', script)
        self.assertIn('"SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET"', script)
        self.assertIn("api/internal/execution/audit-events", script)
        self.assertIn("APP_API_INTERNAL_SHARED_SECRET", script)


if __name__ == "__main__":
    unittest.main()
