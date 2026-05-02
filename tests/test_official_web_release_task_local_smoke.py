from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from campus_ingestion_core.official_web_release_task_store import (
    InMemoryOfficialWebReleaseTaskStore,
)

from scripts.official_web_release_task_local_smoke import (
    run_official_web_release_task_local_smoke,
)


class _SmokeAppApiHandler(BaseHTTPRequestHandler):
    snapshots: dict[str, dict[str, Any]] = {}

    def do_POST(self) -> None:
        if self.path != "/api/internal/operator/official-web/release-task-snapshots":
            self.send_error(404)
            return
        if self.headers.get("x-app-internal-auth") != "trusted-secret":
            self.send_error(401)
            return
        length = int(self.headers.get("content-length") or "0")
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        for snapshot in payload["snapshots"]:
            self.snapshots[snapshot["taskId"]] = snapshot
        body = json.dumps({"accepted": len(payload["snapshots"])}).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        prefix = "/api/operator/official-web/release-tasks/"
        if not self.path.startswith(prefix):
            self.send_error(404)
            return
        if self.headers.get("x-app-internal-auth") != "trusted-secret":
            self.send_error(401)
            return
        task_id = self.path.removeprefix(prefix)
        snapshot = self.snapshots.get(task_id)
        if not snapshot:
            self.send_error(404)
            return
        body = json.dumps({"task": snapshot}).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_: object) -> None:
        return


class OfficialWebReleaseTaskLocalSmokeTest(unittest.TestCase):
    def test_smoke_advances_task_posts_projection_and_reads_app_api_detail(self) -> None:
        _SmokeAppApiHandler.snapshots = {}
        server = HTTPServer(("127.0.0.1", 0), _SmokeAppApiHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_port}"

        try:
            with TemporaryDirectory() as temp_dir:
                report = run_official_web_release_task_local_smoke(
                    app_api_base_url=base_url,
                    app_api_internal_shared_secret="trusted-secret",
                    operator_email="ops@example.com",
                    release_store=InMemoryOfficialWebReleaseTaskStore(),
                    task_id="owrelease_local_smoke_test",
                    work_dir=Path(temp_dir),
                    worker_id="worker-smoke",
                )
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()

        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["task"]["taskId"], "owrelease_local_smoke_test")
        self.assertEqual(report["task"]["lifecycleStatus"], "published")
        self.assertEqual(report["releaseTaskRunner"]["status"], "published")


if __name__ == "__main__":
    unittest.main()
