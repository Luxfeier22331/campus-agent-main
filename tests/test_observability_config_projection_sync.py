from __future__ import annotations

import json
import stat
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory


class ObservabilityProjectionSyncTest(unittest.TestCase):
    def test_sync_command_writes_secure_projection_artifact_without_leaking_auth(self) -> None:
        server = _ObservabilityConfigServer()
        server.start()
        try:
            with TemporaryDirectory() as tmpdir:
                output = Path(tmpdir) / "observability-projection.json"
                result = subprocess.run(
                    [
                        "node",
                        "scripts/sync-observability-config-projection.mjs",
                        "--app-api-base-url",
                        server.base_url,
                        "--internal-shared-secret",
                        "internal-secret",
                        "--output",
                        str(output),
                    ],
                    check=False,
                    cwd=Path.cwd(),
                    text=True,
                    capture_output=True,
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                payload = json.loads(output.read_text(encoding="utf-8"))
                self.assertEqual(payload["schema_version"], "observability_config_projection.v1")
                self.assertEqual(
                    payload["llm_debug_trace"]["schema_version"],
                    "llm_debug_trace_config.v1",
                )
                self.assertEqual(
                    payload["llm_debug_trace"]["langfuse_otlp"]["auth_header"],
                    "Basic langfuse-secret",
                )
                self.assertEqual(
                    stat.S_IMODE(output.stat().st_mode),
                    stat.S_IRUSR | stat.S_IWUSR,
                )
                self.assertEqual(server.auth_headers, ["internal-secret"])
                self.assertNotIn("Basic langfuse-secret", result.stdout)
                self.assertNotIn("Basic langfuse-secret", result.stderr)
        finally:
            server.close()


class _ObservabilityConfigServer:
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
                owner.auth_headers.append(self.headers.get("x-app-internal-auth", ""))
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "config": {
                                "schema_version": "llm_debug_trace_config.v1",
                                "mode": "langfuse_otlp",
                                "include_model_io": False,
                                "sample_ratio": 1,
                                "langfuse_otlp": {
                                    "endpoint": "https://cloud.langfuse.com/api/public/otel",
                                    "auth_header": "Basic langfuse-secret",
                                    "public_trace_base_url": "https://cloud.langfuse.com/project/demo/traces",
                                },
                            }
                        }
                    ).encode("utf-8")
                )

            def log_message(self, format: str, *args: object) -> None:
                return

        return Handler


if __name__ == "__main__":
    unittest.main()
