from __future__ import annotations

import os
import shlex
import subprocess
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.execution_control_staging_preflight_support import (
    copy_staging_modules_for_tests,
    write_provider_config_projection_for_tests,
)

ROOT = Path(__file__).resolve().parents[2]


class ExecutionRuntimeK8sSecretRendererTest(unittest.TestCase):
    def test_projects_local_postgres_urls_to_service_dns(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            common_path = copy_staging_modules_for_tests(temp_root)
            renderer_path = temp_root / "infra" / "local" / "staging" / "render-secrets.sh"
            renderer_path.write_text(
                (ROOT / "infra/local/staging/render-execution-runtime-k8s-secrets.sh").read_text(
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
            captured_env_path = temp_root / "captured-k8s-secret.env"
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
                        f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH={projection_path}",
                        f"QDRANT_TLS_CA_CERT_PATH={qdrant_ca_path}",
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
                    f"""\
                    #!/usr/bin/env bash
                    set -euo pipefail
                    previous=""
                    for arg in "$@"; do
                      if [[ "${{previous}}" == "--from-env-file" ]]; then
                        cp "${{arg}}" {shlex.quote(str(captured_env_path))}
                      fi
                      previous="${{arg}}"
                    done
                    printf '%s\\n' 'apiVersion: v1' 'kind: Secret'
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
            {shlex.quote(str(renderer_path))} >/dev/null
            """
            result = subprocess.run(
                ["bash", "-lc", textwrap.dedent(command)],
                cwd=temp_root,
                env=os.environ.copy(),
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            captured = captured_env_path.read_text(encoding="utf-8")
            self.assertIn(
                "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
                captured,
            )
            self.assertIn(
                "CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
                captured,
            )
            self.assertIn(
                "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL=postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
                captured,
            )
            self.assertNotIn(
                "RUN_PROJECTION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1", captured
            )
            self.assertNotIn(
                "CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@localhost", captured
            )
            self.assertNotIn(
                "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1",
                captured,
            )


if __name__ == "__main__":
    unittest.main()
