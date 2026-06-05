from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class SupervisorStagingComposeContractTest(unittest.TestCase):
    def test_start_script_runs_preflight_before_compose_build(self) -> None:
        script = (ROOT / "infra/local/staging/start-supervisor-api-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("preflight-supervisor-api-staging.sh", script)
        self.assertLess(
            script.index("preflight-supervisor-api-staging.sh"),
            script.index("supervisor_api_staging_compose up -d --build"),
        )

    def test_start_script_installs_and_checks_durable_schema_before_compose(self) -> None:
        script = (ROOT / "infra/local/staging/start-supervisor-api-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("supervisor_api_staging_ensure_durable_runtime_schema", script)
        self.assertLess(
            script.index("supervisor_api_staging_ensure_durable_runtime_schema"),
            script.index("supervisor_api_staging_compose up -d --build"),
        )

    def test_core_module_runs_durable_schema_command_in_data_plane_container(self) -> None:
        script = (ROOT / "infra/local/staging/supervisor-api-staging-core.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("supervisor_api_staging_ensure_durable_runtime_schema", script)
        self.assertIn("cmd/durable-runtime-schema", script)
        self.assertIn('--mode "${mode}"', script)
        self.assertIn("install \\", script)
        self.assertIn("check \\", script)
        self.assertIn("--network", script)
        self.assertIn("${supervisor_api_staging_data_plane_network}", script)
        self.assertIn("SUPERVISOR_API_DURABLE_RUNTIME_DOCKER_DATABASE_URL", script)
        self.assertIn("durable-runtime-schema-install.json", script)
        self.assertIn("durable-runtime-schema-check.json", script)

    def test_staging_start_ensures_data_plane_network_before_compose(self) -> None:
        script = (ROOT / "infra/local/staging/start-supervisor-api-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("supervisor_api_staging_ensure_data_plane_network", script)
        self.assertIn("supervisor_api_staging_ensure_self_hosted_data_plane_dependencies", script)
        self.assertLess(
            script.index("supervisor_api_staging_ensure_data_plane_network"),
            script.index("supervisor_api_staging_compose up -d --build"),
        )
        self.assertLess(
            script.index("supervisor_api_staging_ensure_self_hosted_data_plane_dependencies"),
            script.index("supervisor_api_staging_compose up -d --build"),
        )
        self.assertIn("supervisor_api_staging_require_container_qdrant_ready", script)

    def test_supervisor_runtime_compose_uses_repo_owned_data_plane_network(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.supervisor-runtime.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn("campus-agent-data-plane", compose)
        self.assertIn("external: true", compose)
        self.assertNotIn("host.docker.internal", compose)
        self.assertIn("supervisor-runtime", compose)
        supervisor_api_section = compose.split("  supervisor-api:", 1)[1].split(
            "\n\nnetworks:",
            1,
        )[0]
        self.assertIn("      - supervisor-runtime", supervisor_api_section)
        self.assertIn("      - data-plane", supervisor_api_section)

    def test_supervisor_runtime_timeout_budget_wraps_agent_worker_budget(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.supervisor-runtime.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "SUPERVISOR_API_REQUEST_TIMEOUT_MS: ${SUPERVISOR_API_REQUEST_TIMEOUT_MS:-95000}",
            compose,
        )
        self.assertIn(
            "SUPERVISOR_AGENT_WORKER_TIMEOUT_MS: ${SUPERVISOR_AGENT_WORKER_TIMEOUT_MS:-90000}",
            compose,
        )

    def test_local_data_plane_compose_files_join_repo_owned_network(self) -> None:
        for relative_path, alias in (
            ("infra/local/docker-compose.qdrant-single-node.yml", "qdrant"),
            ("infra/local/docker-compose.postgres.yml", "campus-agent-postgres"),
            ("infra/local/docker-compose.minio.yml", "minio"),
        ):
            compose = (ROOT / relative_path).read_text(encoding="utf-8")
            with self.subTest(compose=relative_path):
                self.assertIn("campus-agent-data-plane", compose)
                self.assertIn("external: true", compose)
                self.assertIn(f"- {alias}", compose)

    def test_self_hosted_qdrant_image_supports_server_side_bm25_inference(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.qdrant-single-node.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn("qdrant/qdrant:v1.15.5", compose)

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
