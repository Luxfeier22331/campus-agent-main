from __future__ import annotations

import json
import stat
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, urlparse


class ProviderProjectionSyncTest(unittest.TestCase):
    def test_sync_command_writes_secure_projection_artifact(self) -> None:
        server = _ProviderConfigServer()
        server.start()
        try:
            with TemporaryDirectory() as tmpdir:
                output = Path(tmpdir) / "provider-projection.json"
                result = subprocess.run(
                    [
                        "node",
                        "scripts/sync-provider-config-projection.mjs",
                        "--app-api-base-url",
                        server.base_url,
                        "--internal-shared-secret",
                        "internal-secret",
                        "--output",
                        str(output),
                        "--role",
                        "eval_ragas_llm",
                        "--role",
                        "eval_ragas_embedding",
                    ],
                    check=False,
                    cwd=Path.cwd(),
                    text=True,
                    capture_output=True,
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                payload = json.loads(output.read_text(encoding="utf-8"))
                self.assertEqual(payload["schema_version"], "provider_config_projection.v1")
                self.assertEqual(
                    sorted(payload["profiles"]),
                    ["eval_ragas_embedding", "eval_ragas_llm"],
                )
                self.assertEqual(
                    stat.S_IMODE(output.stat().st_mode),
                    stat.S_IRUSR | stat.S_IWUSR,
                )
                self.assertEqual(server.auth_headers, ["internal-secret", "internal-secret"])
        finally:
            server.close()


class _ProviderConfigServer:
    def __init__(self) -> None:
        self.auth_headers: list[str] = []
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
                profile = _profile_for_role(role)
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"profile": profile}).encode("utf-8"))

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


if __name__ == "__main__":
    unittest.main()
