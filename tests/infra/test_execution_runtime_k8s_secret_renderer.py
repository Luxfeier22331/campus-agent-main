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
                        "EXECUTION_CONTROL_RUNTIME_RELEASE=execution-control@abcdef1",
                        f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH={projection_path}",
                        f"QDRANT_TLS_CA_CERT_PATH={qdrant_ca_path}",
                        "QDRANT_URL=https://127.0.0.1:6333",
                        "QDRANT_QUERY_API_KEY=qdrant-query-key",
                        "EMBEDDING_MODEL=text-embedding-3-large",
                        "EMBEDDING_DIMENSIONS=3072",
                        "HINDSIGHT_API_LLM_BASE_URL=https://llm.example.internal/v1",
                        "HINDSIGHT_API_LLM_MODEL=gpt-4o-mini",
                        "HINDSIGHT_API_LLM_API_KEY=hindsight-llm-key",
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
                    "execution-runtime-rendered-config",
                    "execution-runtime-secrets",
                    "execution-runtime-provider-config-projection",
                    "execution-runtime-qdrant-tls-ca",
                },
            )

            rendered_config = by_name["execution-runtime-rendered-config"]["data"]
            rendered_secrets = by_name["execution-runtime-secrets"]["data"]

            self.assertEqual(
                by_name["execution-runtime-rendered-config"]["kind"],
                "ConfigMap",
            )
            self.assertEqual(by_name["execution-runtime-secrets"]["kind"], "Secret")
            self.assertTrue(set(rendered_config).isdisjoint(set(rendered_secrets)))

            self.assertEqual(
                rendered_config["EXECUTION_CONTROL_RUNTIME_RELEASE"],
                "execution-control@test-sha",
            )
            self.assertEqual(
                rendered_config["EXECUTION_CONTROL_APP_API_BASE_URL"],
                "https://api-staging.example.internal",
            )
            self.assertEqual(rendered_config["QDRANT_URL"], "http://qdrant:6333")
            self.assertEqual(rendered_config["EMBEDDING_MODEL"], "text-embedding-3-large")
            self.assertEqual(rendered_config["EMBEDDING_DIMENSIONS"], "3072")
            self.assertEqual(
                rendered_config["HINDSIGHT_API_LLM_BASE_URL"],
                "https://llm.example.com/v1",
            )
            self.assertEqual(rendered_config["HINDSIGHT_API_LLM_MODEL"], "gpt-test")

            self.assertIn(
                "EXECUTION_CONTROL_SHARED_SECRET",
                rendered_secrets,
            )
            self.assertIn("QDRANT_QUERY_API_KEY", rendered_secrets)
            self.assertIn("HINDSIGHT_API_LLM_API_KEY", rendered_secrets)
            self.assertEqual(
                rendered_secrets["EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"],
                "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
            )
            self.assertEqual(
                rendered_secrets["CAMPUS_SHARED_POSTGRES_URL"],
                "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
            )
            self.assertEqual(
                rendered_secrets["INTERNAL_NOTICE_READ_MODEL_DATABASE_URL"],
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

            secret_like_pattern = re.compile(
                r"(SECRET|PASSWORD|API_KEY|AUTH_HEADER|AUTH_VALUE|DATABASE_URL|BEARER_TOKEN)"
            )
            for key in rendered_config:
                with self.subTest(config_key=key):
                    self.assertNotRegex(key, secret_like_pattern)


if __name__ == "__main__":
    unittest.main()
