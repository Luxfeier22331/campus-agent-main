from __future__ import annotations

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
                        "EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET=app-api-secret",
                        "EXECUTION_CONTROL_RUNTIME_RELEASE=execution-control@abcdef1",
                        f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH={projection_path}",
                        f"QDRANT_TLS_CA_CERT_PATH={qdrant_ca_path}",
                        "QDRANT_URL=https://127.0.0.1:6333",
                        "QDRANT_QUERY_API_KEY=qdrant-query-key",
                        "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                        "EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET=audit-secret",
                        "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt",
                        "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                        "AGENT_RUNTIME_SHARED_SECRET=agent-runtime-secret",
                        "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET=query-secret",
                        "PERSONAL_MEMORY_API_SECRET=memory-secret",
                        "PERSONAL_MEMORY_OWNER_SALT=memory-salt",
                        "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable",
                        "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/campus_agent?sslmode=disable&gssencmode=disable",
                        "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable",
                        "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT=https://sentry.example.internal/api/project/integration/otlp",
                        "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
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
            server = ProviderConfigStubServer()
            app_api_base_url = ""
            server.start()
            try:
                app_api_base_url = server.base_url
                with runtime_env_path.open("a", encoding="utf-8") as handle:
                    handle.write(f"EXECUTION_CONTROL_APP_API_BASE_URL={app_api_base_url}\n")
                    handle.write(
                        f"EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL={app_api_base_url}\n"
                    )
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
            docs = [doc for doc in yaml.safe_load_all(result.stdout) if isinstance(doc, dict)]
            by_name = {doc["metadata"]["name"]: doc for doc in docs}
            self.assertEqual(
                set(by_name),
                {
                    "agent-runtime-secrets",
                    "execution-agent-client-secrets",
                    "execution-control-internal-query-secrets",
                    "execution-control-secrets",
                    "execution-memory-client-secrets",
                    "execution-rag-secrets",
                    "execution-runtime-rendered-config",
                    "execution-runtime-provider-config-projection",
                    "execution-runtime-qdrant-tls-ca",
                    "execution-worker-common-secrets",
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
            self.assertEqual(by_name["execution-runtime-qdrant-tls-ca"]["kind"], "ConfigMap")
            self.assertTrue(set(rendered_config).isdisjoint(set(rendered_secrets)))

            self.assertEqual(
                rendered_config["EXECUTION_CONTROL_RUNTIME_RELEASE"],
                "execution-control@test-sha",
            )
            self.assertEqual(
                rendered_config["EXECUTION_CONTROL_APP_API_BASE_URL"],
                app_api_base_url,
            )
            self.assertEqual(rendered_config["QDRANT_URL"], "http://qdrant:6333")
            self.assertEqual(
                rendered_config["OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT"],
                "https://us-east-1.aws.edge.axiom.co",
            )
            self.assertEqual(
                rendered_config["OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT"],
                "http://langfuse-web:3000/api/public/otel",
            )
            self.assertEqual(
                rendered_config["EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH"],
                "/run/campus-agent/provider-config-projection.json",
            )

            self.assertIn(
                "API_WORKER_SHARED_SECRET",
                rendered_secrets,
            )
            self.assertIn("QDRANT_QUERY_API_KEY", rendered_secrets)
            self.assertIn("EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET", rendered_secrets)
            self.assertEqual(
                by_name["execution-control-secrets"]["data"][
                    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"
                ],
                "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
            )

            for key in (
                "EXECUTION_CONTROL_APP_API_BASE_URL",
                "QDRANT_URL",
                "EMBEDDING_MODEL",
                "EMBEDDING_DIMENSIONS",
                "HINDSIGHT_API_LLM_BASE_URL",
                "HINDSIGHT_API_LLM_MODEL",
                "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
                "OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
            ):
                with self.subTest(key=key):
                    self.assertNotIn(key, rendered_secrets)
            for forbidden_secret_name in (
                "execution-app-api-internal-secrets",
                "execution-stateful-runtime-secrets",
                "execution-telemetry-collector-secrets",
                "notice-tool-secrets",
                "qdrant-admin-secrets",
                "execution-runtime-secrets",
            ):
                with self.subTest(forbidden_secret_name=forbidden_secret_name):
                    self.assertNotIn(forbidden_secret_name, by_name)

            secret_like_pattern = re.compile(
                r"(SECRET|PASSWORD|API_KEY|AUTH_HEADER|AUTH_VALUE|DATABASE_URL|BEARER_TOKEN)"
            )
            for key in rendered_config:
                with self.subTest(config_key=key):
                    self.assertNotRegex(key, secret_like_pattern)


if __name__ == "__main__":
    unittest.main()
