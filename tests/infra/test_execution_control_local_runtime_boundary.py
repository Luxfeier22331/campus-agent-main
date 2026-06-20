from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from tests.execution_control_staging_preflight_support import run_local_runtime_script_with_env

ROOT = Path(__file__).resolve().parents[2]
LANGFUSE_COMPOSE = ROOT / "infra/local/docker-compose.execution-control-runtime.langfuse.yml"
MINIMAL_COMPOSE = ROOT / "infra/local/docker-compose.execution-control-runtime.minimal.yml"
LOCAL_REAL_PROVIDER_PROFILE = (
    ROOT / "configs/runtime/execution-control/runtime-profile.local-real-provider.json"
)
STAGING_PROFILE = ROOT / "configs/runtime/execution-control/runtime-profile.staging.json"


class ExecutionControlLocalRuntimeBoundaryTest(unittest.TestCase):
    def test_default_start_reconciles_orphaned_retired_services(self) -> None:
        script = (ROOT / "infra/local/start-execution-control-runtime.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("set -- up -d --build --remove-orphans", script)
        self.assertIn('runtime_flavor="${EXECUTION_CONTROL_RUNTIME_FLAVOR:-prodlike}"', script)
        self.assertIn(
            'files=("${compose_file}" "${compose_local_file}" "${compose_langfuse_file}")', script
        )
        self.assertIn('files=("${compose_file}" "${compose_minimal_file}")', script)

    def test_local_compose_does_not_define_retired_zep_services(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.execution-control-runtime.yml").read_text(
            encoding="utf-8"
        )

        for retired_service in (
            "zep-ce-api:",
            "zep-ce-graphiti:",
            "zep-ce-neo4j:",
            "zep-ce-postgres:",
        ):
            with self.subTest(retired_service=retired_service):
                self.assertNotIn(retired_service, compose)

    def test_local_compose_does_not_publish_agent_runtime_by_default(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.execution-control-runtime.yml").read_text(
            encoding="utf-8"
        )
        agent_runtime_block = _compose_service_block(compose, "agent-runtime")

        self.assertNotIn("ports:", agent_runtime_block)
        self.assertNotIn("AGENT_RUNTIME_HOST_PORT", agent_runtime_block)

    def test_prodlike_local_compose_declares_langfuse_self_host_stack(self) -> None:
        compose = LANGFUSE_COMPOSE.read_text(encoding="utf-8")

        for service in (
            "langfuse-web:",
            "langfuse-worker:",
            "langfuse-postgres:",
            "langfuse-clickhouse:",
            "langfuse-redis:",
            "langfuse-minio:",
        ):
            with self.subTest(service=service):
                self.assertIn(service, compose)
        self.assertIn("docker.io/langfuse/langfuse:3", compose)
        self.assertIn("docker.io/langfuse/langfuse-worker:3", compose)
        self.assertIn("LANGFUSE_INIT_PROJECT_PUBLIC_KEY", compose)
        self.assertIn("HOSTNAME: 0.0.0.0", compose)
        self.assertIn("TZ: UTC", compose)
        self.assertIn("PGTZ: UTC", compose)

    def test_minimal_local_compose_keeps_debug_collector_without_langfuse(self) -> None:
        compose = MINIMAL_COMPOSE.read_text(encoding="utf-8")

        self.assertIn(
            "../otel/collector-local-debug.yaml:/etc/otelcol-contrib/config.yaml:ro", compose
        )
        self.assertNotIn("langfuse-web:", compose)
        self.assertNotIn("langfuse-worker:", compose)

    def test_persistent_postgres_healthchecks_allow_local_recovery(self) -> None:
        base_compose = (
            ROOT / "infra/local/docker-compose.execution-control-runtime.yml"
        ).read_text(encoding="utf-8")
        langfuse_compose = LANGFUSE_COMPOSE.read_text(encoding="utf-8")

        for service, compose in (
            ("temporal-postgres", base_compose),
            ("hindsight-postgres", base_compose),
            ("langfuse-postgres", langfuse_compose),
        ):
            with self.subTest(service=service):
                block = _compose_service_block(compose, service)
                self.assertIn("retries: 60", block)
                self.assertIn("start_period: 180s", block)

    def test_hindsight_api_healthcheck_allows_provider_initialization(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.execution-control-runtime.yml").read_text(
            encoding="utf-8"
        )
        block = _compose_service_block(compose, "hindsight-api")

        self.assertIn("retries: 60", block)
        self.assertIn("start_period: 180s", block)

    def test_execution_control_waits_for_runtime_dependencies(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.execution-control-runtime.yml").read_text(
            encoding="utf-8"
        )
        block = _compose_service_block(compose, "execution-control")

        for dependency in (
            "temporal:",
            "temporal-namespace-setup:",
            "hindsight-api:",
            "agent-runtime:",
        ):
            with self.subTest(dependency=dependency):
                self.assertIn(dependency, block)
        self.assertIn("condition: service_healthy", block)
        self.assertIn("condition: service_completed_successfully", block)

    def test_knowledge_retrieval_worker_receives_personal_memory_runtime_env(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.execution-control-runtime.yml").read_text(
            encoding="utf-8"
        )
        block = _compose_service_block(compose, "activity-worker-knowledge-retrieval")

        self.assertIn(
            "PERSONAL_MEMORY_BASE_URL: ${PERSONAL_MEMORY_BASE_URL:-http://hindsight-api:8888}",
            block,
        )
        self.assertIn("PERSONAL_MEMORY_API_SECRET: ${PERSONAL_MEMORY_API_SECRET}", block)
        self.assertIn("PERSONAL_MEMORY_OWNER_SALT: ${PERSONAL_MEMORY_OWNER_SALT}", block)

    def test_real_runtime_profiles_keep_qdrant_budget_aligned_with_local_convention(self) -> None:
        for profile_path in (LOCAL_REAL_PROVIDER_PROFILE, STAGING_PROFILE):
            with self.subTest(profile=profile_path.name):
                profile = json.loads(profile_path.read_text(encoding="utf-8"))
                self.assertEqual(profile["rag"]["qdrant_timeout_ms"], 60000)

    def test_local_runtime_projects_self_hosted_internal_defaults(self) -> None:
        result = run_local_runtime_script_with_env(
            repo_env="\n".join(
                (
                    "HINDSIGHT_API_LLM_API_KEY=hindsight-llm-key",
                    "EMBEDDING_API_KEY=embedding-key",
                    "EMBEDDING_MODEL=Qwen3-Embedding-4B",
                    "EMBEDDING_DIMENSIONS=2560",
                    "APP_API_INTERNAL_SHARED_SECRET=app-api-secret",
                )
            )
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["QDRANT_URL"], "http://qdrant:6333")
        self.assertEqual(projected["EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS"], "5000")
        self.assertEqual(projected["EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS"], "30000")
        self.assertEqual(
            projected["EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"],
            "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
        )
        self.assertRegex(projected["QDRANT_QUERY_API_KEY"], r"^[A-Za-z0-9_-]{32,}$")
        self.assertEqual(projected["EXECUTION_CONTROL_TEMPORAL_ADDRESS"], "temporal:7233")
        self.assertEqual(projected["PERSONAL_MEMORY_BASE_URL"], "http://hindsight-api:8888")
        self.assertRegex(projected["TEMPORAL_POSTGRES_PASSWORD"], r"^[A-Za-z0-9_-]{32,}$")
        self.assertRegex(
            projected["EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT"],
            r"^[A-Za-z0-9_-]{32,}$",
        )
        self.assertRegex(
            projected["EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET"],
            r"^[A-Za-z0-9_-]{32,}$",
        )
        self.assertRegex(
            projected["EXECUTION_CONTROL_METRICS_BEARER_TOKEN"],
            r"^[A-Za-z0-9_-]{32,}$",
        )
        self.assertEqual(projected["LANGFUSE_BASE_URL"], "http://127.0.0.1:3000")
        self.assertEqual(
            projected["OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT"],
            "http://langfuse-web:3000/api/public/otel",
        )
        self.assertRegex(projected["OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER"], r"^Basic .+")
        self.assertEqual(projected["OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION"], "4")


def _compose_service_block(compose: str, service: str) -> str:
    match = re.search(
        rf"^  {re.escape(service)}:\n(?P<body>(?:    .*\n|      .*\n|        .*\n)+)",
        compose,
        re.MULTILINE,
    )
    if not match:
        return ""
    return match.group("body")


if __name__ == "__main__":
    unittest.main()
