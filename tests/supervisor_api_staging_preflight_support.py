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
    "SUPERVISOR_API_STAGING_LOCAL_POSTGRES_DB",
    "SUPERVISOR_API_STAGING_LOCAL_POSTGRES_USER",
    "SUPERVISOR_API_STAGING_LOCAL_POSTGRES_PORT",
    "SUPERVISOR_API_STAGING_LOCAL_MINIO_ACCESS_KEY",
    "SUPERVISOR_API_STAGING_UV_BIN",
    "SUPERVISOR_API_OTEL_ENABLED",
    "SUPERVISOR_API_OTEL_METRICS_ENABLED",
    "SUPERVISOR_AGENT_WORKER_OTEL_ENABLED",
    "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET",
    "SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS",
    "SUPERVISOR_API_STAGING_REQUIRES_LOCAL_POSTGRES",
    "SUPERVISOR_API_STAGING_REQUIRES_LOCAL_MINIO",
    "SUPERVISOR_API_STAGING_REQUIRES_LOCAL_QDRANT",
]

_PROJECTED_LOCAL_RUNTIME_KEYS = [
    "CAMPUS_SHARED_POSTGRES_URL",
    "DOCUMENT_REGISTRY_DATABASE_URL",
    "OBJECT_STORE_ENDPOINT",
    "QDRANT_URL",
]


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
            app_api_dev_vars
            if app_api_dev_vars is not None
            else "\n".join(
                (
                    "SUPERVISOR_API_SHARED_SECRET=worker-secret",
                    "APP_API_INTERNAL_SHARED_SECRET=app-internal-secret",
                    "SUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:27052",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        fake_uv_bin = temp_root / "fake-uv"
        fake_uv_bin.write_text(_fake_uv_script(), encoding="utf-8")
        fake_uv_bin.chmod(0o755)
        command = f"""
        set -euo pipefail
        export SUPERVISOR_API_STAGING_UV_BIN={shlex.quote(str(fake_uv_bin))}
        source {shlex.quote(str(common_path))}
        supervisor_api_staging_load_env
        supervisor_api_staging_require_runtime_env
        supervisor_api_staging_require_data_plane_ready
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
                "SUPERVISOR_API_STAGING_TEST_REGISTRY_AUDIT_PAYLOAD": registry_audit_payload,
                "SUPERVISOR_API_STAGING_TEST_RAG_RUNTIME_PAYLOAD": rag_runtime_payload,
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )


def run_local_runtime_script_with_env(*, repo_env: str) -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        script_path = temp_root / "infra" / "local" / "start-supervisor-runtime.sh"
        script_path.parent.mkdir(parents=True)
        script_path.write_text(
            (ROOT / "infra/local/start-supervisor-runtime.sh").read_text(encoding="utf-8"),
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
    )
