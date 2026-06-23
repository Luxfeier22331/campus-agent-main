from __future__ import annotations

import json
import os
import shlex
import subprocess
import textwrap
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, urlparse

from tests.execution_control_staging_preflight_support import (
    copy_staging_modules_for_tests,
    write_provider_config_projection_for_tests,
)

ROOT = Path(__file__).resolve().parents[2]


class ExecutionControlStagingProviderProjectionBoundaryTest(unittest.TestCase):
    def test_env_loader_defaults_provider_projection_to_canonical_runtime_dir(self) -> None:
        result = _run_env_loader_with_default_provider_projection_path()

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(
            projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH"],
            projected["expectedProjectionPath"],
        )
        self.assertEqual(
            projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH"],
            "/run/campus-agent/provider-config-projection.json",
        )
        self.assertTrue(projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_UID"].isdigit())
        self.assertTrue(projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_GID"].isdigit())
        self.assertEqual(
            projected["EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH"],
            "/run/campus-agent/provider-config-projection.json",
        )
        self.assertEqual(projected["hindsightModel"], "gpt-test")
        self.assertEqual(projected["projectionMode"], "600")

    def test_env_loader_syncs_provider_projection_when_canonical_artifact_is_missing(
        self,
    ) -> None:
        server = _ProviderConfigServer()
        server.start()
        try:
            result = _run_env_loader_with_missing_provider_projection(server.base_url)

            self.assertEqual(result.returncode, 0, result.stderr)
            projected = json.loads(result.stdout)
            self.assertEqual(
                projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH"], projected["expected"]
            )
            self.assertEqual(
                projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH"],
                "/run/campus-agent/provider-config-projection.json",
            )
            self.assertTrue(projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_UID"].isdigit())
            self.assertTrue(projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_GID"].isdigit())
            self.assertEqual(projected["hindsightModel"], "gpt-5.4")
            self.assertEqual(projected["hindsightEmbeddingModel"], "Qwen3-Embedding-4B")
            self.assertEqual(projected["profileRoles"], server.roles)
            self.assertTrue(projected["projectionExists"])
            self.assertEqual(projected["projectionMode"], "600")
            self.assertTrue(all(header == "internal-secret" for header in server.auth_headers))
        finally:
            server.close()

    def test_compose_runs_provider_projection_consumers_as_artifact_owner(self) -> None:
        compose = (ROOT / "infra/local/docker-compose.execution-control-runtime.yml").read_text(
            encoding="utf-8"
        )

        for service in (
            "execution-control",
            "activity-worker-agent",
            "activity-worker-knowledge-retrieval",
            "activity-worker-knowledge-synthesis",
        ):
            with self.subTest(service=service):
                block = _compose_service_block(compose, service)
                self.assertNotIn("group_add:", block)
                self.assertIn(
                    "user: ${CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_UID:?set CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_UID}:${CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_GID:?set CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_GID}",
                    block,
                )


def _run_env_loader_with_default_provider_projection_path() -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        common_path = copy_staging_modules_for_tests(root)
        runtime_env = root / "ops" / "runtime.env"
        runtime_dir = root / ".tmp" / "execution-control-staging"
        projection_path = runtime_dir / "provider-config-projection.json"
        write_provider_config_projection_for_tests(projection_path)
        runtime_env.parent.mkdir(exist_ok=True)
        runtime_env.write_text(
            "EXECUTION_CONTROL_SHARED_SECRET=worker-secret\n",
            encoding="utf-8",
        )
        command = f"""
        set -euo pipefail
        export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env))}
        export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=test-sha
        source {shlex.quote(str(common_path))}
        execution_control_staging_load_env
        node - <<'NODE'
        const fs = require("node:fs");
        console.log(JSON.stringify({{
          expectedProjectionPath: {json.dumps(str(projection_path))},
          CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH:
            process.env.CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH,
          CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_UID:
            process.env.CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_UID,
          CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_GID:
            process.env.CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_GID,
          CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH: process.env.CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH,
          EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH:
            process.env.EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH,
          hindsightModel: process.env.HINDSIGHT_API_LLM_MODEL,
          projectionMode: (fs.statSync(process.env.CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH).mode & 0o777).toString(8),
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


def _run_env_loader_with_missing_provider_projection(
    app_api_base_url: str,
) -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        common_path = copy_staging_modules_for_tests(root)
        runtime_env = root / "ops" / "runtime.env"
        runtime_dir = root / ".tmp" / "execution-control-staging"
        projection_path = runtime_dir / "provider-config-projection.json"
        runtime_env.parent.mkdir(exist_ok=True)
        runtime_env.write_text(
            "\n".join(
                (
                    "APP_API_INTERNAL_SHARED_SECRET=internal-secret",
                    "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
                    f"EXECUTION_CONTROL_STAGING_APP_API_BASE_URL={app_api_base_url}",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        command = f"""
        set -euo pipefail
        export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env))}
        export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=test-sha
        source {shlex.quote(str(common_path))}
        execution_control_staging_load_env
        node - <<'NODE'
        const fs = require("node:fs");
        const projectionPath = process.env.CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH;
        const projection = JSON.parse(fs.readFileSync(projectionPath, "utf8"));
        console.log(JSON.stringify({{
          expected: {json.dumps(str(projection_path))},
          CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH: projectionPath,
          CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_UID:
            process.env.CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_UID,
          CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_GID:
            process.env.CAMPUS_PROVIDER_CONFIG_SNAPSHOT_OWNER_GID,
          CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH: process.env.CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH,
          hindsightModel: process.env.HINDSIGHT_API_LLM_MODEL,
          hindsightEmbeddingModel: process.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL,
          profileRoles: projection.source.roles,
          projectionExists: fs.existsSync(projectionPath),
          projectionMode: (fs.statSync(projectionPath).mode & 0o777).toString(8),
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


class _ProviderConfigServer:
    def __init__(self) -> None:
        self.auth_headers: list[str] = []
        self.roles: list[str] = []
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever)
        self._thread.daemon = True
        self.base_url = f"http://127.0.0.1:{self._server.server_port}"

    def start(self) -> None:
        self._thread.start()

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                parsed = urlparse(self.path)
                role = parse_qs(parsed.query).get("role", [""])[0]
                owner.auth_headers.append(self.headers.get("x-app-internal-auth", ""))
                owner.roles.append(role)
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"profile": _profile_for_role(role)}).encode("utf-8"))

            def log_message(self, format: str, *args: object) -> None:
                return

        return Handler


def _profile_for_role(role: str) -> dict[str, object]:
    kind = "embedding" if role.endswith("_embedding") else "prompt"
    profile: dict[str, object] = {
        "api_key": f"{role}-key",
        "base_url": "https://provider.example/v1",
        "kind": kind,
        "model": "Qwen3-Embedding-4B" if kind == "embedding" else "gpt-5.4",
        "profile_id": f"provider_profile_{role}",
        "provider": "openai-compatible",
        "revision": 3,
        "role": role,
        "timeout_ms": 30000,
        "transport": "embeddings" if kind == "embedding" else "responses",
    }
    if kind == "embedding":
        profile["dimensions"] = 2560
    return profile


def _compose_service_block(compose: str, service: str) -> str:
    marker = f"  {service}:\n"
    start = compose.find(marker)
    if start < 0:
        return ""
    next_service = compose.find("\n  ", start + len(marker))
    while next_service >= 0 and compose[next_service + 3 : next_service + 4] == " ":
        next_service = compose.find("\n  ", next_service + 1)
    if next_service < 0:
        return compose[start:]
    return compose[start:next_service]


if __name__ == "__main__":
    unittest.main()
