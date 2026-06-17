from __future__ import annotations

import json
import unittest
from pathlib import Path

from tests.execution_control_staging_preflight_support import run_local_runtime_script_with_env

ROOT = Path(__file__).resolve().parents[2]


class ExecutionControlLocalRuntimeBoundaryTest(unittest.TestCase):
    def test_default_start_reconciles_orphaned_retired_services(self) -> None:
        script = (ROOT / "infra/local/start-execution-control-runtime.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("set -- up -d --build --remove-orphans", script)

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
        agent_runtime_block = compose.split("  agent-runtime:", 1)[1].split(
            "\n  workflow-worker:",
            1,
        )[0]

        self.assertNotIn("ports:", agent_runtime_block)
        self.assertNotIn("AGENT_RUNTIME_HOST_PORT", agent_runtime_block)

    def test_local_runtime_projects_self_hosted_internal_defaults(self) -> None:
        result = run_local_runtime_script_with_env(
            repo_env="\n".join(
                (
                    "PROMPT_RUNTIME_API_KEY=prompt-key",
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


if __name__ == "__main__":
    unittest.main()
