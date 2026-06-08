from __future__ import annotations

import json
import os
import shlex
import subprocess
import textwrap
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]

_PROJECTED_STAGING_KEYS = [
    "CAMPUS_SHARED_POSTGRES_URL",
    "DOCUMENT_REGISTRY_DATABASE_URL",
    "RAW_ASSET_REGISTRY_DATABASE_URL",
    "CAMPUS_SHARED_POSTGRES_OPERATOR_URL",
    "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
    "RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
    "CAMPUS_SHARED_POSTGRES_DOCKER_URL",
    "DOCUMENT_REGISTRY_DOCKER_DATABASE_URL",
    "RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL",
    "OBJECT_STORE_ENDPOINT",
    "OBJECT_STORE_DOCKER_ENDPOINT",
    "OBJECT_STORE_DERIVED_ACCESS_KEY",
    "OBJECT_STORE_BUCKET_DERIVED",
    "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT",
    "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY",
    "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY",
    "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION",
    "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET",
    "QDRANT_URL",
    "QDRANT_DOCKER_URL",
    "QDRANT_TIMEOUT_SECONDS",
    "EMBEDDING_PROVIDER",
    "EMBEDDING_BASE_URL",
    "EMBEDDING_API_KEY",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIMENSIONS",
    "SPARSE_PROVIDER",
    "SPARSE_MODEL",
    "SPARSE_TOKENIZER",
    "SPARSE_LANGUAGE",
    "API_WORKER_SHARED_SECRET",
    "EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_DB",
    "EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_USER",
    "EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PORT",
    "EXECUTION_CONTROL_STAGING_LOCAL_MINIO_ACCESS_KEY",
    "EXECUTION_CONTROL_STAGING_UV_BIN",
    "EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME",
    "EXECUTION_CONTROL_STAGING_RUNTIME_DIR",
    "EXECUTION_CONTROL_STAGING_HOST",
    "EXECUTION_CONTROL_STAGING_PORT",
    "EXECUTION_CONTROL_OTEL_ENABLED",
    "EXECUTION_CONTROL_OTEL_METRICS_ENABLED",
    "SUPERVISOR_AGENT_WORKER_OTEL_ENABLED",
    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
    "EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL",
    "EXECUTION_CONTROL_PROVIDER_PRICING_PATH",
    "EXECUTION_CONTROL_TEMPORAL_ADDRESS",
    "EXECUTION_CONTROL_TEMPORAL_NAMESPACE",
    "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE",
    "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_RAG_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",
    "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS",
    "AXIOM_ENDPOINT",
    "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT",
    "OTEL_COLLECTOR_SENTRY_AUTH_VALUE",
    "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
    "OTEL_COLLECTOR_AXIOM_AUTH_HEADER",
    "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET",
    "EXECUTION_CONTROL_STAGING_DATA_PLANE_ERRORS",
    "EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_POSTGRES",
    "EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_MINIO",
    "EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_QDRANT",
]

_PROJECTED_LOCAL_RUNTIME_KEYS = [
    "CAMPUS_SHARED_POSTGRES_URL",
    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
    "DOCUMENT_REGISTRY_DATABASE_URL",
    "OBJECT_STORE_ENDPOINT",
    "QDRANT_URL",
    "TEMPORAL_POSTGRES_PASSWORD",
    "EXECUTION_CONTROL_TEMPORAL_ADDRESS",
    "EXECUTION_CONTROL_TEMPORAL_NAMESPACE",
    "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_RAG_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",
]

_VALID_OBSERVABILITY_SINK_ENV = {
    "AXIOM_ENDPOINT": "https://us-east-1.aws.edge.axiom.co",
    "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT": (
        "https://o4511127794155520.ingest.us.sentry.io/api/4511351503454208/integration/otlp"
    ),
    "OTEL_COLLECTOR_SENTRY_AUTH_VALUE": ("sentry sentry_key=03ac022c1d762aa1882d3fdbc27915f9"),
    "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT": "https://us-east-1.aws.edge.axiom.co",
    "OTEL_COLLECTOR_AXIOM_AUTH_HEADER": "Bearer axiom-ingest-token",
    "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET": "campus-agent-runtime",
}

_VALID_TEMPORAL_ENV = {
    "TEMPORAL_POSTGRES_PASSWORD": "temporal-postgres-password",
    "EXECUTION_CONTROL_TEMPORAL_ADDRESS": "temporal:7233",
    "EXECUTION_CONTROL_TEMPORAL_NAMESPACE": "campus-agent-staging",
    "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE": "campus-agent.workflow",
    "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY": "staging:execution-control:001",
    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY": "staging:workflow-worker:001",
    "EXECUTION_CONTROL_TEMPORAL_RAG_WORKER_IDENTITY": "staging:activity-rag:001",
    "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY": "staging:activity-finalization:001",
    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT": "workflow-salt",
    "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS": "5000",
}


