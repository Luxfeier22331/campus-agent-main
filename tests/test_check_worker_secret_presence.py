from __future__ import annotations

import io
import json
import os
import subprocess
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.check_worker_secret_presence import collect_worker_secret_presence, main


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class CheckWorkerSecretPresenceTest(unittest.TestCase):
    def test_collect_worker_secret_presence_uses_env_specific_required_secrets(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / "apps" / "app-api" / "wrangler.toml",
                "\n".join(
                    [
                        'name = "app-api"',
                        "",
                        "[secrets]",
                        'required = ["ROOT_ONLY_SECRET"]',
                        "",
                        "[env.staging.secrets]",
                        'required = ["STAGING_ONLY_SECRET", "SHARED_SECRET"]',
                    ]
                )
                + "\n",
            )

            seen_commands: list[list[str]] = []

            def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                seen_commands.append(command)
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout=json.dumps([{"name": "SHARED_SECRET"}]),
                    stderr="",
                )

            status = collect_worker_secret_presence(
                repo_root=repo_root,
                env_name="staging",
                app_paths=("apps/app-api",),
                run_command=fake_run,
            )

            self.assertFalse(status["overall_ready"])
            self.assertEqual(len(seen_commands), 1)
            self.assertEqual(
                seen_commands[0][0:4],
                [
                    "node",
                    str(repo_root / "scripts" / "run-wrangler-command.mjs"),
                    "--cwd",
                    str(repo_root / "apps" / "app-api"),
                ],
            )
            self.assertEqual(seen_commands[0][4:8], ["secret", "list", "--env", "staging"])
            self.assertEqual(
                status["apps"]["apps/app-api"]["required_secrets"],
                ["SHARED_SECRET", "STAGING_ONLY_SECRET"],
            )
            self.assertEqual(
                status["apps"]["apps/app-api"]["configured_secrets"], ["SHARED_SECRET"]
            )
            self.assertEqual(
                status["apps"]["apps/app-api"]["missing_secrets"], ["STAGING_ONLY_SECRET"]
            )
            self.assertNotIn("ROOT_ONLY_SECRET", status["apps"]["apps/app-api"]["required_secrets"])

    def test_main_supports_json_output_for_ready_staging_secret_audit(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / "apps" / "public-chat-web" / "wrangler.toml",
                "\n".join(
                    [
                        'name = "public-chat-web"',
                        "",
                        "[env.staging.secrets]",
                        'required = ["SENTRY_DSN"]',
                    ]
                )
                + "\n",
            )

            def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout=json.dumps([{"name": "SENTRY_DSN"}]),
                    stderr="",
                )

            buffer = io.StringIO()
            with redirect_stdout(buffer):
                exit_code = main(
                    [
                        "--repo-root",
                        str(repo_root),
                        "--env",
                        "staging",
                        "--app",
                        "apps/public-chat-web",
                        "--json",
                    ],
                    run_command=fake_run,
                )

            payload = json.loads(buffer.getvalue())
            self.assertEqual(exit_code, 0)
            self.assertTrue(payload["overall_ready"])
            self.assertEqual(payload["env"], "staging")
            self.assertEqual(
                payload["apps"]["apps/public-chat-web"]["required_secrets"], ["SENTRY_DSN"]
            )

    def test_default_worker_secret_audit_includes_campus_web(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            for app_path in (
                "apps/app-api",
                "apps/campus-web",
                "apps/public-chat-web",
                "apps/protected-panel-web",
            ):
                _write(
                    repo_root / app_path / "wrangler.toml",
                    "\n".join(
                        [
                            f'name = "{Path(app_path).name}"',
                            "",
                            "[env.staging.secrets]",
                            'required = ["SENTRY_DSN"]',
                        ]
                    )
                    + "\n",
                )

            def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout=json.dumps([{"name": "SENTRY_DSN"}]),
                    stderr="",
                )

            status = collect_worker_secret_presence(
                repo_root=repo_root,
                env_name="staging",
                run_command=fake_run,
            )

            self.assertTrue(status["overall_ready"])
            self.assertEqual(
                sorted(status["apps"].keys()),
                [
                    "apps/app-api",
                    "apps/campus-web",
                    "apps/protected-panel-web",
                    "apps/public-chat-web",
                ],
            )

    def test_collect_worker_secret_presence_strips_ansi_noise_and_keeps_audit_command(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / "apps" / "public-chat-web" / "wrangler.toml",
                "\n".join(
                    [
                        'name = "public-chat-web"',
                        "",
                        "[env.staging.secrets]",
                        'required = ["SENTRY_DSN"]',
                    ]
                )
                + "\n",
            )

            def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                return subprocess.CompletedProcess(
                    command,
                    1,
                    stdout="\u001b[33mWARNING\u001b[0m proxy noise",
                    stderr="\u001b[31mERROR\u001b[0m auth failed",
                )

            status = collect_worker_secret_presence(
                repo_root=repo_root,
                env_name="staging",
                app_paths=("apps/public-chat-web",),
                run_command=fake_run,
            )

            app_status = status["apps"]["apps/public-chat-web"]
            self.assertFalse(app_status["ready"])
            self.assertIn("run-wrangler-command.mjs", app_status["audit_command"])
            self.assertNotIn("\u001b", app_status["error"])
            self.assertIn("WARNING proxy noise", app_status["error"])
            self.assertIn("ERROR auth failed", app_status["error"])

    def test_collect_worker_secret_presence_runs_wrangler_without_inherited_proxy_vars(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / "apps" / "public-chat-web" / "wrangler.toml",
                "\n".join(
                    [
                        'name = "public-chat-web"',
                        "",
                        "[env.staging.secrets]",
                        'required = ["SENTRY_DSN"]',
                    ]
                )
                + "\n",
            )

            seen_env: dict[str, str] = {}

            def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                nonlocal seen_env
                seen_env = dict(kwargs["env"])
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout=json.dumps([{"name": "SENTRY_DSN"}]),
                    stderr="",
                )

            collect_worker_secret_presence(
                repo_root=repo_root,
                env_name="staging",
                app_paths=("apps/public-chat-web",),
                run_command=fake_run,
            )

            self.assertNotIn("HTTP_PROXY", seen_env)
            self.assertNotIn("HTTPS_PROXY", seen_env)
            self.assertNotIn("ALL_PROXY", seen_env)
            self.assertNotIn("http_proxy", seen_env)
            self.assertNotIn("https_proxy", seen_env)
            self.assertNotIn("all_proxy", seen_env)
            self.assertIn("api.cloudflare.com", seen_env["NO_PROXY"])
            self.assertIn("api.cloudflare.com", seen_env["no_proxy"])

    def test_collect_worker_secret_presence_reports_timeout_as_classified_error(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / "apps" / "public-chat-web" / "wrangler.toml",
                "\n".join(
                    [
                        'name = "public-chat-web"',
                        "",
                        "[env.staging.secrets]",
                        'required = ["SENTRY_DSN"]',
                    ]
                )
                + "\n",
            )

            def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                raise subprocess.TimeoutExpired(command, timeout=30)

            status = collect_worker_secret_presence(
                repo_root=repo_root,
                env_name="staging",
                app_paths=("apps/public-chat-web",),
                run_command=fake_run,
            )

            app_status = status["apps"]["apps/public-chat-web"]
            self.assertFalse(app_status["ready"])
            self.assertIn("timed out", app_status["error"])
            self.assertIn("30s", app_status["error"])

    def test_collect_worker_secret_presence_retries_timeout_then_succeeds(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / "apps" / "app-api" / "wrangler.toml",
                "\n".join(
                    [
                        'name = "app-api"',
                        "",
                        "[env.staging.secrets]",
                        'required = ["BETTER_AUTH_SECRET"]',
                    ]
                )
                + "\n",
            )

            calls = 0

            def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise subprocess.TimeoutExpired(command, timeout=30)
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout=json.dumps([{"name": "BETTER_AUTH_SECRET"}]),
                    stderr="",
                )

            with patch.dict(os.environ, {"WORKER_SECRET_AUDIT_MAX_ATTEMPTS": "2"}, clear=False):
                status = collect_worker_secret_presence(
                    repo_root=repo_root,
                    env_name="staging",
                    app_paths=("apps/app-api",),
                    run_command=fake_run,
                )

            app_status = status["apps"]["apps/app-api"]
            self.assertEqual(calls, 2)
            self.assertTrue(app_status["ready"])
            self.assertIsNone(app_status["error"])
            self.assertEqual(app_status["configured_secrets"], ["BETTER_AUTH_SECRET"])

    def test_collect_worker_secret_presence_reports_retry_exhaustion(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / "apps" / "app-api" / "wrangler.toml",
                "\n".join(
                    [
                        'name = "app-api"',
                        "",
                        "[env.staging.secrets]",
                        'required = ["BETTER_AUTH_SECRET"]',
                    ]
                )
                + "\n",
            )

            calls = 0

            def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                nonlocal calls
                calls += 1
                raise subprocess.TimeoutExpired(command, timeout=30)

            with patch.dict(os.environ, {"WORKER_SECRET_AUDIT_MAX_ATTEMPTS": "3"}, clear=False):
                status = collect_worker_secret_presence(
                    repo_root=repo_root,
                    env_name="staging",
                    app_paths=("apps/app-api",),
                    run_command=fake_run,
                )

            app_status = status["apps"]["apps/app-api"]
            self.assertEqual(calls, 3)
            self.assertFalse(app_status["ready"])
            self.assertIn("after 3 attempts", app_status["error"])

    def test_collect_worker_secret_presence_surfaces_expired_wrangler_oauth_guidance(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            fake_home = Path(temp_dir) / "fake-home"
            _write(
                repo_root / "apps" / "public-chat-web" / "wrangler.toml",
                "\n".join(
                    [
                        'name = "public-chat-web"',
                        "",
                        "[env.staging.secrets]",
                        'required = ["SENTRY_DSN"]',
                    ]
                )
                + "\n",
            )
            _write(
                fake_home / ".config" / ".wrangler" / "config" / "default.toml",
                "\n".join(
                    [
                        'oauth_token = "masked-access-token"',
                        'expiration_time = "2026-04-18T20:14:50.499Z"',
                        'refresh_token = "masked-refresh-token"',
                    ]
                )
                + "\n",
            )

            def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                return subprocess.CompletedProcess(
                    command,
                    1,
                    stdout="",
                    stderr=(
                        "Failed to fetch auth token: 400 Bad Request\n"
                        "Not logged in.\n"
                        "In a non-interactive environment, it's necessary to set a "
                        "CLOUDFLARE_API_TOKEN environment variable for wrangler to work."
                    ),
                )

            with patch("scripts.check_worker_secret_presence.Path.home", return_value=fake_home):
                status = collect_worker_secret_presence(
                    repo_root=repo_root,
                    env_name="staging",
                    app_paths=("apps/public-chat-web",),
                    run_command=fake_run,
                )

            app_status = status["apps"]["apps/public-chat-web"]
            self.assertFalse(app_status["ready"])
            self.assertIn("expired at 2026-04-18T20:14:50.499Z", app_status["error"])
            self.assertIn(
                "pnpm --dir apps/public-chat-web exec wrangler login", app_status["error"]
            )
            self.assertIn("CLOUDFLARE_API_TOKEN", app_status["error"])


if __name__ == "__main__":
    unittest.main()
