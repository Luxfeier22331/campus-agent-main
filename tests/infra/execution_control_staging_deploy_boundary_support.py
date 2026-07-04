from __future__ import annotations

import os
import shlex
import subprocess
import textwrap
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.execution_control_staging_preflight_support import (
    ProviderConfigStubServer,
    copy_staging_modules_for_tests,
    write_observability_config_projection_for_tests,
    write_provider_config_projection_for_tests,
)


def run_env_loader_without_runtime_env() -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        common_path = copy_staging_modules_for_tests(root)
        command = f"""
        set -euo pipefail
        source {common_path}
        execution_control_staging_load_env
        """
        return subprocess.run(
            ["bash", "-lc", textwrap.dedent(command)],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )


def run_env_loader_twice_for_hindsight_defaults() -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        common_path = copy_staging_modules_for_tests(root)
        runtime_env = root / "ops" / "runtime.env"
        projection_path = root / "ops" / "provider-config-projection.json"
        observability_projection_path = root / "ops" / "observability-config-projection.json"
        write_provider_config_projection_for_tests(projection_path)
        write_observability_config_projection_for_tests(observability_projection_path)
        runtime_env.parent.mkdir(exist_ok=True)
        runtime_env.write_text(
            "\n".join(
                (
                    "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                    f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH={projection_path}",
                    f"CAMPUS_OBSERVABILITY_CONFIG_SNAPSHOT_PATH={observability_projection_path}",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        command = f"""
        set -euo pipefail
        export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env))}
        export EXECUTION_CONTROL_STAGING_RUNTIME_DIR={shlex.quote(str(root / ".tmp" / "execution-control-staging"))}
        export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=test-sha
        source {shlex.quote(str(common_path))}
        execution_control_staging_load_env
        export first_base_url="${{PERSONAL_MEMORY_BASE_URL}}"
        export first_api_secret="${{PERSONAL_MEMORY_API_SECRET}}"
        export first_owner_salt="${{PERSONAL_MEMORY_OWNER_SALT}}"
        export first_postgres_password="${{HINDSIGHT_POSTGRES_PASSWORD}}"
        execution_control_staging_load_env
        node - <<'NODE'
        console.log(JSON.stringify({{
          first: {{
            baseUrl: process.env.first_base_url,
            apiSecret: process.env.first_api_secret,
            ownerSalt: process.env.first_owner_salt,
            postgresPassword: process.env.first_postgres_password,
          }},
          second: {{
            baseUrl: process.env.PERSONAL_MEMORY_BASE_URL,
            apiSecret: process.env.PERSONAL_MEMORY_API_SECRET,
            ownerSalt: process.env.PERSONAL_MEMORY_OWNER_SALT,
            postgresPassword: process.env.HINDSIGHT_POSTGRES_PASSWORD,
          }},
        }}));
        NODE
        """
        return subprocess.run(
            ["bash", "-lc", textwrap.dedent(command)],
            cwd=root,
            env=os.environ.copy(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )


def run_env_loader_twice_for_self_hosted_runtime_defaults() -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        common_path = copy_staging_modules_for_tests(root)
        runtime_env = root / "ops" / "runtime.env"
        projection_path = root / "ops" / "provider-config-projection.json"
        observability_projection_path = root / "ops" / "observability-config-projection.json"
        write_provider_config_projection_for_tests(projection_path)
        write_observability_config_projection_for_tests(observability_projection_path)
        runtime_env.parent.mkdir(exist_ok=True)
        server = ProviderConfigStubServer()
        server.start()
        try:
            runtime_env.write_text(
                "\n".join(
                    (
                        "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                        "APP_API_INTERNAL_SHARED_SECRET=app-api-secret",
                        f"EXECUTION_CONTROL_STAGING_APP_API_BASE_URL={server.base_url}",
                        f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH={projection_path}",
                        f"CAMPUS_OBSERVABILITY_CONFIG_SNAPSHOT_PATH={observability_projection_path}",
                        "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                        "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                        "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                        "STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://127.0.0.1:9000",
                        "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access",
                        "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret",
                        "STAGING_INGESTION_OBJECT_STORE_REGION=auto",
                        "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-agent-derived-staging",
                        "STAGING_INGESTION_QDRANT_URL=http://qdrant:6333",
                        "STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1",
                        "STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key",
                        "STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B",
                        "STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560",
                        "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT=https://sentry.example.com",
                        "OTEL_COLLECTOR_SENTRY_AUTH_VALUE=sentry sentry_key=key",
                        "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
                        "OTEL_COLLECTOR_AXIOM_AUTH_HEADER=Bearer axiom",
                        "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime",
                        "OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT=https://langfuse.internal/api/public/otel",
                        "OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER=Basic cGstbGY6c2stbGY=",
                        "OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=4",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            command = f"""
            set -euo pipefail
            export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env))}
            export EXECUTION_CONTROL_STAGING_RUNTIME_DIR={shlex.quote(str(root / ".tmp" / "execution-control-staging"))}
            export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=test-sha
            source {shlex.quote(str(common_path))}
            execution_control_staging_load_env
            execution_control_staging_require_runtime_env
            export first_qdrant_url="${{QDRANT_URL}}"
            export first_qdrant_query_key="${{QDRANT_QUERY_API_KEY}}"
            export first_qdrant_admin_key="${{QDRANT_API_KEY}}"
            export first_qdrant_read_only_key="${{QDRANT_READ_ONLY_API_KEY}}"
            export first_temporal_address="${{EXECUTION_CONTROL_TEMPORAL_ADDRESS}}"
            export first_temporal_postgres_password="${{TEMPORAL_POSTGRES_PASSWORD}}"
            export first_workflow_id_salt="${{EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT}}"
            export first_internal_query_secret="${{EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET}}"
            export first_metrics_token="${{EXECUTION_CONTROL_METRICS_BEARER_TOKEN}}"
            export first_run_projection_url="${{EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL}}"
            execution_control_staging_load_env
            execution_control_staging_require_runtime_env
            node - <<'NODE'
            function capture(prefix) {{
              return {{
                qdrantUrl: process.env[`${{prefix}}_qdrant_url`] || process.env.QDRANT_URL,
                qdrantQueryKey:
                  process.env[`${{prefix}}_qdrant_query_key`] || process.env.QDRANT_QUERY_API_KEY,
                qdrantAdminKey:
                  process.env[`${{prefix}}_qdrant_admin_key`] || process.env.QDRANT_API_KEY,
                qdrantReadOnlyKey:
                  process.env[`${{prefix}}_qdrant_read_only_key`] ||
                  process.env.QDRANT_READ_ONLY_API_KEY,
                temporalAddress:
                  process.env[`${{prefix}}_temporal_address`] ||
                  process.env.EXECUTION_CONTROL_TEMPORAL_ADDRESS,
                temporalPostgresPassword:
                  process.env[`${{prefix}}_temporal_postgres_password`] ||
                  process.env.TEMPORAL_POSTGRES_PASSWORD,
                workflowIDSalt:
                  process.env[`${{prefix}}_workflow_id_salt`] ||
                  process.env.EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT,
                internalQuerySecret:
                  process.env[`${{prefix}}_internal_query_secret`] ||
                  process.env.EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET,
                metricsToken:
                  process.env[`${{prefix}}_metrics_token`] ||
                  process.env.EXECUTION_CONTROL_METRICS_BEARER_TOKEN,
                runProjectionUrl:
                  process.env[`${{prefix}}_run_projection_url`] ||
                  process.env.EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL,
              }};
            }}
            console.log(JSON.stringify({{
              first: capture("first"),
              second: capture("second"),
            }}));
            NODE
            """
            return subprocess.run(
                ["bash", "-lc", textwrap.dedent(command)],
                cwd=root,
                env=os.environ.copy(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        finally:
            server.close()


def run_env_loader_with_repo_local_secrets_only() -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        common_path = copy_staging_modules_for_tests(root)
        (root / ".env.staging.local").write_text(
            "EXECUTION_CONTROL_SHARED_SECRET=repo-local-secret\n",
            encoding="utf-8",
        )
        app_api_dir = root / "apps" / "app-api"
        app_api_dir.mkdir(parents=True)
        (app_api_dir / ".dev.vars").write_text(
            "EXECUTION_CONTROL_SHARED_SECRET=dev-vars-secret\n",
            encoding="utf-8",
        )
        runtime_env = root / "ops" / "runtime.env"
        projection_path = root / "ops" / "provider-config-projection.json"
        observability_projection_path = root / "ops" / "observability-config-projection.json"
        write_provider_config_projection_for_tests(projection_path)
        write_observability_config_projection_for_tests(observability_projection_path)
        runtime_env.parent.mkdir(exist_ok=True)
        runtime_env.write_text(
            "\n".join(
                (
                    f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH={projection_path}",
                    f"CAMPUS_OBSERVABILITY_CONFIG_SNAPSHOT_PATH={observability_projection_path}",
                    "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent",
                    "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent",
                    "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw@staging-raw.example.com:5432/campus_agent",
                    "STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com",
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
                    "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT=https://sentry.example.com",
                    "OTEL_COLLECTOR_SENTRY_AUTH_VALUE=sentry sentry_key=key",
                    "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
                    "OTEL_COLLECTOR_AXIOM_AUTH_HEADER=Bearer axiom",
                    "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime",
                    "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                    "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://projection@staging-db.example.com:5432/campus_agent",
                    "TEMPORAL_POSTGRES_PASSWORD=temporal-password",
                    "EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233",
                    "EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging",
                    "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow",
                    "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:001",
                    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY=staging:workflow-worker:001",
                    "EXECUTION_CONTROL_TEMPORAL_CORE_WORKER_IDENTITY=staging:activity-core:001",
                    "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY=staging:activity-knowledge:001",
                    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt",
                    "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        command = f"""
        set -euo pipefail
        export EXECUTION_CONTROL_STAGING_ENV_FILE={runtime_env}
        source {common_path}
        execution_control_staging_load_env
        execution_control_staging_require_runtime_env
        env | grep 'EXECUTION_CONTROL_SHARED_SECRET\\|API_WORKER_SHARED_SECRET' || true
        """
        return subprocess.run(
            ["bash", "-lc", textwrap.dedent(command)],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )


def run_checkout_guard(
    *, mutate: str, expected_sha: str | None
) -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        common_path = copy_staging_modules_for_tests(root)
        env = os.environ.copy()
        command = f"""
        set -euo pipefail
        git init -q
        git config user.email test@example.com
        git config user.name Test
        printf 'tracked\\n' > tracked.txt
        git add tracked.txt infra/local/staging
        git commit -q -m init
        if [[ {expected_sha is not None!s} == True ]]; then
          if [[ {expected_sha!r} == HEAD ]]; then
            export EXECUTION_CONTROL_STAGING_EXPECTED_SHA="$(git rev-parse HEAD)"
          else
            export EXECUTION_CONTROL_STAGING_EXPECTED_SHA={expected_sha or ""}
          fi
        fi
        {mutate}
        source {common_path}
        execution_control_staging_require_deploy_checkout_clean
        """
        return subprocess.run(
            ["bash", "-lc", textwrap.dedent(command)],
            cwd=root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
