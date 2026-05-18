import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SupervisorApiStagingPreflightTest(unittest.TestCase):
    def test_start_script_runs_preflight_before_compose_build(self) -> None:
        script = (ROOT / "infra/local/staging/start-supervisor-api-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("preflight-supervisor-api-staging.sh", script)
        self.assertLess(
            script.index("preflight-supervisor-api-staging.sh"),
            script.index("supervisor_api_staging_compose up -d --build"),
        )

    def test_preflight_script_checks_docker_and_registry_inputs(self) -> None:
        script = (ROOT / "infra/local/staging/preflight-supervisor-api-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("docker version", script)
        self.assertIn("--format", script)
        self.assertIn("SUPERVISOR_API_STAGING_PREFLIGHT_DOCKER_TIMEOUT_SECONDS", script)
        self.assertIn("SUPERVISOR_API_STAGING_PREFLIGHT_SKIP_REGISTRY", script)
        self.assertIn("SUPERVISOR_API_STAGING_PREFLIGHT_PULL", script)
        self.assertIn('timeout "${docker_timeout_seconds}"', script)
        self.assertIn("buildx imagetools inspect", script)
        self.assertNotIn("docker info", script)
        self.assertNotIn("docker manifest inspect", script)
        self.assertIn("docker pull", script)
        for image in (
            "golang:1.26.2-bookworm",
            "debian:bookworm-slim",
            "python:3.12-slim-bookworm",
            "ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim",
        ):
            self.assertIn(image, script)

    def test_staging_scripts_load_collector_env_and_capture_collector_logs(self) -> None:
        common_script = (ROOT / "infra/local/staging/supervisor-api-staging-common.sh").read_text(
            encoding="utf-8"
        )
        start_script = (ROOT / "infra/local/staging/start-supervisor-api-staging.sh").read_text(
            encoding="utf-8"
        )
        status_script = (ROOT / "infra/local/staging/status-supervisor-api-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("supervisor_api_staging_otel_collector_log_file", common_script)
        self.assertIn('"OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT"', common_script)
        self.assertIn('"OTEL_COLLECTOR_SENTRY_AUTH_VALUE"', common_script)
        self.assertIn('"OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT"', common_script)
        self.assertIn('"OTEL_COLLECTOR_AXIOM_AUTH_HEADER"', common_script)
        self.assertIn('"OTEL_COLLECTOR_AXIOM_EVENTS_DATASET"', common_script)
        self.assertIn('"OTEL_COLLECTOR_AXIOM_METRICS_DATASET"', common_script)
        self.assertIn('"SUPERVISOR_API_OTEL_ENABLED"', common_script)
        self.assertIn('"SUPERVISOR_AGENT_WORKER_OTEL_ENABLED"', common_script)
        self.assertIn("supervisor_api_staging_validate_axiom_collector_endpoint", common_script)
        self.assertIn("must be the Axiom OTLP base domain", common_script)
        self.assertIn("must match AXIOM_ENDPOINT", common_script)
        self.assertIn("otel-collector log contains permanent exporter failures", status_script)
        self.assertIn("logs --no-color otel-collector", common_script)
        self.assertIn('echo "  ${supervisor_api_staging_otel_collector_log_file}"', start_script)
        self.assertIn('echo "  ${supervisor_api_staging_otel_collector_log_file}"', status_script)
        self.assertIn('[[ "${services}" == *"otel-collector"* ]]', common_script)


if __name__ == "__main__":
    unittest.main()
