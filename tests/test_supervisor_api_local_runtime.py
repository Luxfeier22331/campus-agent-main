import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SupervisorApiLocalRuntimeTest(unittest.TestCase):
    def test_local_runtime_start_script_loads_repo_env_and_rewrites_container_dsns(self) -> None:
        script_path = ROOT / "infra/local/start-supervisor-runtime.sh"
        self.assertTrue(script_path.exists())

        script = script_path.read_text(encoding="utf-8")

        self.assertIn("${repo_root}/.env", script)
        self.assertIn("process.loadEnvFile", script)
        self.assertIn("DOCUMENT_REGISTRY_DATABASE_URL", script)
        self.assertIn("CAMPUS_SHARED_POSTGRES_URL", script)
        self.assertIn("SUPERVISOR_API_EXECUTION_AUDIT_URL", script)
        self.assertIn("projectLocalServiceDns", script)
        self.assertIn("postgres", script)
        self.assertIn("minio", script)
        self.assertIn("qdrant", script)
        self.assertNotIn("host.docker.internal", script)
        self.assertIn("read -r -d '' env_key", script)
        self.assertIn('"SUPERVISOR_AGENT_WORKER_BASE_URL"', script)
        self.assertIn('"http://supervisor-agent-worker:27052"', script)
        self.assertNotIn("eval ", script)
        self.assertIn("SUPERVISOR_RUNTIME_COMPOSE_PARALLEL_LIMIT", script)
        self.assertIn('COMPOSE_PARALLEL_LIMIT="${compose_parallel_limit}"', script)
        self.assertIn("ensure_data_plane_network", script)
        self.assertLess(
            script.index("ensure_data_plane_network"), script.index('"${docker_bin}" compose')
        )
        self.assertIn('"${docker_bin}" compose', script)
        self.assertIn("docker-compose.supervisor-runtime.yml", script)

    def test_supervisor_api_docker_build_uses_configurable_go_module_proxy(self) -> None:
        dockerfile_path = ROOT / "apps/supervisor-api/Dockerfile"
        compose_path = ROOT / "infra/local/docker-compose.supervisor-runtime.yml"
        script_path = ROOT / "infra/local/start-supervisor-runtime.sh"

        dockerfile = dockerfile_path.read_text(encoding="utf-8")
        compose = compose_path.read_text(encoding="utf-8")
        script = script_path.read_text(encoding="utf-8")

        self.assertIn("ARG GOPROXY=https://proxy.golang.org,direct", dockerfile)
        self.assertIn("ARG GOSUMDB=sum.golang.org", dockerfile)
        self.assertIn("ENV GOPROXY=${GOPROXY}", dockerfile)
        self.assertIn("GOSUMDB=${GOSUMDB}", dockerfile)
        self.assertIn("apt-get install -y --no-install-recommends ca-certificates curl", dockerfile)
        self.assertIn("COPY apps/supervisor-api/go.mod apps/supervisor-api/go.sum ./", dockerfile)
        self.assertIn("RUN go mod download", dockerfile)
        self.assertLess(
            dockerfile.index("RUN go mod download"),
            dockerfile.index("COPY apps/supervisor-api ./"),
        )
        self.assertIn(
            "COPY configs/runtime/intent-policy.v1.json /src/configs/runtime/intent-policy.v1.json",
            dockerfile,
        )
        self.assertIn(
            "COPY configs/runtime/agents.v2.json /src/configs/runtime/agents.v2.json",
            dockerfile,
        )
        self.assertIn(
            "COPY configs/runtime/tools.v2.json /src/configs/runtime/tools.v2.json",
            dockerfile,
        )
        self.assertIn(
            "COPY configs/runtime/intent-policy.v1.json /etc/campus-agent/intent-policy.v1.json",
            dockerfile,
        )
        self.assertIn(
            "COPY configs/runtime/agents.v2.json /etc/campus-agent/agents.v2.json",
            dockerfile,
        )
        self.assertIn(
            "COPY tests/fixtures/service_guide_vpn_grouped_procedure_result.json "
            "/src/tests/fixtures/service_guide_vpn_grouped_procedure_result.json",
            dockerfile,
        )
        self.assertIn(
            "SUPERVISOR_API_INTENT_POLICY_PATH=/etc/campus-agent/intent-policy.v1.json",
            dockerfile,
        )
        self.assertIn(
            "SUPERVISOR_API_AGENT_SPEC_PATH=/etc/campus-agent/agents.v2.json",
            dockerfile,
        )

        self.assertIn("SUPERVISOR_API_DOCKER_GOPROXY", compose)
        self.assertIn("https://goproxy.cn,direct", compose)
        self.assertIn("SUPERVISOR_API_DOCKER_GOSUMDB", compose)
        self.assertNotIn("GOSUMDB=off", compose)
        self.assertIn("healthcheck:", compose)
        self.assertIn("condition: service_healthy", compose)
        self.assertIn("restart: unless-stopped", compose)
        self.assertIn("no-new-privileges:true", compose)
        self.assertIn('max-size: "10m"', compose)
        self.assertIn("x-supervisor-bridge-auth", compose)
        self.assertIn("campus-agent-data-plane", compose)
        self.assertIn("external: true", compose)

        self.assertIn('"SUPERVISOR_API_DOCKER_GOPROXY"', script)
        self.assertIn('"SUPERVISOR_API_DOCKER_GOSUMDB"', script)
        self.assertNotIn("GOSUMDB=off", script)

    def test_local_runtime_compose_includes_otel_collector_service_and_runtime_wiring(self) -> None:
        compose_path = ROOT / "infra/local/docker-compose.supervisor-runtime.yml"
        compose = compose_path.read_text(encoding="utf-8")

        self.assertIn("otel-collector:", compose)
        self.assertIn("otel/opentelemetry-collector-contrib", compose)
        self.assertIn("collector-staging-template.yaml", compose)
        self.assertIn("OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT", compose)
        self.assertIn("OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT", compose)
        self.assertIn("OTEL_COLLECTOR_AXIOM_EVENTS_DATASET", compose)
        self.assertIn("OTEL_COLLECTOR_AXIOM_METRICS_DATASET", compose)
        self.assertIn(
            "SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318/v1/traces",
            compose,
        )
        self.assertIn(
            "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: http://otel-collector:4318/v1/traces",
            compose,
        )
        self.assertIn(
            "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: http://otel-collector:4318/v1/metrics",
            compose,
        )
        self.assertIn(
            "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: http://otel-collector:4318/v1/logs",
            compose,
        )

    def test_local_runtime_wires_structured_query_from_go_api_to_core_worker(self) -> None:
        compose_path = ROOT / "infra/local/docker-compose.supervisor-runtime.yml"
        script_path = ROOT / "infra/local/start-supervisor-runtime.sh"

        compose = compose_path.read_text(encoding="utf-8")
        script = script_path.read_text(encoding="utf-8")

        self.assertIn("SUPERVISOR_INTERNAL_QUERY_BASE_URL: http://supervisor-api:8000", compose)
        self.assertIn("SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET", compose)
        self.assertIn("CAMPUS_SHARED_POSTGRES_URL", compose)
        service_status_url_key = "SERVICE_STATUS" + "_READ_MODEL_DATABASE_URL"
        transport_url_key = "TRANSPORT_SCHEDULE" + "_READ_MODEL_DATABASE_URL"
        service_guide_url_key = "SERVICE_GUIDE" + "_READ_MODEL_DATABASE_URL"
        service_status_table_key = "SERVICE_STATUS" + "_READ_MODEL_TABLE"
        transport_schema_key = "TRANSPORT_SCHEDULE" + "_READ_MODEL_SCHEMA"
        service_guide_table_key = "SERVICE_GUIDE" + "_READ_MODEL_TABLE"
        structured_schema_key = "STRUCTURED_PROJECTION" + "_SCHEMA"
        self.assertNotIn(service_status_url_key, compose)
        self.assertNotIn(transport_url_key, compose)
        self.assertNotIn(service_guide_url_key, compose)
        self.assertNotIn(service_status_table_key, compose)
        self.assertNotIn(transport_schema_key, compose)
        self.assertNotIn(service_guide_table_key, compose)
        self.assertNotIn(structured_schema_key, compose)
        self.assertIn("INTERNAL_NOTICE_READ_MODEL_DATABASE_URL", compose)
        self.assertIn("OBJECT_STORE_ENDPOINT", compose)
        self.assertIn('"SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET"', script)
        self.assertIn(
            '"supervisor-internal-query-local-placeholder"',
            script,
        )
        self.assertNotIn(f'"{service_status_url_key}"', script)
        self.assertNotIn(f'"{transport_url_key}"', script)
        self.assertNotIn(f'"{service_guide_url_key}"', script)
        self.assertNotIn(f'"{service_status_table_key}"', script)
        self.assertNotIn(f'"{transport_schema_key}"', script)
        self.assertNotIn(f'"{service_guide_table_key}"', script)
        self.assertNotIn(f'"{structured_schema_key}"', script)
        self.assertIn('"OBJECT_STORE_ENDPOINT"', script)

    def test_local_runtime_passes_prompt_gate_inputs_to_worker_and_go_api(self) -> None:
        compose_path = ROOT / "infra/local/docker-compose.supervisor-runtime.yml"
        script_path = ROOT / "infra/local/smoke-supervisor-runtime.sh"

        compose = compose_path.read_text(encoding="utf-8")
        script = script_path.read_text(encoding="utf-8")

        for key in (
            "PROMPT_RUNTIME_PROVIDER:",
            "PROMPT_RUNTIME_TRANSPORT:",
            "PROMPT_RUNTIME_MODEL:",
            "SUPERVISOR_PROMPT_MODEL:",
            "AGENT_PROMPT_MODEL:",
            "PROMPT_RUNTIME_API_KEY:",
            "PROMPT_RUNTIME_BASE_URL:",
            "PROMPT_STRICT_STRUCTURED_OUTPUTS:",
        ):
            with self.subTest(key=key):
                self.assertEqual(compose.count(f"      {key}"), 2)
        self.assertIn('PROMPT_RUNTIME_PROVIDER="${PROMPT_RUNTIME_PROVIDER:-mock-runtime}"', script)
        self.assertIn(
            'SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET="${SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET:-supervisor-internal-query-local-placeholder}"',
            script,
        )

    def test_supervisor_agent_worker_docker_installs_agent_workspace_dependencies(self) -> None:
        dockerfile_path = ROOT / "apps/supervisor-agent-worker/Dockerfile"
        dockerfile = dockerfile_path.read_text(encoding="utf-8")

        self.assertIn("uv sync --project /app --all-packages --no-dev", dockerfile)
        self.assertNotIn("--package campus-supervisor-agent-worker --no-dev", dockerfile)

    def test_supervisor_agent_worker_docker_workspace_excludes_retired_calendar_agent(self) -> None:
        dockerfile_path = ROOT / "apps/supervisor-agent-worker/Dockerfile"
        dockerfile = dockerfile_path.read_text(encoding="utf-8")

        self.assertNotIn("COPY packages/calendar-agent ./packages/calendar-agent", dockerfile)
        self.assertNotIn('"packages/calendar-agent"', dockerfile)
        self.assertNotIn("/app/packages/calendar-agent/src", dockerfile)

    def test_supervisor_agent_worker_docker_workspace_includes_runtime_specs(self) -> None:
        dockerfile_path = ROOT / "apps/supervisor-agent-worker/Dockerfile"
        dockerfile = dockerfile_path.read_text(encoding="utf-8")

        self.assertIn("COPY configs/runtime ./configs/runtime", dockerfile)

    def test_local_runtime_smoke_script_exercises_mock_runtime_readiness_and_terminal_gate(
        self,
    ) -> None:
        script_path = ROOT / "infra/local/smoke-supervisor-runtime.sh"
        self.assertTrue(script_path.exists())

        script = script_path.read_text(encoding="utf-8")

        self.assertIn("start-supervisor-runtime.sh", script)
        self.assertIn("AGENT_RUNTIME_PROVIDER", script)
        self.assertIn("mock-runtime", script)
        self.assertIn("PROMPT_RUNTIME_MODEL", script)
        self.assertIn("PROMPT_RUNTIME_API_KEY", script)
        self.assertIn("/healthz", script)
        self.assertIn("/readyz", script)
        self.assertIn("/metrics", script)
        self.assertIn("/api/v1/answer", script)
        self.assertIn("x-worker-origin-auth", script)
        self.assertIn('"context"', script)
        self.assertIn('"principal_type":"student"', script)
        self.assertIn('"policy_projection_version":"phase1-authorization-projection-v1"', script)
        self.assertIn("structured_runtime_closed", script)
        self.assertIn("SUPERVISOR_RUNTIME_SMOKE_SKIP_START", script)
        self.assertIn("SUPERVISOR_RUNTIME_SMOKE_KEEP_RUNNING", script)
        self.assertIn("SUPERVISOR_RUNTIME_SMOKE_ARTIFACT_DIR", script)
        self.assertIn(".tmp/supervisor-api-local-smoke", script)
        self.assertIn("summary.json", script)
        self.assertIn("campus_supervisor_runtime_smoke.v1", script)
        self.assertIn("artifacts: ${artifact_dir}", script)
        self.assertIn('started_compose="true"\n    "${start_script}" up -d --build', script)
        self.assertIn("closed_gate", script)
        self.assertIn("bridge_semantic", script)
        self.assertIn("open_structured", script)
        self.assertIn("readyz_degraded", script)
        self.assertIn("SUPERVISOR_API_OPEN_CAPABILITIES=campus_services", script)
        self.assertIn("campus-ingestion-smoke-structured-projection-postgres", script)
        self.assertIn("docker compose", script)


if __name__ == "__main__":
    unittest.main()
