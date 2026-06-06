import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SupervisorApiExecutionAuditRuntimeTest(unittest.TestCase):
    def test_supervisor_runtime_compose_passes_execution_audit_env(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.supervisor-runtime.yml").read_text(
            encoding="utf-8"
        )

        for key in (
            "EXECUTION_GATEWAY_EXECUTION_AUDIT_ENABLED",
            "EXECUTION_GATEWAY_EXECUTION_AUDIT_URL",
            "EXECUTION_GATEWAY_EXECUTION_AUDIT_SHARED_SECRET",
            "EXECUTION_GATEWAY_EXECUTION_AUDIT_TIMEOUT_MS",
        ):
            self.assertIn(key, compose)

    def test_execution_gateway_staging_derives_execution_audit_from_app_api_config(self) -> None:
        script = (ROOT / "infra/local/staging/execution-gateway-staging-env.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn('"APP_API_INTERNAL_SHARED_SECRET"', script)
        self.assertIn('"EXECUTION_GATEWAY_EXECUTION_AUDIT_ENABLED"', script)
        self.assertIn('"EXECUTION_GATEWAY_EXECUTION_AUDIT_URL"', script)
        self.assertIn('"EXECUTION_GATEWAY_EXECUTION_AUDIT_SHARED_SECRET"', script)
        self.assertIn("api/internal/execution/audit-events", script)
        self.assertIn("APP_API_INTERNAL_SHARED_SECRET", script)


if __name__ == "__main__":
    unittest.main()
