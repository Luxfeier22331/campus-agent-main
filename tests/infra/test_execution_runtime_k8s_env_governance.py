from __future__ import annotations

import json
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


class ExecutionRuntimeK8sEnvGovernanceTest(unittest.TestCase):
    def test_renderer_rejects_secret_like_configmap_salt(self) -> None:
        result = _run_renderer_with_boundary_mutation(
            lambda boundary: boundary["configmaps"]["execution-runtime-rendered-config"].append(
                "PUBLIC_CACHE_SALT"
            )
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "PUBLIC_CACHE_SALT is secret-like and cannot be rendered into ConfigMap",
            result.stderr,
        )

    def test_renderer_rejects_open_typed_read_model_tools_without_profile_delivery(self) -> None:
        result = _run_renderer_with_boundary_mutation(
            lambda boundary: boundary["profiles"]["nc-arm-6c-slim"]["secrets"].remove(
                "execution-tool-read-model-secrets"
            ),
            runtime_profile_open_tools=["public_web_search", "campus_notice_discover"],
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cannot render typed tool read-model runtime", result.stderr)
        self.assertIn(
            "missing profile-owned delivery keys",
            result.stderr,
        )
        self.assertIn("CAMPUS_SHARED_POSTGRES_URL", result.stderr)


def _run_renderer_with_boundary_mutation(
    mutate_boundary,
    *,
    runtime_profile_open_tools: list[str] | None = None,
) -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        copy_staging_modules_for_tests(temp_root)
        renderer_path = temp_root / "infra" / "local" / "staging" / "render-env.sh"
        renderer_path.write_text(
            (ROOT / "infra/local/staging/render-execution-runtime-k8s-env.sh").read_text(
                encoding="utf-8"
            ),
            encoding="utf-8",
        )
        renderer_path.chmod(0o755)
        if runtime_profile_open_tools is not None:
            profile_path = (
                temp_root
                / "configs"
                / "runtime"
                / "execution-control"
                / "runtime-profile.staging.json"
            )
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            profile["open_tools"] = runtime_profile_open_tools
            profile_path.write_text(json.dumps(profile), encoding="utf-8")

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
                    "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable",
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
        mutate_boundary(boundary)
        boundary_path.write_text(json.dumps(boundary), encoding="utf-8")

        command = f"""
        set -euo pipefail
        export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env_path))}
        export EXECUTION_CONTROL_STAGING_RUNTIME_DIR={shlex.quote(str(temp_root / ".tmp"))}
        export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=test-sha
        export EXECUTION_RUNTIME_K8S_ENV_BOUNDARY_PATH={shlex.quote(str(boundary_path))}
        {shlex.quote(str(renderer_path))}
        """
        return subprocess.run(
            ["bash", "-lc", textwrap.dedent(command)],
            cwd=temp_root,
            env=os.environ.copy(),
            capture_output=True,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
