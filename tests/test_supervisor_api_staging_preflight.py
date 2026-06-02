import json
import textwrap
import unittest
from pathlib import Path

from tests.supervisor_api_staging_preflight_support import (
    run_common_script_with_env,
    run_local_runtime_script_with_env,
)

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
            ("infra/local/docker-compose.postgres.yml", "postgres"),
            ("infra/local/docker-compose.minio.yml", "minio"),
        ):
            compose = (ROOT / relative_path).read_text(encoding="utf-8")
            with self.subTest(compose=relative_path):
                self.assertIn("campus-agent-data-plane", compose)
                self.assertIn("external: true", compose)
                self.assertIn(f"- {alias}", compose)

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
        self.assertIn(
            "supervisor_api_staging_require_registry_collection_rename_closed", common_script
        )
        self.assertIn("campus_ingestion_worker.collection_rename_registry_backfill", common_script)
        self.assertIn("student_handbook -> student_rules", common_script)
        self.assertIn("supervisor_api_staging_require_rag_runtime_ready", common_script)
        self.assertIn("campus_ingestion_worker.probe_regulation_rag_release_runtime", common_script)
        self.assertIn("--scope regulations/student_rules", common_script)
        self.assertIn("--scope regulations/institutional_rules", common_script)
        self.assertIn("--scope curriculum/curriculum_plan", common_script)
        self.assertIn("qdrant_ready", common_script)
        self.assertIn("supervisor_api_staging_ensure_data_plane_network", common_script)
        self.assertIn(
            "supervisor_api_staging_ensure_self_hosted_data_plane_dependencies", common_script
        )
        self.assertIn("docker-compose.postgres.yml", common_script)
        self.assertIn("docker-compose.minio.yml", common_script)
        self.assertIn("docker-compose.qdrant-single-node.yml", common_script)
        self.assertIn("supervisor_api_staging_ensure_local_minio_volume", common_script)
        self.assertIn("volume create local_minio-data", common_script)
        self.assertIn("supervisor_api_staging_postgres_compose", common_script)
        self.assertIn("supervisor_api_staging_minio_compose", common_script)
        self.assertIn("supervisor_api_staging_qdrant_compose", common_script)
        self.assertIn("supervisor_api_staging_ensure_local_minio_bucket", common_script)
        self.assertIn("S3ObjectStoreAdmin(settings).ensure_bucket", common_script)
        self.assertIn("/minio/health/ready", common_script)
        self.assertIn("LOCAL_POSTGRES_USER", common_script)
        self.assertIn("SUPERVISOR_API_STAGING_LOCAL_MINIO_ACCESS_KEY", common_script)
        self.assertIn("QDRANT_READ_ONLY_API_KEY", common_script)
        self.assertIn(
            'base+"/readyz", headers={"api-key": os.environ.get("QDRANT_API_KEY", "")}',
            common_script,
        )
        self.assertIn("supervisor_api_staging_requires_local_postgres_dependency", common_script)
        self.assertIn("supervisor_api_staging_requires_local_minio_dependency", common_script)
        self.assertIn("supervisor_api_staging_requires_local_qdrant_dependency", common_script)
        self.assertIn("supervisor_api_staging_require_container_qdrant_ready", common_script)
        self.assertNotIn("host.docker.internal", common_script)
        self.assertNotIn("rewriteLocalhostForDocker", common_script)
        self.assertIn(".env.staging.local", common_script)
        self.assertIn('"SUPERVISOR_API_STAGING_TUNNEL_TOKEN"', common_script)
        self.assertIn("remote-managed supervisor-api-staging tunnel", common_script)
        self.assertIn("SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET is required", common_script)
        self.assertIn("supervisor_api_staging_resolve_uv_bin", common_script)
        self.assertIn("SUPERVISOR_API_STAGING_UV_BIN", common_script)
        self.assertIn('"SUPERVISOR_API_STAGING_UV_BIN"', common_script)
        self.assertIn(".local/bin/uv", common_script)
        self.assertIn("Operation not permitted", common_script)
        self.assertIn("process.env.API_WORKER_SHARED_SECRET?.trim() ||", common_script)
        self.assertIn("process.env.SUPERVISOR_API_SHARED_SECRET?.trim() ||", common_script)
        self.assertNotIn(
            "SUPERVISOR_AGENT_WORKER_SHARED_SECRET:-${SUPERVISOR_API_SHARED_SECRET:-}",
            common_script,
        )
        self.assertIn("otel-collector log contains permanent exporter failures", status_script)
        self.assertIn("supervisor_api_staging_require_runtime_env", status_script)
        self.assertIn("strict_mode == 1", status_script)
        self.assertIn("logs --no-color otel-collector", common_script)
        self.assertIn('echo "  ${supervisor_api_staging_otel_collector_log_file}"', start_script)
        self.assertIn('echo "  ${supervisor_api_staging_otel_collector_log_file}"', status_script)
        self.assertIn('[[ "${services}" == *"otel-collector"* ]]', common_script)
        self.assertIn("TUNNEL_TOKEN=", start_script)
        self.assertNotIn("--config", start_script)
        self.assertNotIn("supervisor-api-staging-placeholder", start_script)
        self.assertNotIn("supervisor-api-staging-placeholder", status_script)

    def test_staging_runtime_projects_explicit_data_plane_env_over_repo_local_env(self) -> None:
        result = run_common_script_with_env(
            repo_env=textwrap.dedent(
                """
                CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
                DOCUMENT_REGISTRY_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_agent
                OBJECT_STORE_ENDPOINT=http://localhost:9000
                QDRANT_URL=https://root-qdrant.example.com
                EMBEDDING_PROVIDER=mock
                EMBEDDING_MODEL=root-model
                SPARSE_PROVIDER=mock
                """
            ).strip(),
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw-registry@staging-raw-registry.example.com:5432/campus_agent
                STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL=postgresql://operator@staging-db.example.com:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL=postgresql://registry-operator@staging-registry.example.com:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL=postgresql://raw-registry-operator@staging-raw-registry.example.com:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS=11
                STAGING_INGESTION_EMBEDDING_PROVIDER=mock
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=mock
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_API_STAGING_UV_BIN=/opt/campus/bin/uv
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(
            projected["CAMPUS_SHARED_POSTGRES_URL"],
            "postgresql://runtime@staging-db.example.com:5432/campus_agent",
        )
        self.assertEqual(
            projected["DOCUMENT_REGISTRY_DATABASE_URL"],
            "postgresql://registry@staging-registry.example.com:5432/campus_agent",
        )
        self.assertEqual(
            projected["RAW_ASSET_REGISTRY_DATABASE_URL"],
            "postgresql://raw-registry@staging-raw-registry.example.com:5432/campus_agent",
        )
        self.assertEqual(
            projected["CAMPUS_SHARED_POSTGRES_OPERATOR_URL"],
            "postgresql://operator@staging-db.example.com:5432/campus_agent",
        )
        self.assertEqual(
            projected["DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL"],
            "postgresql://registry-operator@staging-registry.example.com:5432/campus_agent",
        )
        self.assertEqual(
            projected["RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL"],
            "postgresql://raw-registry-operator@staging-raw-registry.example.com:5432/campus_agent",
        )
        self.assertEqual(projected["OBJECT_STORE_ENDPOINT"], "https://s3.staging.example.com")
        self.assertEqual(projected["OBJECT_STORE_DERIVED_ACCESS_KEY"], "derived-access")
        self.assertEqual(projected["OBJECT_STORE_BUCKET_DERIVED"], "campus-rag-derived-staging")
        self.assertEqual(projected["QDRANT_URL"], "https://qdrant.staging.example.com")
        self.assertEqual(projected["QDRANT_TIMEOUT_SECONDS"], "11")
        self.assertEqual(projected["EMBEDDING_MODEL"], "Qwen3-Embedding-4B")
        self.assertEqual(projected["SPARSE_PROVIDER"], "mock")
        self.assertEqual(projected["API_WORKER_SHARED_SECRET"], "worker-secret")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS"], "")

    def test_staging_runtime_projects_same_host_self_hosted_data_plane_to_service_dns(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://runtime:secret@localhost:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://localhost:9000
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS=11
                STAGING_INGESTION_EMBEDDING_PROVIDER=mock
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=mock
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(
            projected["CAMPUS_SHARED_POSTGRES_URL"],
            "postgresql://runtime:secret@127.0.0.1:5432/campus_agent",
        )
        self.assertEqual(
            projected["DOCUMENT_REGISTRY_DATABASE_URL"],
            "postgresql://runtime:secret@localhost:5432/campus_agent",
        )
        self.assertEqual(
            projected["RAW_ASSET_REGISTRY_DATABASE_URL"],
            "postgresql://runtime:secret@127.0.0.1:5432/campus_agent",
        )
        self.assertEqual(
            projected["CAMPUS_SHARED_POSTGRES_DOCKER_URL"],
            "postgresql://runtime:secret@postgres:5432/campus_agent",
        )
        self.assertEqual(
            projected["DOCUMENT_REGISTRY_DOCKER_DATABASE_URL"],
            "postgresql://runtime:secret@postgres:5432/campus_agent",
        )
        self.assertEqual(
            projected["RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL"],
            "postgresql://runtime:secret@postgres:5432/campus_agent",
        )
        self.assertEqual(projected["OBJECT_STORE_ENDPOINT"], "http://localhost:9000")
        self.assertEqual(projected["OBJECT_STORE_DOCKER_ENDPOINT"], "http://minio:9000")
        self.assertEqual(projected["QDRANT_URL"], "http://127.0.0.1:6333")
        self.assertEqual(projected["QDRANT_DOCKER_URL"], "http://qdrant:6333")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_LOCAL_POSTGRES_DB"], "campus_agent")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_LOCAL_POSTGRES_USER"], "runtime")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_LOCAL_POSTGRES_PORT"], "5432")
        self.assertEqual(
            projected["SUPERVISOR_API_STAGING_LOCAL_MINIO_ACCESS_KEY"],
            "derived-access",
        )
        self.assertEqual(projected["SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS"], "")

    def test_staging_self_hosted_dependency_detection_uses_host_side_endpoints(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://runtime:secret@localhost:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://localhost:9000
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS=11
                STAGING_INGESTION_EMBEDDING_PROVIDER=mock
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=mock
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_POSTGRES"], "true")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_MINIO"], "true")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_QDRANT"], "true")

    def test_staging_local_postgres_dependency_rejects_mixed_single_node_credentials(
        self,
    ) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry:secret@localhost:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://localhost:9000
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_EMBEDDING_PROVIDER=mock
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=mock
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("repo-owned local Postgres uses one database/user/password", result.stderr)

    def test_staging_local_minio_dependency_rejects_split_credentials(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://runtime:secret@localhost:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://localhost:9000
                STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY=shared-access
                STAGING_INGESTION_OBJECT_STORE_SECRET_KEY=shared-secret
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_EMBEDDING_PROVIDER=mock
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=mock
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("repo-owned local MinIO uses one credential pair", result.stderr)

    def test_staging_local_qdrant_dependency_requires_read_only_key(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://runtime:secret@localhost:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://localhost:9000
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_EMBEDDING_PROVIDER=mock
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=mock
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY is required", result.stderr)

    def test_staging_external_dependency_detection_does_not_force_local_compose(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw-registry@staging-raw-registry.example.com:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS=11
                STAGING_INGESTION_EMBEDDING_PROVIDER=mock
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=mock
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_POSTGRES"], "false")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_MINIO"], "false")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_QDRANT"], "false")

    def test_staging_runtime_rejects_missing_worker_shared_secret(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            app_api_dev_vars="APP_API_INTERNAL_SHARED_SECRET=app-internal-secret\nSUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:27052\n",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw-registry@staging-raw-registry.example.com:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_EMBEDDING_PROVIDER=mock
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=mock
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("API_WORKER_SHARED_SECRET is required", result.stderr)

    def test_staging_runtime_rejects_repo_local_data_plane_without_explicit_staging_env(
        self,
    ) -> None:
        result = run_common_script_with_env(
            repo_env=textwrap.dedent(
                """
                CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
                DOCUMENT_REGISTRY_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_agent
                OBJECT_STORE_ENDPOINT=http://localhost:9000
                QDRANT_URL=https://root-qdrant.example.com
                """
            ).strip(),
            staging_env=textwrap.dedent(
                """
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("supervisor-api staging data-plane env is invalid", result.stderr)
        self.assertIn("STAGING_INGESTION_SHARED_POSTGRES_URL is required", result.stderr)
        self.assertIn(
            "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL is required",
            result.stderr,
        )
        self.assertIn(
            "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL is required",
            result.stderr,
        )
        self.assertIn("STAGING_INGESTION_OBJECT_STORE_ENDPOINT is required", result.stderr)
        self.assertIn(
            "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED is required",
            result.stderr,
        )
        self.assertIn("STAGING_INGESTION_QDRANT_URL is required", result.stderr)

    def test_staging_runtime_rejects_supabase_pooler_without_sslmode_require(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://postgres.project:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://postgres.project:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://postgres.project:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com
                STAGING_INGESTION_EMBEDDING_PROVIDER=mock
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=mock
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("supervisor-api staging data-plane env is invalid", result.stderr)
        self.assertIn(
            "STAGING_INGESTION_SHARED_POSTGRES_URL must include sslmode=require",
            result.stderr,
        )
        self.assertIn(
            "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL must include sslmode=require",
            result.stderr,
        )
        self.assertIn(
            "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL must include sslmode=require",
            result.stderr,
        )

    def test_staging_runtime_rejects_legacy_registry_collection_names(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw-registry@staging-raw-registry.example.com:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com
                STAGING_INGESTION_EMBEDDING_PROVIDER=mock
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=mock
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
            registry_audit_payload="legacy",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "supervisor-api staging registry collection rename is incomplete", result.stderr
        )
        self.assertIn("student_handbook -> student_rules", result.stderr)
        self.assertIn("legacy rows remain", result.stderr)

    def test_staging_runtime_rejects_not_ready_rag_runtime(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw-registry@staging-raw-registry.example.com:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com
                STAGING_INGESTION_EMBEDDING_PROVIDER=mock
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=mock
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
            rag_runtime_payload="blocked",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("supervisor-api staging RAG runtime is not ready", result.stderr)
        self.assertIn("qdrant_ready=not_ready", result.stderr)
        self.assertIn("regulations/student_rules: qdrant_endpoint_not_ready", result.stderr)

    def test_local_supervisor_runtime_projects_loopback_data_plane_to_service_dns(self) -> None:
        result = run_local_runtime_script_with_env(
            repo_env=textwrap.dedent(
                """
                CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
                DOCUMENT_REGISTRY_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_agent
                OBJECT_STORE_ENDPOINT=http://localhost:9000
                QDRANT_URL=http://127.0.0.1:6333
                EMBEDDING_PROVIDER=mock
                EMBEDDING_MODEL=Qwen3-Embedding-4B
                SPARSE_PROVIDER=mock
                """
            ).strip()
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(
            projected["CAMPUS_SHARED_POSTGRES_URL"],
            "postgresql://postgres:postgres@postgres:5432/campus_agent",
        )
        self.assertEqual(
            projected["DOCUMENT_REGISTRY_DATABASE_URL"],
            "postgresql://postgres:postgres@postgres:5432/campus_agent",
        )
        self.assertEqual(projected["OBJECT_STORE_ENDPOINT"], "http://minio:9000")
        self.assertEqual(projected["QDRANT_URL"], "http://qdrant:6333")


if __name__ == "__main__":
    unittest.main()
