from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.workstream_harness import run_codex_exec_session, run_codex_shell_session
from scripts.workstream_harness_result import RESULT_SCHEMA_VERSION
from scripts.workstream_harness_runtime import latest_run_for_workstream
from scripts.workstream_runtime import get_workstream_claim_status
from tests.test_workstream_harness import _seed_repo, _write


class WorkstreamHarnessRunnerTest(unittest.TestCase):
    def test_codex_exec_session_requires_result_artifact(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "repo-wide-agent-harness-rollout"
            _seed_repo(repo_root, slug)

            def fake_runner(
                argv: list[str],
                *,
                cwd: Path,
                env: dict[str, str],
            ) -> subprocess.CompletedProcess[str]:
                self.assertNotIn("--json", argv)
                output_index = argv.index("-o") + 1
                output_path = Path(argv[output_index])
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_text(
                    json.dumps(
                        {
                            "schema_version": RESULT_SCHEMA_VERSION,
                            "result": "completed",
                            "summary": "assistant message should not count",
                            "verification": {
                                "status": "not_applicable",
                                "commands": [],
                                "notes": "assistant message only",
                            },
                            "blocker": None,
                            "next_action": "none",
                        }
                    ),
                    encoding="utf-8",
                )
                return subprocess.CompletedProcess(argv, 0, stdout='{"event":"done"}\n', stderr="")

            exit_code = run_codex_exec_session(
                repo_root=repo_root,
                workstream=slug,
                operator_id="alice",
                session_key="session-exec",
                model=None,
                profile=None,
                sandbox="workspace-write",
                prompt="Implement the task.",
                skip_git_repo_check=False,
                lease_seconds=1200,
                heartbeat_interval_seconds=600,
                runner=fake_runner,
            )

            self.assertEqual(exit_code, 21)
            latest = latest_run_for_workstream(repo_root, slug)
            self.assertEqual(latest["mode"], "exec")
            self.assertEqual(latest["result"], "failed_needs_repair")
            self.assertEqual(latest["result_source"], "synthetic_failure")
            self.assertEqual(
                get_workstream_claim_status(repo_root, slug)["effective_status"], "unclaimed"
            )

    def test_codex_exec_session_records_completed_result_from_artifact(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "repo-wide-agent-harness-rollout"
            _seed_repo(repo_root, slug)

            def fake_runner(
                argv: list[str],
                *,
                cwd: Path,
                env: dict[str, str],
            ) -> subprocess.CompletedProcess[str]:
                self.assertNotIn("--json", argv)
                output_index = argv.index("-o") + 1
                output_path = Path(argv[output_index])
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_text(
                    json.dumps(
                        {
                            "schema_version": RESULT_SCHEMA_VERSION,
                            "result": "completed",
                            "summary": "implemented",
                            "verification": {
                                "status": "not_applicable",
                                "commands": [],
                                "notes": "assistant output for audit only",
                            },
                            "blocker": None,
                            "next_action": "none",
                        }
                    ),
                    encoding="utf-8",
                )
                _write(
                    Path(env["CAMPUS_WORKSTREAM_RESULT_PATH"]),
                    json.dumps(
                        {
                            "schema_version": RESULT_SCHEMA_VERSION,
                            "result": "completed",
                            "summary": "artifact result",
                            "verification": {
                                "status": "passed",
                                "commands": ["pnpm web:lint"],
                                "notes": "lint passed",
                            },
                            "blocker": None,
                            "next_action": "none",
                        }
                    ),
                )
                return subprocess.CompletedProcess(argv, 0, stdout='{"event":"done"}\n', stderr="")

            exit_code = run_codex_exec_session(
                repo_root=repo_root,
                workstream=slug,
                operator_id="alice",
                session_key="session-exec-artifact",
                model=None,
                profile=None,
                sandbox="workspace-write",
                prompt="Implement the task.",
                skip_git_repo_check=False,
                lease_seconds=1200,
                heartbeat_interval_seconds=600,
                runner=fake_runner,
            )

            self.assertEqual(exit_code, 0)
            latest = latest_run_for_workstream(repo_root, slug)
            self.assertEqual(latest["result"], "completed")
            self.assertEqual(latest["verification"]["status"], "passed")
            self.assertEqual(latest["result_source"], "result_file")

    def test_codex_shell_session_finalizes_result_artifact_without_stop_hook(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "repo-wide-agent-harness-rollout"
            _seed_repo(repo_root, slug)

            def fake_runner(
                argv: list[str],
                *,
                cwd: Path,
                env: dict[str, str],
            ) -> subprocess.CompletedProcess[str]:
                _write(
                    Path(env["CAMPUS_WORKSTREAM_RESULT_PATH"]),
                    json.dumps(
                        {
                            "schema_version": RESULT_SCHEMA_VERSION,
                            "result": "completed",
                            "summary": "artifact result",
                            "verification": {
                                "status": "passed",
                                "commands": ["pnpm web:lint"],
                                "notes": "lint passed",
                            },
                            "blocker": None,
                            "next_action": "none",
                        }
                    ),
                )
                return subprocess.CompletedProcess(argv, 0)

            exit_code = run_codex_shell_session(
                repo_root=repo_root,
                workstream=slug,
                operator_id="alice",
                session_key="session-shell-artifact",
                model=None,
                profile=None,
                sandbox="workspace-write",
                approval_policy="on-request",
                codex_args=[],
                lease_seconds=1200,
                heartbeat_interval_seconds=600,
                runner=fake_runner,
            )

            self.assertEqual(exit_code, 0)
            latest = latest_run_for_workstream(repo_root, slug)
            self.assertEqual(latest["result"], "completed")
            self.assertEqual(latest["result_source"], "result_file")

    def test_codex_shell_session_fails_without_persisted_result(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "repo-wide-agent-harness-rollout"
            _seed_repo(repo_root, slug)

            def fake_runner(
                argv: list[str],
                *,
                cwd: Path,
                env: dict[str, str],
            ) -> subprocess.CompletedProcess[str]:
                return subprocess.CompletedProcess(argv, 0)

            exit_code = run_codex_shell_session(
                repo_root=repo_root,
                workstream=slug,
                operator_id="alice",
                session_key="session-shell",
                model=None,
                profile=None,
                sandbox="workspace-write",
                approval_policy="on-request",
                codex_args=[],
                lease_seconds=1200,
                heartbeat_interval_seconds=600,
                runner=fake_runner,
            )

            self.assertEqual(exit_code, 21)
            latest = latest_run_for_workstream(repo_root, slug)
            self.assertEqual(latest["result"], "failed_needs_repair")
            self.assertEqual(latest["result_source"], "synthetic_failure")


if __name__ == "__main__":
    unittest.main()
