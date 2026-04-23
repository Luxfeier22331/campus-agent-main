from __future__ import annotations

import http.server
import os
import socketserver
import subprocess
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[1]
STATUS_SCRIPT = (
    REPO_ROOT / "infra" / "local" / "staging" / "status-dev-backed-supervisor-staging.sh"
)
COMMON_SCRIPT = REPO_ROOT / "infra" / "local" / "staging" / "dev-backed-supervisor-common.sh"


class _ReadyzHandler(http.server.BaseHTTPRequestHandler):
    response_code = 200
    response_body = b'{"status":"ready"}'

    def do_GET(self) -> None:
        self.send_response(self.response_code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(self.response_body)))
        self.end_headers()
        self.wfile.write(self.response_body)

    def log_message(self, format: str, *args: object) -> None:
        return


class _ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True


class _ReadyzServer:
    def __init__(self, response_body: bytes) -> None:
        handler = type(
            "DynamicReadyzHandler",
            (_ReadyzHandler,),
            {"response_code": 200, "response_body": response_body},
        )
        self._server = _ThreadingTCPServer(("127.0.0.1", 0), handler)
        self.port = self._server.server_address[1]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    def __enter__(self) -> _ReadyzServer:
        self._thread.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


class DevBackedSupervisorStagingScriptsTest(unittest.TestCase):
    def test_status_check_fails_when_dependencies_are_down(self) -> None:
        with TemporaryDirectory() as temp_dir:
            runtime_dir = Path(temp_dir) / "runtime"
            environment = os.environ.copy()
            environment.update(
                {
                    "DEV_BACKED_SUPERVISOR_RUNTIME_DIR": str(runtime_dir),
                    "DEV_BACKED_SUPERVISOR_PUBLIC_BASE_URL": "http://127.0.0.1:9",
                    "DEV_BACKED_SUPERVISOR_APP_API_BASE_URL": "http://127.0.0.1:9",
                }
            )

            result = subprocess.run(
                [str(STATUS_SCRIPT), "--check"],
                cwd=REPO_ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("strict", result.stdout + result.stderr)

    def test_status_check_succeeds_when_local_public_and_app_api_readyz_are_green(self) -> None:
        with TemporaryDirectory() as temp_dir:
            runtime_dir = Path(temp_dir) / "runtime"
            supervisor_pid_file = runtime_dir / "supervisor-api.pid"
            cloudflared_pid_file = runtime_dir / "cloudflared.pid"
            runtime_dir.mkdir(parents=True, exist_ok=True)
            supervisor_pid_file.write_text(f"{os.getpid()}\n", encoding="utf-8")
            cloudflared_pid_file.write_text(f"{os.getpid()}\n", encoding="utf-8")

            app_api_body = b'{"status":"ready","dependencies":{"auth":"ready","database":"ready","supervisorApi":"ready"}}'

            with (
                _ReadyzServer(b'{"status":"ready"}') as local_server,
                _ReadyzServer(b'{"status":"ready"}') as public_server,
                _ReadyzServer(app_api_body) as app_api_server,
            ):
                environment = os.environ.copy()
                environment.update(
                    {
                        "DEV_BACKED_SUPERVISOR_RUNTIME_DIR": str(runtime_dir),
                        "DEV_BACKED_SUPERVISOR_HOST": "127.0.0.1",
                        "DEV_BACKED_SUPERVISOR_PORT": str(local_server.port),
                        "DEV_BACKED_SUPERVISOR_PUBLIC_BASE_URL": f"http://127.0.0.1:{public_server.port}",
                        "DEV_BACKED_SUPERVISOR_APP_API_BASE_URL": f"http://127.0.0.1:{app_api_server.port}",
                    }
                )

                result = subprocess.run(
                    [str(STATUS_SCRIPT), "--check"],
                    cwd=REPO_ROOT,
                    env=environment,
                    check=False,
                    capture_output=True,
                    text=True,
                )

            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("strict check: ok", result.stdout)

    def test_rotate_logs_if_needed_rolls_large_log_and_keeps_recent_history(self) -> None:
        with TemporaryDirectory() as temp_dir:
            runtime_dir = Path(temp_dir) / "runtime"
            log_dir = runtime_dir / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            current_log = log_dir / "supervisor-api.log"
            first_backup = log_dir / "supervisor-api.log.1"
            fifth_backup = log_dir / "supervisor-api.log.5"
            dropped_backup = log_dir / "supervisor-api.log.6"

            current_log.write_bytes(b"x" * (20 * 1024 * 1024 + 1))
            first_backup.write_text("older-1\n", encoding="utf-8")
            fifth_backup.write_text("older-5\n", encoding="utf-8")
            dropped_backup.write_text("older-6\n", encoding="utf-8")

            command = "\n".join(
                [
                    'source "$COMMON_SCRIPT"',
                    "dev_backed_supervisor_rotate_logs_if_needed",
                ]
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "DEV_BACKED_SUPERVISOR_RUNTIME_DIR": str(runtime_dir),
                    "COMMON_SCRIPT": str(COMMON_SCRIPT),
                }
            )

            result = subprocess.run(
                ["bash", "-lc", command],
                cwd=REPO_ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertTrue(first_backup.exists())
            self.assertEqual(first_backup.stat().st_size, 20 * 1024 * 1024 + 1)
            self.assertTrue(current_log.exists())
            self.assertEqual(current_log.stat().st_size, 0)
            self.assertFalse(dropped_backup.exists())


if __name__ == "__main__":
    unittest.main()
