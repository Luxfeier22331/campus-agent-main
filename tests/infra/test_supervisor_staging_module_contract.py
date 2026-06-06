from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGING_DIR = ROOT / "infra/local/staging"


class SupervisorStagingModuleContractTest(unittest.TestCase):
    def test_common_file_is_a_module_index(self) -> None:
        common_script = (STAGING_DIR / "execution-control-staging-common.sh").read_text(
            encoding="utf-8"
        )

        for module_name in (
            "execution-control-staging-core.sh",
            "execution-control-staging-env.sh",
            "execution-control-staging-data-plane.sh",
            "execution-control-staging-observability.sh",
        ):
            self.assertIn(
                f'source "${{execution_control_staging_script_dir}}/{module_name}"', common_script
            )
        self.assertIn("execution_control_staging_runtime_globals_declared", common_script)
        self.assertNotIn(
            "campus_ingestion_worker.probe_regulation_rag_release_runtime", common_script
        )
        self.assertNotIn("S3ObjectStoreAdmin(settings).ensure_bucket", common_script)

    def test_env_module_loads_staging_observability_and_secret_contract(self) -> None:
        env_script = (STAGING_DIR / "execution-control-staging-env.sh").read_text(encoding="utf-8")
        env_example = (ROOT / ".env.staging.local.example").read_text(encoding="utf-8")
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )
        compose = (ROOT / "infra/local/docker-compose.execution-control-runtime.yml").read_text(
            encoding="utf-8"
        )
        worker_dockerfile = (ROOT / "apps/supervisor-agent-worker/Dockerfile").read_text(
            encoding="utf-8"
        )
        dockerignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")

        self.assertIn('"OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT"', env_script)
        self.assertIn('"OTEL_COLLECTOR_SENTRY_AUTH_VALUE"', env_script)
        self.assertIn('"OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT"', env_script)
        self.assertIn('"OTEL_COLLECTOR_AXIOM_AUTH_HEADER"', env_script)
        self.assertIn('"OTEL_COLLECTOR_AXIOM_EVENTS_DATASET"', env_script)
        self.assertNotIn('"OTEL_COLLECTOR_AXIOM_METRICS_DATASET"', env_script)
        self.assertIn('"EXECUTION_CONTROL_OTEL_ENABLED"', env_script)
        self.assertIn('"SUPERVISOR_AGENT_WORKER_OTEL_ENABLED"', env_script)
        self.assertIn(".env.staging.local", env_script)
        self.assertIn('"EXECUTION_CONTROL_STAGING_TUNNEL_TOKEN"', env_script)
        self.assertIn("remote-managed execution-control-staging tunnel", env_script)
        self.assertIn("execution_control_staging_require_runtime_env_core", env_script)
        self.assertIn("execution_control_staging_require_status_env", env_script)
        self.assertIn("execution_control_staging_require_tunnel_token", env_script)
        self.assertIn("execution_control_staging_require_observability_sink_env", env_script)
        self.assertIn("execution_control_staging_require_local_temporal_proof_env", env_script)
        self.assertIn(
            "execution_control_staging_require_isolated_temporal_proof_runtime", env_script
        )
        self.assertIn("EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME", env_script)
        self.assertIn("EXECUTION_CONTROL_STAGING_PORT", env_script)
        self.assertIn("EXECUTION_CONTROL_STAGING_RUNTIME_DIR", env_script)
        self.assertIn("SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET is required", env_script)
        self.assertIn('sourceEnvValue("API_WORKER_SHARED_SECRET") ||', env_script)
        self.assertIn('sourceEnvValue("EXECUTION_CONTROL_SHARED_SECRET") ||', env_script)
        for temporal_key in (
            "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
            "EXECUTION_CONTROL_TEMPORAL_ADDRESS",
            "EXECUTION_CONTROL_TEMPORAL_NAMESPACE",
            "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE",
            "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",
            "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY",
            "EXECUTION_CONTROL_TEMPORAL_RAG_WORKER_IDENTITY",
            "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY",
            "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",
            "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS",
        ):
            self.assertIn(f'"{temporal_key}"', env_script)
            self.assertIn(f"{temporal_key}=", env_example)
            self.assertIn(f"{temporal_key}:", compose)
        for retired_key in (
            "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED",
            "EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED",
        ):
            self.assertIn(f'{retired_key}",', env_script)
            self.assertIn("is retired; use Temporal execution-control settings", env_script)
            self.assertNotIn(f"{retired_key}=", env_example)
            self.assertNotIn(f"{retired_key}:", compose)
        self.assertIn("EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL", env_script)
        self.assertIn(
            "EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL is required",
            core_script,
        )
        self.assertIn(
            'EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL="${EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL',
            core_script,
        )
        self.assertNotIn(
            "SUPERVISOR_AGENT_WORKER_SHARED_SECRET:-${EXECUTION_CONTROL_SHARED_SECRET:-}",
            env_script,
        )
        self.assertIn("COPY packages/prompt-runtime ./packages/prompt-runtime", worker_dockerfile)
        self.assertIn(
            "COPY packages/regulation-semantics ./packages/regulation-semantics",
            worker_dockerfile,
        )
        self.assertIn('"packages/prompt-runtime"', worker_dockerfile)
        self.assertIn('"packages/regulation-semantics"', worker_dockerfile)
        self.assertIn("/app/packages/prompt-runtime/src", worker_dockerfile)
        self.assertIn("/app/packages/regulation-semantics/src", worker_dockerfile)
        self.assertIn("!packages/prompt-runtime/", dockerignore)
        self.assertIn("!packages/prompt-runtime/**", dockerignore)
        self.assertIn("!packages/regulation-semantics/", dockerignore)
        self.assertIn("!packages/regulation-semantics/**", dockerignore)

    def test_local_temporal_proof_script_does_not_replace_public_staging_gate(self) -> None:
        proof_script = (
            STAGING_DIR / "proof-execution-control-temporal-runtime-staging.sh"
        ).read_text(encoding="utf-8")

        self.assertIn("execution_control_staging_require_local_temporal_proof_env", proof_script)
        self.assertIn(
            "execution_control_staging_require_isolated_temporal_proof_runtime", proof_script
        )
        self.assertIn("execution_control_staging_require_data_plane_ready", proof_script)
        self.assertIn("execution_control_staging_require_container_qdrant_ready", proof_script)
        self.assertIn("local readyz payload is not run_projection_store ready", proof_script)
        self.assertIn("local readyz payload is not temporal_runtime ready", proof_script)
        self.assertNotIn("temporal_runtime.workers.started", proof_script)
        self.assertIn("local temporal proof: ok", proof_script)
        self.assertNotIn("execution_control_staging_app_api_readyz_url", proof_script)
        self.assertNotIn("cloudflared", proof_script)

    def test_core_module_owns_process_compose_and_uv_helpers(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("execution_control_staging_resolve_uv_bin", core_script)
        self.assertIn("EXECUTION_CONTROL_STAGING_UV_BIN", core_script)
        self.assertIn(".local/bin/uv", core_script)
        self.assertIn("Operation not permitted", core_script)
        self.assertIn('[[ "${services}" == *"otel-collector"* ]]', core_script)
        self.assertIn('[[ "${services}" == *"workflow-worker"* ]]', core_script)
        self.assertIn('[[ "${services}" == *"activity-worker-rag"* ]]', core_script)
        self.assertIn('[[ "${services}" == *"activity-worker-finalization"* ]]', core_script)
        self.assertIn("execution_control_staging_probe_http_url", core_script)
        self.assertIn("execution_control_staging_probe_json_path_equals", core_script)

    def test_data_plane_module_owns_local_dependencies_and_rag_readiness(self) -> None:
        data_plane_script = (STAGING_DIR / "execution-control-staging-data-plane.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "execution_control_staging_require_registry_collection_rename_closed", data_plane_script
        )
        self.assertIn(
            "campus_ingestion_worker.collection_rename_registry_backfill", data_plane_script
        )
        self.assertIn("student_handbook -> student_rules", data_plane_script)
        self.assertIn("execution_control_staging_require_rag_runtime_ready", data_plane_script)
        self.assertIn(
            "campus_ingestion_worker.probe_regulation_rag_release_runtime", data_plane_script
        )
        self.assertIn("--scope regulations/student_rules", data_plane_script)
        self.assertIn("--scope regulations/institutional_rules", data_plane_script)
        self.assertIn("--scope curriculum/curriculum_plan", data_plane_script)
        self.assertIn("qdrant_ready", data_plane_script)
        self.assertIn("execution_control_staging_ensure_data_plane_network", data_plane_script)
        self.assertIn(
            "execution_control_staging_ensure_self_hosted_data_plane_dependencies",
            data_plane_script,
        )
        common_script = (STAGING_DIR / "execution-control-staging-common.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn("docker-compose.postgres.yml", common_script)
        self.assertIn("docker-compose.minio.yml", common_script)
        self.assertIn("docker-compose.qdrant-single-node.yml", common_script)
        self.assertIn("execution_control_staging_ensure_local_minio_volume", data_plane_script)
        self.assertIn("volume create local_minio-data", data_plane_script)
        self.assertIn("execution_control_staging_postgres_compose", data_plane_script)
        self.assertIn("execution_control_staging_minio_compose", data_plane_script)
        self.assertIn("execution_control_staging_qdrant_compose", data_plane_script)
        self.assertIn("execution_control_staging_ensure_local_minio_bucket", data_plane_script)
        self.assertIn("S3ObjectStoreAdmin(settings).ensure_bucket", data_plane_script)
        self.assertIn("/minio/health/ready", data_plane_script)
        self.assertIn("LOCAL_POSTGRES_USER", data_plane_script)
        self.assertIn("EXECUTION_CONTROL_STAGING_LOCAL_MINIO_ACCESS_KEY", data_plane_script)
        self.assertIn("QDRANT_READ_ONLY_API_KEY", data_plane_script)
        self.assertIn(
            'base+"/readyz", headers={"api-key": os.environ.get("QDRANT_API_KEY", "")}',
            data_plane_script,
        )
        self.assertIn(
            "execution_control_staging_requires_local_postgres_dependency", data_plane_script
        )
        self.assertIn(
            "execution_control_staging_requires_local_minio_dependency", data_plane_script
        )
        self.assertIn(
            "execution_control_staging_requires_local_qdrant_dependency", data_plane_script
        )
        self.assertIn("execution_control_staging_require_container_qdrant_ready", data_plane_script)
        self.assertIn("bm25_canary_", data_plane_script)
        self.assertIn('model="qdrant/bm25"', data_plane_script)
        self.assertIn("Qdrant server-side BM25 inference is not available", data_plane_script)
        self.assertIn("collection_created = False", data_plane_script)
        self.assertIn("collection_created = True", data_plane_script)
        self.assertIn("if collection_created:", data_plane_script)
        self.assertNotIn("host.docker.internal", data_plane_script)
        self.assertNotIn("rewriteLocalhostForDocker", data_plane_script)

    def test_observability_module_and_lifecycle_scripts_capture_collector_logs(self) -> None:
        observability_script = (
            STAGING_DIR / "execution-control-staging-observability.sh"
        ).read_text(encoding="utf-8")
        start_script = (STAGING_DIR / "start-execution-control-staging.sh").read_text(
            encoding="utf-8"
        )
        status_script = (STAGING_DIR / "status-execution-control-staging.sh").read_text(
            encoding="utf-8"
        )
        common_script = (STAGING_DIR / "execution-control-staging-common.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "execution_control_staging_validate_axiom_collector_endpoint", observability_script
        )
        self.assertIn("must be the Axiom OTLP base domain", observability_script)
        self.assertIn("must match AXIOM_ENDPOINT", observability_script)
        self.assertIn("logs --no-color otel-collector", observability_script)
        self.assertIn("logs --no-color --since 5m otel-collector", observability_script)
        self.assertIn("execution_control_staging_otel_collector_recent_log_file", common_script)
        self.assertIn(
            "execution_control_staging_otel_collector_recent_log_file", observability_script
        )
        self.assertIn(
            "otel-collector recent log contains permanent exporter failures", status_script
        )
        self.assertIn("execution_control_staging_probe_json_path_equals", status_script)
        self.assertNotIn("temporal_runtime.workers.started", status_script)
        self.assertIn("local readyz payload is not run_projection_store ready", status_script)
        self.assertIn("local readyz payload is not temporal_runtime ready", status_script)
        self.assertIn("app-api readyz payload is not executionRuntime=ready", status_script)
        self.assertIn("execution_control_staging_require_status_env", status_script)
        self.assertNotIn("execution_control_staging_require_runtime_env", status_script)
        self.assertIn("strict_mode == 1", status_script)
        self.assertIn('echo "  ${execution_control_staging_otel_collector_log_file}"', start_script)
        self.assertIn(
            'echo "  ${execution_control_staging_otel_collector_log_file}"', status_script
        )
        self.assertIn("TUNNEL_TOKEN=", start_script)
        self.assertNotIn("--config", start_script)
        self.assertNotIn("execution-control-staging-placeholder", start_script)
        self.assertNotIn("execution-control-staging-placeholder", status_script)


if __name__ == "__main__":
    unittest.main()
