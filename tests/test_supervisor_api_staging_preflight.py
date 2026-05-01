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


if __name__ == "__main__":
    unittest.main()
