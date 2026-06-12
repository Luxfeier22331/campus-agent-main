from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class SupervisorStagingComposeContractTest(unittest.TestCase):
    def test_start_script_runs_preflight_before_compose_build(self) -> None:
        script = (ROOT / "infra/local/staging/start-execution-control-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("preflight-execution-control-staging.sh", script)
        self.assertLess(
            script.index("preflight-execution-control-staging.sh"),
            script.index("execution_control_staging_compose up -d --build"),
        )

    def test_start_script_installs_and_checks_durable_schema_before_compose(self) -> None:
        script = (ROOT / "infra/local/staging/start-execution-control-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("execution_control_staging_ensure_run_projection_store_schema", script)
        self.assertLess(
            script.index("execution_control_staging_ensure_run_projection_store_schema"),
            script.index("execution_control_staging_compose up -d --build"),
        )

    def test_start_script_initializes_temporal_namespace_before_compose_runtime_wait(self) -> None:
        script = (ROOT / "infra/local/staging/start-execution-control-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("execution_control_staging_temporal_namespace_setup", script)
        self.assertLess(
            script.index("execution_control_staging_compose up -d --build"),
            script.index("execution_control_staging_temporal_namespace_setup"),
        )
        self.assertLess(
            script.index("execution_control_staging_temporal_namespace_setup"),
            script.index("execution_control_staging_wait_for_http_ok"),
        )

    def test_core_module_runs_durable_schema_command_in_data_plane_container(self) -> None:
        script = (ROOT / "infra/local/staging/execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("execution_control_staging_ensure_run_projection_store_schema", script)
        self.assertIn("cmd/run-projection-schema", script)
        self.assertIn('--mode "${mode}"', script)
        self.assertIn("install \\", script)
        self.assertIn("check \\", script)
        self.assertIn("--network", script)
        self.assertIn("${execution_control_staging_data_plane_network}", script)
        self.assertIn("EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL", script)
        self.assertIn("run-projection-schema-install.json", script)
        self.assertIn("run-projection-schema-check.json", script)

    def test_staging_start_ensures_data_plane_network_before_compose(self) -> None:
        script = (ROOT / "infra/local/staging/start-execution-control-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("execution_control_staging_ensure_data_plane_network", script)
        self.assertIn(
            "execution_control_staging_ensure_self_hosted_data_plane_dependencies", script
        )
        self.assertLess(
            script.index("execution_control_staging_ensure_data_plane_network"),
            script.index("execution_control_staging_compose up -d --build"),
        )
        self.assertLess(
            script.index("execution_control_staging_ensure_self_hosted_data_plane_dependencies"),
            script.index("execution_control_staging_compose up -d --build"),
        )
        self.assertIn("execution_control_staging_require_container_qdrant_ready", script)

    def test_supervisor_runtime_compose_uses_repo_owned_data_plane_network(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.execution-control-runtime.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn("campus-agent-data-plane", compose)
        self.assertIn("external: true", compose)
        self.assertNotIn("host.docker.internal", compose)
        self.assertIn("supervisor-runtime", compose)
        execution_control_section = compose.split("  execution-control:", 1)[1].split(
            "\n\nnetworks:",
            1,
        )[0]
        self.assertIn("      - supervisor-runtime", execution_control_section)
        self.assertIn("      - data-plane", execution_control_section)

    def test_supervisor_runtime_compose_includes_self_hosted_temporal_plane(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.execution-control-runtime.yml").read_text(
            encoding="utf-8"
        )

        for service_name in (
            "temporal-postgres",
            "temporal",
            "temporal-ui",
            "temporal-namespace-setup",
        ):
            self.assertIn(f"  {service_name}:", compose)
        self.assertIn("temporalio/auto-setup:", compose)
        self.assertIn("temporalio/ui:", compose)
        self.assertIn("postgres:16-alpine", compose)
        self.assertIn("POSTGRES_DB: temporal", compose)
        self.assertIn("DB: postgres12", compose)
        self.assertIn("VISIBILITY_STORE: visibility", compose)
        self.assertIn("TEMPORAL_ADDRESS: temporal:7233", compose)
        self.assertIn("campus-agent-staging", compose)
        self.assertIn("campus-agent-prod", compose)
        self.assertIn(
            "EXECUTION_CONTROL_TEMPORAL_ADDRESS: ${EXECUTION_CONTROL_TEMPORAL_ADDRESS:?set EXECUTION_CONTROL_TEMPORAL_ADDRESS}",
            compose,
        )
        self.assertIn(
            "EXECUTION_CONTROL_TEMPORAL_NAMESPACE: ${EXECUTION_CONTROL_TEMPORAL_NAMESPACE:?set EXECUTION_CONTROL_TEMPORAL_NAMESPACE}",
            compose,
        )
        self.assertIn(
            "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE: ${EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE:-campus-agent.workflow}",
            compose,
        )
        self.assertIn(
            "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY: ${EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY:?set EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY}",
            compose,
        )
        self.assertIn(
            "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT: ${EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT:?set EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT}",
            compose,
        )
        self.assertIn(
            "EXECUTION_CONTROL_PROVIDER_PRICING_PATH: ${EXECUTION_CONTROL_PROVIDER_PRICING_PATH:-/etc/campus-agent/provider-pricing.v1.json}",
            compose,
        )
        self.assertNotIn("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED:", compose)
        self.assertNotIn("EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED:", compose)

    def test_personal_memory_write_key_stays_out_of_activity_workers(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.execution-control-runtime.yml").read_text(
            encoding="utf-8"
        )

        execution_control_section = compose.split("  execution-control:", 1)[1].split(
            "\n  workflow-worker:",
            1,
        )[0]
        context_worker_section = compose.split("  activity-worker-context:", 1)[1].split(
            "\n  activity-worker-knowledge:",
            1,
        )[0]
        knowledge_worker_section = compose.split("  activity-worker-knowledge:", 1)[1].split(
            "\n  activity-worker-campus-services:",
            1,
        )[0]
        campus_services_worker_section = compose.split(
            "  activity-worker-campus-services:",
            1,
        )[1].split("\n  activity-worker-notice:", 1)[0]
        notice_worker_section = compose.split("  activity-worker-notice:", 1)[1].split(
            "\n  activity-worker-navigation:",
            1,
        )[0]
        navigation_worker_section = compose.split("  activity-worker-navigation:", 1)[1].split(
            "\n  activity-worker-finalization:",
            1,
        )[0]

        self.assertIn("QDRANT_QUERY_API_KEY:", execution_control_section)
        self.assertIn("QDRANT_WRITE_API_KEY:", execution_control_section)
        self.assertIn("QDRANT_QUERY_API_KEY:", context_worker_section)
        self.assertIn("QDRANT_TLS_CA_CERT_PATH:", context_worker_section)
        self.assertNotIn("QDRANT_WRITE_API_KEY:", context_worker_section)
        self.assertIn("QDRANT_QUERY_API_KEY:", knowledge_worker_section)
        self.assertIn("QDRANT_TLS_CA_CERT_PATH:", knowledge_worker_section)
        self.assertNotIn("QDRANT_WRITE_API_KEY:", knowledge_worker_section)
        for typed_worker_section in (
            campus_services_worker_section,
            notice_worker_section,
            navigation_worker_section,
        ):
            self.assertNotIn("QDRANT_QUERY_API_KEY:", typed_worker_section)
            self.assertNotIn("QDRANT_WRITE_API_KEY:", typed_worker_section)
            self.assertNotIn("EMBEDDING_API_KEY:", typed_worker_section)

    def test_execution_control_runtime_timeout_budget_does_not_require_python_worker_budget(
        self,
    ) -> None:
        compose = (ROOT / "infra/local/docker-compose.execution-control-runtime.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "EXECUTION_CONTROL_REQUEST_TIMEOUT_MS: ${EXECUTION_CONTROL_REQUEST_TIMEOUT_MS:-95000}",
            compose,
        )
        self.assertNotIn("SUPERVISOR_AGENT_WORKER_TIMEOUT_MS", compose)
        self.assertNotIn("EXECUTION_CONTROL_BRIDGE_BREAKER", compose)

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
        self.assertIn('QDRANT__SERVICE__ENABLE_TLS: "true"', compose)
        self.assertIn("QDRANT__TLS__CERT: /qdrant/tls/server.crt", compose)
        self.assertIn("QDRANT__TLS__KEY: /qdrant/tls/server.key", compose)
        self.assertIn("${QDRANT_TLS_DIR:?set QDRANT_TLS_DIR}:/qdrant/tls:ro", compose)

    def test_preflight_script_checks_docker_and_registry_inputs(self) -> None:
        script = (ROOT / "infra/local/staging/preflight-execution-control-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("docker version", script)
        self.assertIn("execution_control_staging_require_deploy_checkout_clean", script)
        self.assertIn("execution_control_staging_load_env", script)
        self.assertIn("--format", script)
        self.assertIn("EXECUTION_CONTROL_STAGING_PREFLIGHT_DOCKER_TIMEOUT_SECONDS", script)
        self.assertIn("EXECUTION_CONTROL_STAGING_PREFLIGHT_SKIP_REGISTRY", script)
        self.assertIn("EXECUTION_CONTROL_STAGING_PREFLIGHT_PULL", script)
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

    def test_status_check_requires_provider_pricing_readyz_gate(self) -> None:
        script = (ROOT / "infra/local/staging/status-execution-control-staging.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("prompt_config_gate.admitted", script)
        self.assertIn("prompt_config_gate.pricing_version", script)
        self.assertIn("provider-pricing-v1", script)

    def test_provider_pricing_catalog_admits_staging_provider_model(self) -> None:
        catalog = json.loads((ROOT / "configs/runtime/provider-pricing.v1.json").read_text())
        admitted = {(entry["provider"], entry["model"]) for entry in catalog["models"]}

        self.assertIn(("openai", "gpt-5.4"), admitted)


if __name__ == "__main__":
    unittest.main()
