import json
import os
import shlex
import subprocess
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

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
        self.assertIn(".env.staging.local", common_script)
        self.assertIn('"SUPERVISOR_API_STAGING_TUNNEL_TOKEN"', common_script)
        self.assertIn("remote-managed supervisor-api-staging tunnel", common_script)
        self.assertIn("SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET is required", common_script)
        self.assertIn("supervisor_api_staging_resolve_uv_bin", common_script)
        self.assertIn("SUPERVISOR_API_STAGING_UV_BIN", common_script)
        self.assertIn('"SUPERVISOR_API_STAGING_UV_BIN"', common_script)
        self.assertIn(".local/bin/uv", common_script)
        self.assertIn("Operation not permitted", common_script)
        self.assertNotIn("process.env.SUPERVISOR_API_SHARED_SECRET?.trim() ||", common_script)
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
        result = _run_common_script_with_env(
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
        self.assertEqual(projected["SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS"], "")

    def test_staging_runtime_allows_same_host_self_hosted_qdrant(self) -> None:
        result = _run_common_script_with_env(
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
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
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
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["QDRANT_URL"], "http://127.0.0.1:6333")
        self.assertEqual(projected["QDRANT_DOCKER_URL"], "http://host.docker.internal:6333/")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS"], "")

    def test_staging_runtime_rejects_repo_local_data_plane_without_explicit_staging_env(
        self,
    ) -> None:
        result = _run_common_script_with_env(
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
        result = _run_common_script_with_env(
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
        result = _run_common_script_with_env(
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
        result = _run_common_script_with_env(
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
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
            rag_runtime_payload="blocked",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("supervisor-api staging RAG runtime is not ready", result.stderr)
        self.assertIn("qdrant_ready=not_ready", result.stderr)
        self.assertIn("regulations/student_rules: qdrant_endpoint_not_ready", result.stderr)


def _run_common_script_with_env(
    *,
    repo_env: str,
    staging_env: str,
    registry_audit_payload: str = "clean",
    rag_runtime_payload: str = "ready",
) -> subprocess.CompletedProcess:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        common_path = temp_root / "infra" / "local" / "staging" / "supervisor-api-staging-common.sh"
        common_path.parent.mkdir(parents=True)
        common_path.write_text(
            (ROOT / "infra/local/staging/supervisor-api-staging-common.sh").read_text(
                encoding="utf-8"
            ),
            encoding="utf-8",
        )
        (temp_root / ".env").write_text(repo_env + "\n", encoding="utf-8")
        (temp_root / ".env.staging.local").write_text(staging_env + "\n", encoding="utf-8")
        app_api_dir = temp_root / "apps" / "app-api"
        app_api_dir.mkdir(parents=True)
        (app_api_dir / ".dev.vars").write_text(
            "\n".join(
                (
                    "SUPERVISOR_API_SHARED_SECRET=worker-secret",
                    "APP_API_INTERNAL_SHARED_SECRET=app-internal-secret",
                    "SUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:27052",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        keys = [
            "CAMPUS_SHARED_POSTGRES_URL",
            "DOCUMENT_REGISTRY_DATABASE_URL",
            "RAW_ASSET_REGISTRY_DATABASE_URL",
            "CAMPUS_SHARED_POSTGRES_OPERATOR_URL",
            "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
            "RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
            "OBJECT_STORE_ENDPOINT",
            "OBJECT_STORE_DERIVED_ACCESS_KEY",
            "OBJECT_STORE_BUCKET_DERIVED",
            "QDRANT_URL",
            "QDRANT_DOCKER_URL",
            "QDRANT_TIMEOUT_SECONDS",
            "EMBEDDING_MODEL",
            "SPARSE_PROVIDER",
            "SUPERVISOR_API_STAGING_UV_BIN",
            "SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS",
        ]
        fake_uv_bin = temp_root / "fake-uv"
        fake_uv_bin.write_text(
            textwrap.dedent(
                """\
                #!/usr/bin/env bash
                set -euo pipefail
                joined_args="$*"
                if [[ "${joined_args}" == *"collection_rename_registry_backfill"* ]]; then
                  if [[ "${SUPERVISOR_API_STAGING_TEST_REGISTRY_AUDIT_PAYLOAD:-clean}" == "legacy" ]]; then
                  cat <<'JSON'
                {"command":"audit","targets":[{"kind":"document_registry","legacy_row_count":2,"sample_rows":[{"identity":"doc-001|track|v1","column_collection":"student_handbook","record_collection":"student_handbook"}],"table_name":"ingestion_registry.document_registry_records","target_names":["runtime_document_registry"],"updated_row_count":null}]}
                JSON
                  else
                  cat <<'JSON'
                {"command":"audit","targets":[{"kind":"document_registry","legacy_row_count":0,"sample_rows":[],"table_name":"ingestion_registry.document_registry_records","target_names":["runtime_document_registry"],"updated_row_count":null},{"kind":"raw_asset_registry","legacy_row_count":0,"sample_rows":[],"table_name":"ingestion_registry.raw_asset_registry_records","target_names":["runtime_raw_asset_registry"],"updated_row_count":null}]}
                JSON
                  fi
                elif [[ "${joined_args}" == *"probe_regulation_rag_release_runtime"* ]]; then
                  if [[ "${SUPERVISOR_API_STAGING_TEST_RAG_RUNTIME_PAYLOAD:-ready}" == "blocked" ]]; then
                    cat <<'JSON'
                {"schema_version":"rag_retrieval_runtime_readiness.v1","qdrant_ready":"not_ready","qdrant_checks":{"/readyz":{"status":404,"body_prefix":"404 page not found\\n"},"/livez":{"status":404,"body_prefix":"404 page not found\\n"},"/collections":{"status":404,"body_prefix":"404 page not found\\n"}},"surfaces":[{"scope":"regulations/student_rules","readiness_status":"blocked","readiness_blocker":"qdrant_endpoint_not_ready","alias_name":"student_rules","alias_target":null,"release_freshness_status":"unavailable","release_metadata_guard_status":"not_checked","alias_target_guard_status":"not_checked"}]}
                JSON
                  else
                    cat <<'JSON'
                {"schema_version":"rag_retrieval_runtime_readiness.v1","qdrant_ready":"ready","qdrant_checks":{"/readyz":{"status":200},"/livez":{"status":200},"/collections":{"status":200}},"surfaces":[{"scope":"regulations/student_rules","readiness_status":"ready","readiness_blocker":"","alias_name":"student_rules","alias_target":"student_rules__r1","release_freshness_status":"current","release_metadata_guard_status":"passed","alias_target_guard_status":"passed"},{"scope":"regulations/institutional_rules","readiness_status":"ready","readiness_blocker":"","alias_name":"institutional_rules","alias_target":"institutional_rules__r1","release_freshness_status":"current","release_metadata_guard_status":"passed","alias_target_guard_status":"passed"},{"scope":"curriculum/curriculum_plan","readiness_status":"ready","readiness_blocker":"","alias_name":"curriculum_plan","alias_target":"curriculum_plan__r1","release_freshness_status":"current","release_metadata_guard_status":"passed","alias_target_guard_status":"passed"}]}
                JSON
                  fi
                else
                  echo "unexpected fake uv invocation: ${joined_args}" >&2
                  exit 2
                fi
                """
            ),
            encoding="utf-8",
        )
        fake_uv_bin.chmod(0o755)
        command = f"""
        set -euo pipefail
        export SUPERVISOR_API_STAGING_UV_BIN={shlex.quote(str(fake_uv_bin))}
        source {shlex.quote(str(common_path))}
        supervisor_api_staging_load_env
        supervisor_api_staging_require_runtime_env
        node - <<'NODE'
        const keys = {json.dumps(keys)};
        const projected = {{}};
        for (const key of keys) {{
          projected[key] = process.env[key] || "";
        }}
        console.log(JSON.stringify(projected));
        NODE
        """
        return subprocess.run(
            ["bash", "-lc", textwrap.dedent(command)],
            cwd=temp_root,
            env={
                **os.environ,
                "SUPERVISOR_API_STAGING_TEST_REGISTRY_AUDIT_PAYLOAD": registry_audit_payload,
                "SUPERVISOR_API_STAGING_TEST_RAG_RUNTIME_PAYLOAD": rag_runtime_payload,
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
