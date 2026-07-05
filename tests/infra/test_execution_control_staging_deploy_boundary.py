from __future__ import annotations

import json
import unittest
from pathlib import Path

from tests.execution_control_staging_preflight_support import (
    run_common_script_with_env,
)
from tests.infra.execution_control_staging_deploy_boundary_support import (
    run_checkout_guard,
    run_env_loader_twice_for_hindsight_defaults,
    run_env_loader_twice_for_self_hosted_runtime_defaults,
    run_env_loader_with_repo_local_secrets_only,
    run_env_loader_without_runtime_env,
)

ROOT = Path(__file__).resolve().parents[2]
STAGING_DIR = ROOT / "infra" / "local" / "staging"


def _compose_service_block(compose_source: str, service_name: str) -> str:
    service_header = f"  {service_name}:"
    start = compose_source.index(service_header)
    next_service = compose_source.find("\n  ", start + len(service_header))
    while next_service != -1 and compose_source[next_service + 3].isspace():
        next_service = compose_source.find("\n  ", next_service + 1)
    if next_service == -1:
        return compose_source[start:]
    return compose_source[start:next_service]


class ExecutionControlStagingDeployBoundaryTest(unittest.TestCase):
    def test_common_defaults_runtime_env_to_ops_owned_path(self) -> None:
        common_script = (STAGING_DIR / "execution-control-staging-common.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "/srv/docker/campus-agent/staging/env/runtime.env",
            common_script,
        )
        self.assertIn("EXECUTION_CONTROL_STAGING_ENV_FILE", common_script)

    def test_env_loader_requires_external_runtime_env_file(self) -> None:
        result = run_env_loader_without_runtime_env()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("EXECUTION_CONTROL_STAGING_ENV_FILE is required", result.stderr)
        self.assertIn("/srv/docker/campus-agent/staging/env/runtime.env", result.stderr)

    def test_env_loader_does_not_read_repo_local_env_or_app_api_dev_vars(self) -> None:
        result = run_env_loader_with_repo_local_secrets_only()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("API_WORKER_SHARED_SECRET is required", result.stderr)
        self.assertIn("runtime.env", result.stderr)
        self.assertNotIn("repo-local-secret", result.stdout)
        self.assertNotIn("dev-vars-secret", result.stdout)

    def test_compose_wrapper_passes_ops_env_file_to_docker_compose(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("--env-file", core_script)
        self.assertIn('"${execution_control_staging_env_file}"', core_script)

    def test_default_runtime_compose_keeps_ops_proof_services_out_of_serving_path(
        self,
    ) -> None:
        compose_file = ROOT / "infra/local/docker-compose.execution-control-runtime.yml"
        compose_source = compose_file.read_text(encoding="utf-8")

        for service_name in (
            "temporal-task-queue-sampler",
            "worker-autoscaler-bin",
            "worker-autoscaler",
        ):
            with self.subTest(service=service_name):
                service_block = _compose_service_block(compose_source, service_name)
                self.assertIn('profiles: ["ops-proof"]', service_block)
                self.assertIn('restart: "no"', service_block)
                self.assertNotIn("while true", service_block)
                self.assertNotIn('sleep "$${', service_block)

    def test_default_runtime_compose_keeps_heavy_surfaces_opt_in(
        self,
    ) -> None:
        compose_file = ROOT / "infra/local/docker-compose.execution-control-runtime.yml"
        compose_source = compose_file.read_text(encoding="utf-8")

        service_block = _compose_service_block(compose_source, "temporal-ui")
        self.assertIn('profiles: ["ui"]', service_block)
        for retired_service in (
            "activity-worker-campus-services",
            "activity-worker-notice",
            "activity-worker-navigation",
        ):
            with self.subTest(retired_service=retired_service):
                self.assertNotIn(f"  {retired_service}:", compose_source)

    def test_staging_helper_exposes_explicit_ops_proof_command(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("execution_control_staging_run_ops_proof()", core_script)
        self.assertIn("execution_control_staging_remove_ops_proof_containers", core_script)
        self.assertIn('"temporal-task-queue-sampler"', core_script)
        self.assertIn('"worker-autoscaler"', core_script)
        self.assertIn("--profile ops-proof run --rm temporal-task-queue-sampler", core_script)
        self.assertIn("--profile ops-proof run --rm worker-autoscaler", core_script)

    def test_compose_wrapper_projects_hindsight_postgres_password(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            'HINDSIGHT_POSTGRES_PASSWORD="${HINDSIGHT_POSTGRES_PASSWORD:?HINDSIGHT_POSTGRES_PASSWORD is required}"',
            core_script,
        )

    def test_hindsight_password_reconcile_feeds_psql_statement_on_stdin(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )
        command_body = core_script[
            core_script.index(
                "execution_control_staging_reconcile_hindsight_postgres_password() {"
            ) : core_script.index("execution_control_staging_personal_memory_runtime_command() {")
        ]

        self.assertIn('printf "%s\\n" "ALTER ROLE hindsight PASSWORD', command_body)
        self.assertIn(
            "psql -U hindsight -d hindsight -v ON_ERROR_STOP=1 -v password=", command_body
        )
        self.assertNotIn('-c "ALTER ROLE hindsight PASSWORD', command_body)

    def test_canonical_compose_defaults_exclude_langfuse_runtime(self) -> None:
        common_script = (STAGING_DIR / "execution-control-staging-common.sh").read_text(
            encoding="utf-8"
        )
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )
        default_lines = [
            line
            for line in common_script.splitlines()
            if line.startswith("execution_control_staging_default_compose_files=")
        ]

        self.assertGreaterEqual(len(default_lines), 1)
        for line in default_lines:
            with self.subTest(default_line=line):
                self.assertNotIn("langfuse", line)
        self.assertIn("execution_control_staging_langfuse_compose_file", common_script)
        self.assertIn("execution_control_staging_enable_langfuse_compose()", core_script)

    def test_staging_langfuse_public_route_override_is_opt_in(self) -> None:
        staging_compose = (
            ROOT / "infra/local/docker-compose.execution-control-runtime.staging.yml"
        ).read_text(encoding="utf-8")
        langfuse_staging_compose = (
            ROOT / "infra/local/docker-compose.execution-control-runtime.langfuse.staging.yml"
        ).read_text(encoding="utf-8")

        self.assertNotIn("langfuse-web:", staging_compose)
        self.assertIn("langfuse-web:", langfuse_staging_compose)
        self.assertIn("langfuse-staging.mucwiki-edge.link", langfuse_staging_compose)

    def test_compose_wrapper_projects_primary_agent_runtime_env(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )

        for required_projection in (
            "EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY",
            "EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL",
            "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET",
            "EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS",
            "AGENT_RUNTIME_SHARED_SECRET",
            "AGENT_RUNTIME_TOOL_REGISTRY_PATH",
            "AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL",
            "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET",
        ):
            with self.subTest(required_projection=required_projection):
                self.assertIn(required_projection, core_script)

    def test_env_loader_projects_agent_runtime_execution_control_query_env(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env="\n".join(
                (
                    "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent",
                    "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent",
                    "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw@staging-raw.example.com:5432/campus_agent",
                    "STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://5943f31433be5dd57beb3bb92bd1c660.r2.cloudflarestorage.com",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret",
                    "STAGING_INGESTION_OBJECT_STORE_REGION=auto",
                    "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-agent-derived-staging",
                    "STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com",
                    "STAGING_INGESTION_QDRANT_API_KEY=qdrant-key",
                    "STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key",
                    "STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
                    "QDRANT_QUERY_API_KEY=stale-query-key",
                    "STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1",
                    "STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key",
                    "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                    "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                    "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://projection@staging-db.example.com:5432/campus_agent",
                )
            ),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(
            projected["AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL"],
            "http://execution-control:8000",
        )
        self.assertEqual(projected["AGENT_RUNTIME_HOST"], "0.0.0.0")
        self.assertEqual(
            projected["AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET"],
            "query-secret",
        )
        self.assertEqual(
            projected["OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT"],
            "https://langfuse.internal/api/public/otel",
        )
        self.assertEqual(
            projected["OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER"],
            "Basic cGstbGY6c2stbGY=",
        )
        self.assertEqual(projected["OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION"], "4")
        self.assertEqual(projected["OTEL_COLLECTOR_AXIOM_EVENTS_DATASET"], "campus-agent-runtime")
        self.assertEqual(
            projected["OTEL_COLLECTOR_AXIOM_METRICS_DATASET"],
            "campus-agent-runtime-metrics",
        )
        self.assertEqual(projected["QDRANT_API_KEY"], "qdrant-key")
        self.assertEqual(projected["QDRANT_READ_ONLY_API_KEY"], "qdrant-readonly-key")
        self.assertEqual(projected["QDRANT_QUERY_API_KEY"], "qdrant-readonly-key")
        self.assertEqual(projected["QDRANT_TIMEOUT_SECONDS"], "60")
        self.assertEqual(
            projected["QDRANT_TLS_DIR"],
            "/srv/docker/campus-agent/staging/qdrant/tls",
        )
        self.assertEqual(projected["EMBEDDING_MODEL"], "Qwen3-Embedding-4B")
        self.assertEqual(projected["EMBEDDING_DIMENSIONS"], "2560")
        self.assertEqual(
            projected["EXECUTION_CONTROL_APP_API_BASE_URL"],
            "https://api-staging.mucwiki-edge.link",
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET"], "app-api-secret"
        )
        self.assertEqual(projected["EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS"], "30000")
        self.assertTrue(
            projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH"].endswith(
                "provider-config-projection.json"
            )
        )
        self.assertTrue(
            projected["CAMPUS_OBSERVABILITY_CONFIG_SNAPSHOT_HOST_PATH"].endswith(
                "observability-config-projection.json"
            )
        )
        self.assertEqual(
            projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH"],
            "/run/campus-agent/provider-config-projection.json",
        )
        self.assertEqual(
            projected["CAMPUS_OBSERVABILITY_CONFIG_SNAPSHOT_PATH"],
            "/run/campus-agent/observability-config-projection.json",
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH"],
            projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH"],
        )
        self.assertEqual(projected["EXECUTION_CONTROL_RUNTIME_PROFILE"], "staging")
        self.assertEqual(projected["EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE"], "false")
        self.assertTrue(projected["EXECUTION_CONTROL_COMPOSE_PROJECT_DIRECTORY"])
        self.assertEqual(
            projected["EXECUTION_CONTROL_COMPOSE_PROJECT_NAME"],
            "campus-execution-control-staging",
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE_SAMPLER_IDENTITY"],
            "staging:temporal-task-queue-sampler:001",
        )
        self.assertRegex(projected["APP_API_OTEL_INGEST_SHARED_SECRET"], r"^[0-9a-f]{64}$")
        self.assertEqual(
            projected["EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS"],
            f"authorization=Bearer {projected['APP_API_OTEL_INGEST_SHARED_SECRET']}",
        )
        self.assertEqual(
            projected["APP_API_OTEL_INGEST_ENDPOINT"],
            "https://otel-collector-staging.mucwiki-edge.link",
        )
        self.assertEqual(projected["HINDSIGHT_API_LLM_API_KEY"], "llm-key")
        self.assertEqual(projected["HINDSIGHT_API_LLM_BASE_URL"], "https://llm.example.com/v1")
        self.assertEqual(projected["HINDSIGHT_API_LLM_MODEL"], "gpt-test")
        self.assertEqual(projected["HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY"], "embedding-key")
        self.assertEqual(
            projected["HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL"],
            "https://ai.gitee.com/v1",
        )
        self.assertEqual(
            projected["HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL"],
            "Qwen3-Embedding-4B",
        )

    def test_env_loader_accepts_clean_debug_observability_without_axiom_or_sentry(
        self,
    ) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env="\n".join(
                (
                    "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent",
                    "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent",
                    "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw@staging-raw.example.com:5432/campus_agent",
                    "STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://5943f31433be5dd57beb3bb92bd1c660.r2.cloudflarestorage.com",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret",
                    "STAGING_INGESTION_OBJECT_STORE_REGION=auto",
                    "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-agent-derived-staging",
                    "STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com",
                    "STAGING_INGESTION_QDRANT_API_KEY=qdrant-key",
                    "STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key",
                    "STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
                    "STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1",
                    "STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key",
                    "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                    "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                    "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://projection@staging-db.example.com:5432/campus_agent",
                )
            ),
            include_observability_sink_fixture=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT"], "")
        self.assertEqual(projected["OTEL_COLLECTOR_SENTRY_AUTH_VALUE"], "")
        self.assertEqual(projected["OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT"], "")
        self.assertEqual(projected["OTEL_COLLECTOR_AXIOM_AUTH_HEADER"], "")
        self.assertEqual(projected["OTEL_COLLECTOR_AXIOM_EVENTS_DATASET"], "campus-agent-runtime")
        self.assertEqual(
            projected["OTEL_COLLECTOR_AXIOM_METRICS_DATASET"],
            "campus-agent-runtime-metrics",
        )
        self.assertEqual(
            projected["OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT"],
            "http://langfuse-web:3000/api/public/otel",
        )

    def test_env_loader_projects_internal_agent_runtime_bridge_without_manual_secret(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env="\n".join(
                (
                    "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent",
                    "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent",
                    "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw@staging-raw.example.com:5432/campus_agent",
                    "STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://5943f31433be5dd57beb3bb92bd1c660.r2.cloudflarestorage.com",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret",
                    "STAGING_INGESTION_OBJECT_STORE_REGION=auto",
                    "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-agent-derived-staging",
                    "STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com",
                    "STAGING_INGESTION_QDRANT_API_KEY=qdrant-key",
                    "STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key",
                    "STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
                    "STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1",
                    "STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key",
                    "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                    "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                    "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://projection@staging-db.example.com:5432/campus_agent",
                )
            ),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(
            projected["EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL"],
            "http://agent-runtime:27062",
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET"],
            projected["AGENT_RUNTIME_SHARED_SECRET"],
        )
        self.assertRegex(
            projected["EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET"],
            r"^[0-9a-f]{64}$",
        )

    def test_env_loader_preserves_explicit_compose_profiles(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env="\n".join(
                (
                    "EXECUTION_CONTROL_STAGING_COMPOSE_PROFILES=ui",
                    "EXECUTION_CONTROL_STAGING_COMPOSE_FILES=/runtime/base.yml:/runtime/staging.yml",
                    "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent",
                    "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent",
                    "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw@staging-raw.example.com:5432/campus_agent",
                    "STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://5943f31433be5dd57beb3bb92bd1c660.r2.cloudflarestorage.com",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret",
                    "STAGING_INGESTION_OBJECT_STORE_REGION=auto",
                    "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-agent-derived-staging",
                    "STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com",
                    "STAGING_INGESTION_QDRANT_API_KEY=qdrant-key",
                    "STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key",
                    "STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
                    "STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1",
                    "STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key",
                    "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                    "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                    "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://projection@staging-db.example.com:5432/campus_agent",
                )
            ),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(
            projected["EXECUTION_CONTROL_STAGING_COMPOSE_PROFILES"],
            "ui",
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_STAGING_COMPOSE_FILES"],
            "/runtime/base.yml:/runtime/staging.yml",
        )

    def test_env_loader_projects_internal_hindsight_memory_defaults_without_manual_secret(
        self,
    ) -> None:
        result = run_env_loader_twice_for_hindsight_defaults()

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["first"]["baseUrl"], "http://hindsight-api:8888")
        self.assertRegex(projected["first"]["apiSecret"], r"^[A-Za-z0-9_-]{32,}$")
        self.assertRegex(projected["first"]["ownerSalt"], r"^[A-Za-z0-9_-]{32,}$")
        self.assertRegex(projected["first"]["postgresPassword"], r"^[A-Za-z0-9_-]{32,}$")
        self.assertEqual(
            projected["first"]["apiDatabaseUrl"],
            (
                "postgresql://hindsight:"
                f"{projected['first']['postgresPassword']}@hindsight-postgres:5432/hindsight"
            ),
        )
        self.assertEqual(
            projected["first"]["apiTenantApiKey"],
            projected["first"]["apiSecret"],
        )
        self.assertEqual(projected["first"], projected["second"])

    def test_env_loader_projects_self_hosted_runtime_defaults_without_manual_internal_env(
        self,
    ) -> None:
        result = run_env_loader_twice_for_self_hosted_runtime_defaults()

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        first = projected["first"]
        self.assertEqual(first["qdrantUrl"], "http://qdrant:6333")
        self.assertEqual(first["qdrantQueryKey"], first["qdrantReadOnlyKey"])
        self.assertEqual(first["temporalAddress"], "temporal:7233")
        self.assertEqual(
            first["runProjectionUrl"],
            "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
        )
        for key in (
            "qdrantAdminKey",
            "qdrantReadOnlyKey",
            "temporalPostgresPassword",
            "internalQuerySecret",
            "metricsToken",
        ):
            with self.subTest(key=key):
                self.assertRegex(first[key], r"^[A-Za-z0-9_-]{32,}$")
        self.assertEqual(projected["first"], projected["second"])

    def test_compose_running_gate_includes_primary_agent_runtime_services(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )
        command_body = core_script[
            core_script.index(
                "execution_control_staging_compose_project_running() {"
            ) : core_script.index("execution_control_staging_compose_langfuse_running() {")
        ]

        for required_service in (
            '"agent-runtime"',
            '"activity-worker-core"',
            '"activity-worker-agent"',
            '"activity-worker-knowledge"',
        ):
            with self.subTest(required_service=required_service):
                self.assertIn(required_service, command_body)
        for closed_surface_service in (
            '"activity-worker-campus-services"',
            '"activity-worker-notice"',
            '"activity-worker-navigation"',
        ):
            with self.subTest(closed_surface_service=closed_surface_service):
                self.assertNotIn(closed_surface_service, command_body)

    def test_start_status_and_preflight_enforce_clean_pinned_checkout(self) -> None:
        for relative_path in (
            "start-execution-control-staging.sh",
            "status-execution-control-staging.sh",
            "preflight-execution-control-staging.sh",
        ):
            with self.subTest(script=relative_path):
                script = (STAGING_DIR / relative_path).read_text(encoding="utf-8")
                self.assertIn("execution_control_staging_require_deploy_checkout_clean", script)

    def test_start_reconciles_images_even_when_compose_project_is_running(self) -> None:
        script = (STAGING_DIR / "start-execution-control-staging.sh").read_text(encoding="utf-8")

        self.assertIn("reconciling images and containers", script)
        self.assertIn("execution_control_staging_compose up -d --build --remove-orphans", script)
        self.assertNotIn("runtime already running", script)

    def test_start_requires_explicit_flags_for_optional_runtime_surfaces(self) -> None:
        script = (STAGING_DIR / "start-execution-control-staging.sh").read_text(encoding="utf-8")

        self.assertIn("--with-langfuse", script)
        self.assertIn("execution_control_staging_enable_langfuse_compose", script)
        self.assertIn("--with-ui", script)
        self.assertIn('"ui"', script)
        self.assertNotIn("--with-structured-capabilities", script)
        self.assertNotIn('"structured-tools"', script)

    def test_status_requires_explicit_langfuse_check(self) -> None:
        script = (STAGING_DIR / "status-execution-control-staging.sh").read_text(encoding="utf-8")

        self.assertIn("--require-langfuse", script)
        self.assertIn("execution_control_staging_enable_langfuse_compose", script)
        self.assertIn("execution_control_staging_compose_langfuse_running", script)

    def test_langfuse_stop_script_preserves_volumes(self) -> None:
        script = (STAGING_DIR / "stop-execution-control-langfuse.sh").read_text(encoding="utf-8")
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )
        command_body = core_script[
            core_script.index(
                "execution_control_staging_stop_langfuse_compose() {"
            ) : core_script.index("execution_control_staging_run_projection_schema_command() {")
        ]

        self.assertIn("execution_control_staging_stop_langfuse_compose", script)
        self.assertIn("execution_control_staging_compose stop", command_body)
        self.assertIn("execution_control_staging_compose rm -f", command_body)
        self.assertNotIn(" -v", command_body)

    def test_start_checks_personal_memory_after_compose_up(self) -> None:
        script = (STAGING_DIR / "start-execution-control-staging.sh").read_text(encoding="utf-8")

        self.assertLess(
            script.index("execution_control_staging_compose up -d --build --remove-orphans"),
            script.index("execution_control_staging_ensure_personal_memory_runtime"),
        )

    def test_start_reconciles_hindsight_password_before_personal_memory_check(self) -> None:
        script = (STAGING_DIR / "start-execution-control-staging.sh").read_text(encoding="utf-8")

        self.assertLess(
            script.index("execution_control_staging_compose up -d hindsight-postgres"),
            script.index("execution_control_staging_reconcile_hindsight_postgres_password"),
        )
        self.assertLess(
            script.index("execution_control_staging_reconcile_hindsight_postgres_password"),
            script.index("execution_control_staging_compose up -d --build --remove-orphans"),
        )
        self.assertLess(
            script.index("execution_control_staging_compose up -d --build --remove-orphans"),
            script.index("execution_control_staging_ensure_personal_memory_runtime"),
        )

    def test_status_check_uses_provider_config_gate(self) -> None:
        script = (STAGING_DIR / "status-execution-control-staging.sh").read_text(encoding="utf-8")

        self.assertIn("provider_config_gate.configured", script)
        self.assertNotIn("prompt_config_gate", script)

    def test_closeout_capture_pins_status_check_to_current_checkout_head(self) -> None:
        script = (STAGING_DIR / "capture-temporal-rag-closeout-evidence.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            'capture_git_sha="$(git -C "${execution_control_staging_repo_root}" rev-parse HEAD)"',
            script,
        )
        self.assertIn(
            'export EXECUTION_CONTROL_STAGING_EXPECTED_SHA="${EXECUTION_CONTROL_STAGING_EXPECTED_SHA:-${capture_git_sha}}"',
            script,
        )
        self.assertLess(
            script.index("export EXECUTION_CONTROL_STAGING_EXPECTED_SHA="),
            script.index('"${script_dir}/status-execution-control-staging.sh" --check'),
        )

    def test_execution_control_staging_data_plane_does_not_manage_minio(self) -> None:
        script = (STAGING_DIR / "execution-control-staging-data-plane.sh").read_text(
            encoding="utf-8"
        )

        self.assertNotIn("execution_control_staging_minio_compose", script)
        self.assertNotIn("execution_control_staging_ensure_local_minio_bucket", script)
        self.assertNotIn("campus_ingestion_core.object_store_admin", script)

    def test_personal_memory_probe_receives_runtime_release(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )
        command_body = core_script[
            core_script.index(
                "execution_control_staging_personal_memory_runtime_command() {"
            ) : core_script.index("execution_control_staging_ensure_personal_memory_runtime() {")
        ]

        self.assertIn(
            '-e EXECUTION_CONTROL_RUNTIME_RELEASE="${EXECUTION_CONTROL_RUNTIME_RELEASE:?',
            command_body,
        )

    def test_run_projection_schema_uses_data_plane_network(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )
        command_body = core_script[
            core_script.index(
                "execution_control_staging_run_projection_schema_command() {"
            ) : core_script.index(
                "execution_control_staging_ensure_run_projection_store_schema() {"
            )
        ]

        self.assertIn(
            '--network "${execution_control_staging_data_plane_network}"',
            command_body,
        )

    def test_personal_memory_probe_uses_runtime_internal_network(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )
        command_body = core_script[
            core_script.index(
                "execution_control_staging_personal_memory_runtime_command() {"
            ) : core_script.index("execution_control_staging_ensure_personal_memory_runtime() {")
        ]

        self.assertIn(
            '--network "${EXECUTION_CONTROL_RUNTIME_INTERNAL_NETWORK:-campus-execution-control-runtime}"',
            command_body,
        )

    def test_checkout_guard_rejects_dirty_tracked_file(self) -> None:
        result = run_checkout_guard(
            mutate="""
            printf 'dirty\\n' >> tracked.txt
            """,
            expected_sha="HEAD",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Deploy checkout has tracked modifications", result.stderr)

    def test_checkout_guard_rejects_unexpected_untracked_file(self) -> None:
        result = run_checkout_guard(
            mutate="""
            printf 'artifact\\n' > unexpected.txt
            """,
            expected_sha="HEAD",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Deploy checkout has unexpected untracked files", result.stderr)

    def test_checkout_guard_rejects_ignored_python_virtualenv_artifact(self) -> None:
        result = run_checkout_guard(
            mutate="""
            printf '.venv/\\n' >> .git/info/exclude
            mkdir .venv
            """,
            expected_sha="HEAD",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Deploy checkout contains repo-local runtime artifact", result.stderr)
        self.assertIn(".venv", result.stderr)

    def test_checkout_guard_rejects_repo_local_runtime_secret_files(self) -> None:
        result = run_checkout_guard(
            mutate="""
            printf 'secret\\n' > .env.staging.local
            """,
            expected_sha="HEAD",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Deploy checkout contains repo-local runtime secret file", result.stderr)

    def test_checkout_guard_rejects_wrong_pinned_sha(self) -> None:
        result = run_checkout_guard(
            mutate="", expected_sha="0000000000000000000000000000000000000000"
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "Deploy checkout HEAD does not match EXECUTION_CONTROL_STAGING_EXPECTED_SHA",
            result.stderr,
        )

    def test_checkout_guard_requires_pinned_sha(self) -> None:
        result = run_checkout_guard(mutate="", expected_sha=None)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("EXECUTION_CONTROL_STAGING_EXPECTED_SHA is required", result.stderr)

    def test_uv_runtime_wrapper_uses_runtime_dir_for_project_environment_and_cache(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("execution_control_staging_uv_run", core_script)
        self.assertIn("UV_PROJECT_ENVIRONMENT=", core_script)
        self.assertIn("UV_CACHE_DIR=", core_script)
        self.assertIn("${execution_control_staging_runtime_dir}/uv", core_script)

    def test_staging_lifecycle_does_not_call_uv_run_without_runtime_wrapper(self) -> None:
        for source_path in STAGING_DIR.glob("execution-control-staging-*.sh"):
            with self.subTest(script=source_path.name):
                script = source_path.read_text(encoding="utf-8")
                if source_path.name == "execution-control-staging-core.sh":
                    wrapper_body = script.split("execution_control_staging_uv_run()", 1)[1]
                    script = script.replace(wrapper_body, "")
                self.assertNotIn('"${uv_bin}" run', script)
                self.assertNotIn("uv run --all-packages", script)


if __name__ == "__main__":
    unittest.main()