def run_common_script_with_env(
    *,
    repo_env: str,
    staging_env: str,
    registry_audit_payload: str = "clean",
    rag_runtime_payload: str = "ready",
    app_api_dev_vars: str | None = None,
) -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        staging_dir = temp_root / "infra" / "local" / "staging"
        staging_dir.mkdir(parents=True)
        for source_path in (ROOT / "infra/local/staging").glob("execution-control-staging-*.sh"):
            (staging_dir / source_path.name).write_text(
                source_path.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
        common_path = staging_dir / "execution-control-staging-common.sh"
        if repo_env:
            (temp_root / ".env").write_text(repo_env + "\n", encoding="utf-8")
        runtime_env_path = temp_root / "ops" / "staging" / "runtime.env"
        runtime_env_path.parent.mkdir(parents=True)
        runtime_env_path.write_text(
            _with_valid_staging_fixture_env(staging_env) + "\n",
            encoding="utf-8",
        )
        app_api_dir = temp_root / "apps" / "app-api"
        app_api_dir.mkdir(parents=True)
        if app_api_dev_vars is not None:
            (app_api_dir / ".dev.vars").write_text(app_api_dev_vars + "\n", encoding="utf-8")
        fake_uv_bin = temp_root / "fake-uv"
        fake_uv_bin.write_text(_fake_uv_script(), encoding="utf-8")
        fake_uv_bin.chmod(0o755)
        command = f"""
        set -euo pipefail
        export EXECUTION_CONTROL_STAGING_UV_BIN={shlex.quote(str(fake_uv_bin))}
        export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env_path))}
        source {shlex.quote(str(common_path))}
        execution_control_staging_load_env
        execution_control_staging_require_runtime_env
        execution_control_staging_require_data_plane_ready
        node - <<'NODE'
        const keys = {json.dumps(_PROJECTED_STAGING_KEYS)};
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
                "EXECUTION_CONTROL_STAGING_TEST_REGISTRY_AUDIT_PAYLOAD": registry_audit_payload,
                "EXECUTION_CONTROL_STAGING_TEST_RAG_RUNTIME_PAYLOAD": rag_runtime_payload,
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )


def _with_valid_observability_sink_env(staging_env: str) -> str:
    present_keys = {
        line.split("=", 1)[0].strip()
        for line in staging_env.splitlines()
        if line.strip() and not line.lstrip().startswith("#") and "=" in line
    }
    missing_fixture_lines = [
        f"{key}={value}"
        for key, value in _VALID_OBSERVABILITY_SINK_ENV.items()
        if key not in present_keys
    ]
    return "\n".join([*missing_fixture_lines, staging_env]).strip()


def _with_valid_staging_fixture_env(staging_env: str) -> str:
    present_keys = {
        line.split("=", 1)[0].strip()
        for line in staging_env.splitlines()
        if line.strip() and not line.lstrip().startswith("#") and "=" in line
    }
    missing_fixture_lines = [
        f"{key}={value}" for key, value in _VALID_TEMPORAL_ENV.items() if key not in present_keys
    ]
    return _with_valid_observability_sink_env(
        "\n".join([*missing_fixture_lines, staging_env]).strip()
    )


def run_local_runtime_script_with_env(*, repo_env: str) -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        script_path = temp_root / "infra" / "local" / "start-execution-control-runtime.sh"
        script_path.parent.mkdir(parents=True)
        script_path.write_text(
            (ROOT / "infra/local/start-execution-control-runtime.sh").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        (temp_root / ".env").write_text(repo_env + "\n", encoding="utf-8")
        command = f"""
        set -euo pipefail
        source {shlex.quote(str(script_path))} __campus_agent_print_projected_env
        load_runtime_env
        node - <<'NODE'
        const keys = {json.dumps(_PROJECTED_LOCAL_RUNTIME_KEYS)};
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
            env=os.environ.copy(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )


def _fake_uv_script() -> str:
    return textwrap.dedent(
        """\
        #!/usr/bin/env bash
        set -euo pipefail
        joined_args="$*"
        if [[ "${joined_args}" == *"collection_rename_registry_backfill"* ]]; then
          if [[ "${EXECUTION_CONTROL_STAGING_TEST_REGISTRY_AUDIT_PAYLOAD:-clean}" == "legacy" ]]; then
          cat <<'JSON'
        {"command":"audit","targets":[{"kind":"document_registry","legacy_row_count":2,"sample_rows":[{"identity":"doc-001|track|v1","column_collection":"student_handbook","record_collection":"student_handbook"}],"table_name":"ingestion_registry.document_registry_records","target_names":["runtime_document_registry"],"updated_row_count":null}]}
        JSON
          else
          cat <<'JSON'
        {"command":"audit","targets":[{"kind":"document_registry","legacy_row_count":0,"sample_rows":[],"table_name":"ingestion_registry.document_registry_records","target_names":["runtime_document_registry"],"updated_row_count":null},{"kind":"raw_asset_registry","legacy_row_count":0,"sample_rows":[],"table_name":"ingestion_registry.raw_asset_registry_records","target_names":["runtime_raw_asset_registry"],"updated_row_count":null}]}
        JSON
          fi
        elif [[ "${joined_args}" == *"probe_regulation_rag_release_runtime"* ]]; then
          if [[ "${EXECUTION_CONTROL_STAGING_TEST_RAG_RUNTIME_PAYLOAD:-ready}" == "blocked" ]]; then
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
    )
