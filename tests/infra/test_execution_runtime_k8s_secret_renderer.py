from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import yaml

from tests.execution_control_staging_preflight_support import (
    ProviderConfigStubServer,
    copy_staging_modules_for_tests,
    write_provider_config_projection_for_tests,
)

ROOT = Path(__file__).resolve().parents[2]


class ExecutionRuntimeK8sEnvRendererTest(unittest.TestCase):
    def test_splits_rendered_config_and_secrets(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            common_path = copy_staging_modules_for_tests(temp_root)
            renderer_path = temp_root / "infra" / "local" / "staging" / "render-env.sh"
            renderer_path.write_text(
                (ROOT / "infra/local/staging/render-execution-runtime-k8s-env.sh").read_text(
                    encoding="utf-8"
                ),
                encoding="utf-8",
            )
            renderer_path.chmod(0o755)

            ops_dir = temp_root / "ops" / "staging"
            ops_dir.mkdir(parents=True)
            projection_path = ops_dir / "provider-config-projection.json"
            qdrant_ca_path = ops_dir / "qdrant-ca.pem"
            runtime_env_path = ops_dir / "runtime.env"
            fake_bin_dir = temp_root / "bin"
            fake_kubectl_path = fake_bin_dir / "kubectl"
            fake_bin_dir.mkdir()

            write_provider_config_projection_for_tests(projection_path)
            qdrant_ca_path.write_text("test-ca\n", encoding="utf-8")
            runtime_env_path.write_text(
                "\n".join(
                    (
                        "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                        "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                        "EXECUTION_CONTROL_APP_API_BASE_URL=https://api-staging.example.internal",
                        "EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL=https://api-internal.example.internal",
                        "EXECUTION_CONTROL_RUNTIME_RELEASE=execution-control@abcdef1",
                        f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH={projection_path}",
                        f"QDRANT_TLS_CA_CERT_PATH={qdrant_ca_path}",
                        "QDRANT_URL=https://127.0.0.1:6333",
                        "QDRANT_QUERY_API_KEY=qdrant-query-key",
                        "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                        "EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET=audit-secret",
                        "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                        "AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                        "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET=query-secret",
                        "PERSONAL_MEMORY_API_SECRET=memory-secret",
                        "PERSONAL_MEMORY_OWNER_SALT=memory-salt",
                        "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable",
                        "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/campus_agent?sslmode=disable&gssencmode=disable",
                        "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            fake_kubectl_path.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env bash
                    set -euo pipefail
                    kind=""
                    name=""
                    env_file=""
                    from_file=""
                    previous=""
                    for arg in "$@"; do
                      if [[ "${previous}" == "create" ]]; then
                        kind="${arg}"
                      elif [[ -n "${kind}" && -z "${name}" && "${arg}" != "generic" ]]; then
                        name="${arg}"
                      elif [[ "${previous}" == "generic" ]]; then
                        name="${arg}"
                      fi
                      if [[ "${previous}" == "--from-env-file" ]]; then
                        env_file="${arg}"
                      elif [[ "${previous}" == "--from-file" ]]; then
                        from_file="${arg}"
                      fi
                      previous="${arg}"
                    done
                    printf '%s\\n' 'apiVersion: v1'
                    if [[ "${kind}" == "configmap" ]]; then
                      printf '%s\\n' 'kind: ConfigMap'
                    else
                      printf '%s\\n' 'kind: Secret' 'type: Opaque'
                    fi
                    printf '%s\\n' 'metadata:' "  name: ${name}"
                    if [[ -n "${env_file}" ]]; then
                      printf '%s\\n' 'data:'
                      while IFS= read -r line; do
                        [[ -z "${line}" ]] && continue
                        key="${line%%=*}"
                        value="${line#*=}"
                        printf '  %s: "%s"\\n' "${key}" "${value}"
                      done <"${env_file}"
                    elif [[ -n "${from_file}" ]]; then
                      printf '%s\\n' 'data:'
                      key="${from_file%%=*}"
                      printf '  %s: "<file>"\\n' "${key}"
                    fi
                    """
                ),
                encoding="utf-8",
            )
            fake_kubectl_path.chmod(0o755)

            command = f"""
            set -euo pipefail
            export PATH={shlex.quote(str(fake_bin_dir))}:$PATH
            export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env_path))}
            export EXECUTION_CONTROL_STAGING_RUNTIME_DIR={shlex.quote(str(temp_root / ".tmp"))}
            export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=test-sha
            export EXECUTION_RUNTIME_K8S_ENV_BOUNDARY_PATH={shlex.quote(str(ROOT / "configs/runtime/k8s-execution-runtime-env-boundary.v1.json"))}
            source {shlex.quote(str(common_path))}
            {shlex.quote(str(renderer_path))}
            """
            result = subprocess.run(
                ["bash", "-lc", textwrap.dedent(command)],
                cwd=temp_root,
                env=os.environ.copy(),
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            docs = [doc for doc in yaml.safe_load_all(result.stdout) if isinstance(doc, dict)]
            by_name = {doc["metadata"]["name"]: doc for doc in docs}
            self.assertEqual(
                set(by_name),
                {
                    "agent-runtime-secrets",
                    "execution-agent-client-secrets",
                    "execution-control-internal-query-secrets",
                    "execution-control-metrics-secrets",
                    "execution-control-secrets",
                    "execution-memory-client-secrets",
                    "execution-rag-secrets",
                    "execution-run-projection-secrets",
                    "execution-temporal-workflow-secrets",
                    "execution-telemetry-client-secrets",
                    "execution-tool-read-model-secrets",
                    "execution-runtime-rendered-config",
                    "execution-runtime-provider-config-projection",
                    "execution-runtime-qdrant-tls-ca",
                },
            )

            rendered_config = by_name["execution-runtime-rendered-config"]["data"]
            rendered_secrets = {
                key
                for name, doc in by_name.items()
                if doc["kind"] == "Secret"
                and name != "execution-runtime-provider-config-projection"
                for key in doc.get("data", {})
            }

            self.assertEqual(
                by_name["execution-runtime-rendered-config"]["kind"],
                "ConfigMap",
            )
            self.assertEqual(by_name["execution-control-secrets"]["kind"], "Secret")
            self.assertEqual(by_name["execution-control-metrics-secrets"]["kind"], "Secret")
            self.assertEqual(by_name["execution-run-projection-secrets"]["kind"], "Secret")
            self.assertEqual(by_name["execution-telemetry-client-secrets"]["kind"], "Secret")
            self.assertEqual(by_name["execution-tool-read-model-secrets"]["kind"], "Secret")
            self.assertEqual(by_name["execution-runtime-qdrant-tls-ca"]["kind"], "ConfigMap")
            self.assertTrue(set(rendered_config).isdisjoint(set(rendered_secrets)))
            boundary = json.loads(
                (ROOT / "configs/runtime/k8s-execution-runtime-env-boundary.v1.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                set(rendered_config),
                set(boundary["configmaps"]["execution-runtime-rendered-config"]),
            )

            self.assertEqual(
                rendered_config["EXECUTION_CONTROL_RUNTIME_RELEASE"],
                "execution-control@test-sha",
            )
            self.assertEqual(
                rendered_config["EXECUTION_CONTROL_APP_API_BASE_URL"],
                "https://api-staging.example.internal",
            )
            self.assertEqual(
                rendered_config["EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL"],
                "https://api-internal.example.internal",
            )
            self.assertEqual(
                rendered_config["EXECUTION_CONTROL_EXECUTION_AUDIT_URL"],
                "https://api-staging.mucwiki-edge.link/api/internal/execution/audit-events",
            )
            self.assertEqual(rendered_config["QDRANT_URL"], "http://qdrant:6333")
            self.assertEqual(
                rendered_config["EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH"],
                "/run/campus-agent/provider-config-projection.json",
            )

            self.assertIn(
                "API_WORKER_SHARED_SECRET",
                rendered_secrets,
            )
            self.assertIn("QDRANT_QUERY_API_KEY", rendered_secrets)
            self.assertIn("CAMPUS_SHARED_POSTGRES_URL", rendered_secrets)
            self.assertIn("EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET", rendered_secrets)
            self.assertIn("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT", rendered_secrets)
            self.assertNotIn("APP_API_OTEL_INGEST_SHARED_SECRET", rendered_secrets)
            self.assertNotIn("OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER", rendered_secrets)
            self.assertNotIn("OTEL_COLLECTOR_AXIOM_AUTH_HEADER", rendered_secrets)
            self.assertNotIn("OTEL_COLLECTOR_SENTRY_AUTH_VALUE", rendered_secrets)
            self.assertEqual(
                by_name["execution-control-secrets"]["data"]["API_WORKER_SHARED_SECRET"],
                "worker-secret",
            )
            self.assertEqual(
                by_name["execution-run-projection-secrets"]["data"][
                    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"
                ],
                "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
            )
            self.assertEqual(
                by_name["execution-tool-read-model-secrets"]["data"]["CAMPUS_SHARED_POSTGRES_URL"],
                "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
            )

            for key in (
                "EXECUTION_CONTROL_APP_API_BASE_URL",
                "QDRANT_URL",
                "EMBEDDING_MODEL",
                "EMBEDDING_DIMENSIONS",
                "HINDSIGHT_API_LLM_BASE_URL",
                "HINDSIGHT_API_LLM_MODEL",
            ):
                with self.subTest(key=key):
                    self.assertNotIn(key, rendered_secrets)
            forbidden_slim_keys = {
                "DOCUMENT_REGISTRY_DATABASE_URL",
                "RAW_ASSET_REGISTRY_DATABASE_URL",
                "OBJECT_STORE_ENDPOINT",
                "OBJECT_STORE_ACCESS_KEY",
                "OBJECT_STORE_SECRET_KEY",
                "OBJECT_STORE_DERIVED_ACCESS_KEY",
                "OBJECT_STORE_DERIVED_SECRET_KEY",
                "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT",
                "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY",
                "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY",
                "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET",
                "APP_API_OTEL_INGEST_SHARED_SECRET",
                "OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER",
                "OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
                "OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION",
                "OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT",
                "OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT",
                "OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT",
                "OTEL_COLLECTOR_MEMORY_LIMIT_MIB",
                "OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB",
                "QDRANT_API_KEY",
                "QDRANT_READ_ONLY_API_KEY",
            }
            rendered_keys = set(rendered_config) | rendered_secrets
            for key in forbidden_slim_keys:
                with self.subTest(forbidden_slim_key=key):
                    self.assertNotIn(key, rendered_keys)
            for forbidden_secret_name in (
                "execution-app-api-internal-secrets",
                "execution-stateful-runtime-secrets",
                "execution-telemetry-collector-secrets",
                "notice-tool-secrets",
                "qdrant-admin-secrets",
                "execution-runtime-secrets",
                "execution-worker-common-secrets",
            ):
                with self.subTest(forbidden_secret_name=forbidden_secret_name):
                    self.assertNotIn(forbidden_secret_name, by_name)

            secret_like_pattern = re.compile(
                r"(SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH_HEADER|AUTH_VALUE|DATABASE_URL|BEARER_TOKEN|TOKEN|SALT)"
            )
            for key in rendered_config:
                with self.subTest(config_key=key):
                    self.assertNotRegex(key, secret_like_pattern)

    def test_full_profile_renders_telemetry_collector_resources(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            common_path = copy_staging_modules_for_tests(temp_root)
            renderer_path = temp_root / "infra" / "local" / "staging" / "render-env.sh"
            renderer_path.write_text(
                (ROOT / "infra/local/staging/render-execution-runtime-k8s-env.sh").read_text(
                    encoding="utf-8"
                ),
                encoding="utf-8",
            )
            renderer_path.chmod(0o755)

            ops_dir = temp_root / "ops" / "staging"
            ops_dir.mkdir(parents=True)
            projection_path = ops_dir / "provider-config-projection.json"
            qdrant_ca_path = ops_dir / "qdrant-ca.pem"
            runtime_env_path = ops_dir / "runtime.env"
            fake_bin_dir = temp_root / "bin"
            fake_kubectl_path = fake_bin_dir / "kubectl"
            fake_bin_dir.mkdir()
            server = ProviderConfigStubServer()

            write_provider_config_projection_for_tests(projection_path)
            qdrant_ca_path.write_text("test-ca\n", encoding="utf-8")
            server.start()
            try:
                runtime_env_path.write_text(
                    "\n".join(
                        (
                            "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                            "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                            f"EXECUTION_CONTROL_STAGING_APP_API_BASE_URL={server.base_url}",
                            "APP_API_INTERNAL_SHARED_SECRET=app-api-secret",
                            "EXECUTION_CONTROL_RUNTIME_RELEASE=execution-control@abcdef1",
                            f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH={projection_path}",
                            f"QDRANT_TLS_CA_CERT_PATH={qdrant_ca_path}",
                            "QDRANT_URL=https://127.0.0.1:6333",
                            "QDRANT_QUERY_API_KEY=qdrant-query-key",
                            "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                            "EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET=audit-secret",
                            "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                            "AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                            "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET=query-secret",
                            "PERSONAL_MEMORY_API_SECRET=memory-secret",
                            "PERSONAL_MEMORY_OWNER_SALT=memory-salt",
                            "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable",
                            "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/campus_agent?sslmode=disable&gssencmode=disable",
                            "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY=hindsight-embedding-key",
                            "HINDSIGHT_API_LLM_API_KEY=hindsight-llm-key",
                            "HINDSIGHT_POSTGRES_PASSWORD=hindsight-password",
                            "TEMPORAL_POSTGRES_PASSWORD=temporal-password",
                            "OTEL_COLLECTOR_AXIOM_AUTH_HEADER=Bearer axiom-ingest-token",
                            "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime",
                            "OTEL_COLLECTOR_AXIOM_METRICS_DATASET=campus-agent-runtime-metrics",
                            "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
                            "OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT=https://langfuse.internal/api/public/otel",
                            "OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER=Basic cGstbGY6c2stbGY=",
                            "OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=4",
                            "OTEL_COLLECTOR_SENTRY_AUTH_VALUE=sentry sentry_key=key",
                            "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT=https://sentry.example.test/api/project/integration/otlp",
                        )
                    )
                    + "\n",
                    encoding="utf-8",
                )
                fake_kubectl_path.write_text(
                    textwrap.dedent(
                        """\
                    #!/usr/bin/env bash
                    set -euo pipefail
                    kind=""
                    name=""
                    env_file=""
                    from_file=""
                    previous=""
                    for arg in "$@"; do
                      if [[ "${previous}" == "create" ]]; then
                        kind="${arg}"
                      elif [[ -n "${kind}" && -z "${name}" && "${arg}" != "generic" ]]; then
                        name="${arg}"
                      elif [[ "${previous}" == "generic" ]]; then
                        name="${arg}"
                      fi
                      if [[ "${previous}" == "--from-env-file" ]]; then
                        env_file="${arg}"
                      elif [[ "${previous}" == "--from-file" ]]; then
                        from_file="${arg}"
                      fi
                      previous="${arg}"
                    done
                    printf '%s\\n' 'apiVersion: v1'
                    if [[ "${kind}" == "configmap" ]]; then
                      printf '%s\\n' 'kind: ConfigMap'
                    else
                      printf '%s\\n' 'kind: Secret' 'type: Opaque'
                    fi
                    printf '%s\\n' 'metadata:' "  name: ${name}"
                    if [[ -n "${env_file}" ]]; then
                      printf '%s\\n' 'data:'
                      while IFS= read -r line; do
                        [[ -z "${line}" ]] && continue
                        key="${line%%=*}"
                        value="${line#*=}"
                        printf '  %s: "%s"\\n' "${key}" "${value}"
                      done <"${env_file}"
                    elif [[ -n "${from_file}" ]]; then
                      printf '%s\\n' 'data:'
                      key="${from_file%%=*}"
                      printf '  %s: "<file>"\\n' "${key}"
                    fi
                    """
                    ),
                    encoding="utf-8",
                )
                fake_kubectl_path.chmod(0o755)

                command = f"""
            set -euo pipefail
            export PATH={shlex.quote(str(fake_bin_dir))}:$PATH
            export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env_path))}
            export EXECUTION_CONTROL_STAGING_RUNTIME_DIR={shlex.quote(str(temp_root / ".tmp"))}
            export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=test-sha
            export EXECUTION_RUNTIME_K8S_ENV_PROFILE=staging-full
            export EXECUTION_RUNTIME_K8S_ENV_BOUNDARY_PATH={shlex.quote(str(ROOT / "configs/runtime/k8s-execution-runtime-env-boundary.v1.json"))}
            source {shlex.quote(str(common_path))}
            {shlex.quote(str(renderer_path))}
            """
                result = subprocess.run(
                    ["bash", "-lc", textwrap.dedent(command)],
                    cwd=temp_root,
                    env=os.environ.copy(),
                    capture_output=True,
                    text=True,
                )
            finally:
                server.close()

            self.assertEqual(result.returncode, 0, result.stderr)
            by_name = {
                doc["metadata"]["name"]: doc
                for doc in yaml.safe_load_all(result.stdout)
                if isinstance(doc, dict)
            }

            telemetry_config = by_name["execution-telemetry-collector-config"]["data"]
            telemetry_secret = by_name["execution-telemetry-collector-secrets"]["data"]
            tool_read_model_secret = by_name["execution-tool-read-model-secrets"]["data"]
            stateful_secret = by_name["execution-stateful-runtime-secrets"]["data"]
            boundary = json.loads(
                (ROOT / "configs/runtime/k8s-execution-runtime-env-boundary.v1.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                set(telemetry_config),
                set(boundary["configmaps"]["execution-telemetry-collector-config"]),
            )
            self.assertEqual(
                telemetry_config["OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT"],
                "https://langfuse.internal/api/public/otel",
            )
            self.assertEqual(telemetry_config["OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION"], "4")
            self.assertEqual(telemetry_config["OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT"], "0.0.0.0:4318")
            self.assertEqual(
                telemetry_config["OTEL_COLLECTOR_AXIOM_METRICS_DATASET"],
                "campus-agent-runtime-metrics",
            )
            self.assertEqual(
                telemetry_config["OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT"],
                "https://sentry.example.test/api/project/integration/otlp",
            )
            self.assertIn("APP_API_OTEL_INGEST_SHARED_SECRET", telemetry_secret)
            self.assertEqual(
                telemetry_secret["OTEL_COLLECTOR_AXIOM_AUTH_HEADER"],
                "Bearer axiom-ingest-token",
            )
            self.assertEqual(
                telemetry_secret["OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER"],
                "Basic cGstbGY6c2stbGY=",
            )
            self.assertEqual(
                telemetry_secret["OTEL_COLLECTOR_SENTRY_AUTH_VALUE"],
                "sentry sentry_key=key",
            )
            self.assertEqual(
                tool_read_model_secret["CAMPUS_SHARED_POSTGRES_URL"],
                "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
            )
            self.assertEqual(
                stateful_secret["HINDSIGHT_API_DATABASE_URL"],
                "postgresql://hindsight:hindsight-password@hindsight-postgres:5432/hindsight",
            )
            self.assertEqual(
                stateful_secret["HINDSIGHT_API_TENANT_API_KEY"],
                "memory-secret",
            )

    def test_renderer_rejects_duplicate_secret_key_ownership(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            common_path = copy_staging_modules_for_tests(temp_root)
            renderer_path = temp_root / "infra" / "local" / "staging" / "render-env.sh"
            renderer_path.write_text(
                (ROOT / "infra/local/staging/render-execution-runtime-k8s-env.sh").read_text(
                    encoding="utf-8"
                ),
                encoding="utf-8",
            )
            renderer_path.chmod(0o755)

            ops_dir = temp_root / "ops" / "staging"
            ops_dir.mkdir(parents=True)
            projection_path = ops_dir / "provider-config-projection.json"
            qdrant_ca_path = ops_dir / "qdrant-ca.pem"
            runtime_env_path = ops_dir / "runtime.env"
            boundary_path = ops_dir / "boundary.json"

            write_provider_config_projection_for_tests(projection_path)
            qdrant_ca_path.write_text("test-ca\n", encoding="utf-8")
            runtime_env_path.write_text(
                "\n".join(
                    (
                        "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                        "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                        "EXECUTION_CONTROL_APP_API_BASE_URL=https://api-staging.example.internal",
                        "EXECUTION_CONTROL_RUNTIME_RELEASE=execution-control@abcdef1",
                        f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH={projection_path}",
                        f"QDRANT_TLS_CA_CERT_PATH={qdrant_ca_path}",
                        "QDRANT_URL=https://127.0.0.1:6333",
                        "QDRANT_QUERY_API_KEY=qdrant-query-key",
                        "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                        "EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET=audit-secret",
                        "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                        "AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                        "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET=query-secret",
                        "PERSONAL_MEMORY_API_SECRET=memory-secret",
                        "PERSONAL_MEMORY_OWNER_SALT=memory-salt",
                        "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable",
                        "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/campus_agent?sslmode=disable&gssencmode=disable",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            boundary = json.loads(
                (ROOT / "configs/runtime/k8s-execution-runtime-env-boundary.v1.json").read_text(
                    encoding="utf-8"
                )
            )
            boundary["secrets"]["execution-agent-client-secrets"].append("API_WORKER_SHARED_SECRET")
            boundary_path.write_text(json.dumps(boundary), encoding="utf-8")

            command = f"""
            set -euo pipefail
            export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env_path))}
            export EXECUTION_CONTROL_STAGING_RUNTIME_DIR={shlex.quote(str(temp_root / ".tmp"))}
            export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=test-sha
            export EXECUTION_RUNTIME_K8S_ENV_BOUNDARY_PATH={shlex.quote(str(boundary_path))}
            source {shlex.quote(str(common_path))}
            {shlex.quote(str(renderer_path))}
            """
            result = subprocess.run(
                ["bash", "-lc", textwrap.dedent(command)],
                cwd=temp_root,
                env=os.environ.copy(),
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn(
                "API_WORKER_SHARED_SECRET appears in both Secret execution-control-secrets and Secret execution-agent-client-secrets",
                result.stderr,
            )

    def test_renderer_rejects_missing_rendered_config_key(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            common_path = copy_staging_modules_for_tests(temp_root)
            renderer_path = temp_root / "infra" / "local" / "staging" / "render-env.sh"
            renderer_path.write_text(
                (ROOT / "infra/local/staging/render-execution-runtime-k8s-env.sh").read_text(
                    encoding="utf-8"
                ),
                encoding="utf-8",
            )
            renderer_path.chmod(0o755)

            ops_dir = temp_root / "ops" / "staging"
            ops_dir.mkdir(parents=True)
            projection_path = ops_dir / "provider-config-projection.json"
            qdrant_ca_path = ops_dir / "qdrant-ca.pem"
            runtime_env_path = ops_dir / "runtime.env"
            boundary_path = ops_dir / "boundary.json"

            write_provider_config_projection_for_tests(projection_path)
            qdrant_ca_path.write_text("test-ca\n", encoding="utf-8")
            runtime_env_path.write_text(
                "\n".join(
                    (
                        "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                        "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                        "EXECUTION_CONTROL_APP_API_BASE_URL=https://api-staging.example.internal",
                        "EXECUTION_CONTROL_RUNTIME_RELEASE=execution-control@abcdef1",
                        f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH={projection_path}",
                        f"QDRANT_TLS_CA_CERT_PATH={qdrant_ca_path}",
                        "QDRANT_URL=https://127.0.0.1:6333",
                        "QDRANT_QUERY_API_KEY=qdrant-query-key",
                        "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                        "EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET=audit-secret",
                        "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                        "AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                        "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET=query-secret",
                        "PERSONAL_MEMORY_API_SECRET=memory-secret",
                        "PERSONAL_MEMORY_OWNER_SALT=memory-salt",
                        "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable",
                        "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/campus_agent?sslmode=disable&gssencmode=disable",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            boundary = json.loads(
                (ROOT / "configs/runtime/k8s-execution-runtime-env-boundary.v1.json").read_text(
                    encoding="utf-8"
                )
            )
            boundary["configmaps"]["execution-runtime-rendered-config"].append(
                "MISSING_RENDERED_CONFIG_KEY"
            )
            boundary_path.write_text(json.dumps(boundary), encoding="utf-8")

            command = f"""
            set -euo pipefail
            export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env_path))}
            export EXECUTION_CONTROL_STAGING_RUNTIME_DIR={shlex.quote(str(temp_root / ".tmp"))}
            export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=test-sha
            export EXECUTION_RUNTIME_K8S_ENV_BOUNDARY_PATH={shlex.quote(str(boundary_path))}
            source {shlex.quote(str(common_path))}
            {shlex.quote(str(renderer_path))}
            """
            result = subprocess.run(
                ["bash", "-lc", textwrap.dedent(command)],
                cwd=temp_root,
                env=os.environ.copy(),
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn(
                "execution-runtime-rendered-config requires missing env keys: MISSING_RENDERED_CONFIG_KEY",
                result.stderr,
            )

    def test_renderer_rejects_unprofiled_boundary_resources(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            common_path = copy_staging_modules_for_tests(temp_root)
            renderer_path = temp_root / "infra" / "local" / "staging" / "render-env.sh"
            renderer_path.write_text(
                (ROOT / "infra/local/staging/render-execution-runtime-k8s-env.sh").read_text(
                    encoding="utf-8"
                ),
                encoding="utf-8",
            )
            renderer_path.chmod(0o755)

            ops_dir = temp_root / "ops" / "staging"
            ops_dir.mkdir(parents=True)
            projection_path = ops_dir / "provider-config-projection.json"
            qdrant_ca_path = ops_dir / "qdrant-ca.pem"
            runtime_env_path = ops_dir / "runtime.env"
            boundary_path = ops_dir / "boundary.json"

            write_provider_config_projection_for_tests(projection_path)
            qdrant_ca_path.write_text("test-ca\n", encoding="utf-8")
            runtime_env_path.write_text(
                "\n".join(
                    (
                        "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                        "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                        "EXECUTION_CONTROL_APP_API_BASE_URL=https://api-staging.example.internal",
                        "EXECUTION_CONTROL_RUNTIME_RELEASE=execution-control@abcdef1",
                        f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH={projection_path}",
                        f"QDRANT_TLS_CA_CERT_PATH={qdrant_ca_path}",
                        "QDRANT_URL=https://127.0.0.1:6333",
                        "QDRANT_QUERY_API_KEY=qdrant-query-key",
                        "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                        "EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET=audit-secret",
                        "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                        "AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                        "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET=query-secret",
                        "PERSONAL_MEMORY_API_SECRET=memory-secret",
                        "PERSONAL_MEMORY_OWNER_SALT=memory-salt",
                        "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable",
                        "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/campus_agent?sslmode=disable&gssencmode=disable",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            boundary = json.loads(
                (ROOT / "configs/runtime/k8s-execution-runtime-env-boundary.v1.json").read_text(
                    encoding="utf-8"
                )
            )
            boundary["secrets"]["unprofiled-runtime-secrets"] = ["UNPROFILED_RUNTIME_SECRET"]
            boundary_path.write_text(json.dumps(boundary), encoding="utf-8")

            command = f"""
            set -euo pipefail
            export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env_path))}
            export EXECUTION_CONTROL_STAGING_RUNTIME_DIR={shlex.quote(str(temp_root / ".tmp"))}
            export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=test-sha
            export EXECUTION_RUNTIME_K8S_ENV_BOUNDARY_PATH={shlex.quote(str(boundary_path))}
            source {shlex.quote(str(common_path))}
            {shlex.quote(str(renderer_path))}
            """
            result = subprocess.run(
                ["bash", "-lc", textwrap.dedent(command)],
                cwd=temp_root,
                env=os.environ.copy(),
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn(
                "secrets.unprofiled-runtime-secrets is not referenced by any profile",
                result.stderr,
            )


if __name__ == "__main__":
    unittest.main()
