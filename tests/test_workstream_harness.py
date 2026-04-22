from __future__ import annotations

import json
import os
import subprocess
import unittest
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.workstream_harness import run_codex_exec_session, run_codex_shell_session
from scripts.workstream_harness_hooks import handle_event
from scripts.workstream_harness_result import (
    RESULT_SCHEMA_VERSION,
    extract_result_payload,
    validate_result_payload,
)
from scripts.workstream_harness_runtime import (
    create_run_record,
    latest_run_for_workstream,
    load_run_record,
)
from scripts.workstream_runtime import get_workstream_claim_status


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _seed_repo(root: Path, *workstreams: str) -> None:
    _write(root / "README.md", "# campus-agent\n")
    _write(
        root / ".codex" / "schemas" / "workstream_harness_result_v1.json",
        "{}\n",
    )
    for workstream in workstreams:
        _write(
            root / ".planning" / "workstreams" / workstream / "STATE.md",
            f"---\nworkstream: {workstream}\n---\n",
        )


@contextmanager
def _patched_env(**updates: str):
    original = {key: os.environ.get(key) for key in updates}
    try:
        for key, value in updates.items():
            os.environ[key] = value
        yield
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class WorkstreamHarnessResultTest(unittest.TestCase):
    def test_extracts_fenced_json_payload(self) -> None:
        payload = extract_result_payload(
            """
            Final state.

            ```json
            {
              "schema_version": "workstream_harness_result_v1",
              "result": "completed",
              "summary": "done",
              "verification": {
                "status": "passed",
                "commands": ["uv run --all-packages python -m unittest"],
                "notes": ""
              },
              "blocker": null,
              "next_action": "none"
            }
            ```
            """
        )
        self.assertIsNotNone(payload)
        self.assertEqual(payload["result"], "completed")

    def test_completed_payload_rejects_skipped_verification(self) -> None:
        payload = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "result": "completed",
            "summary": "done",
            "verification": {
                "status": "skipped",
                "commands": [],
                "notes": "not run",
            },
            "blocker": None,
            "next_action": "none",
        }
        errors = validate_result_payload(payload, tracked_changes=True)
        self.assertTrue(any("skipped" in error for error in errors))


class WorkstreamHarnessHookTest(unittest.TestCase):
    def test_pre_tool_use_denies_destructive_bash(self) -> None:
        output = handle_event(
            "PreToolUse",
            {
                "cwd": str(Path.cwd()),
                "tool_input": {"command": "git reset --hard HEAD"},
            },
        )
        self.assertEqual(output["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_stop_hook_blocks_missing_result_once(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _seed_repo(repo_root, "repo-wide-agent-harness-rollout")

            first = handle_event(
                "Stop",
                {
                    "cwd": str(repo_root),
                    "last_assistant_message": "All done.",
                    "stop_hook_active": False,
                },
            )
            second = handle_event(
                "Stop",
                {
                    "cwd": str(repo_root),
                    "last_assistant_message": "Still no JSON payload.",
                    "stop_hook_active": True,
                },
            )

            self.assertEqual(first["decision"], "block")
            self.assertFalse(second["continue"])

    def test_stop_hook_persists_valid_result(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "repo-wide-agent-harness-rollout"
            _seed_repo(repo_root, slug)
            run_id = "run-test"
            create_run_record(
                repo_root,
                run_id=run_id,
                workstream=slug,
                operator_id="alice",
                session_key="session-1",
                mode="shell",
                command=["codex"],
                claim_id="claim-1",
            )

            message = json.dumps(
                {
                    "schema_version": RESULT_SCHEMA_VERSION,
                    "result": "completed",
                    "summary": "done",
                    "verification": {
                        "status": "not_applicable",
                        "commands": [],
                        "notes": "docs-only",
                    },
                    "blocker": None,
                    "next_action": "none",
                }
            )

            with _patched_env(
                CAMPUS_WORKSTREAM_RUN_ID=run_id,
                CAMPUS_WORKSTREAM_REPO_ROOT=str(repo_root),
                GSD_WORKSTREAM=slug,
            ):
                result = handle_event(
                    "Stop",
                    {
                        "cwd": str(repo_root),
                        "last_assistant_message": message,
                        "stop_hook_active": False,
                    },
                )

            self.assertIsNone(result)
            persisted = load_run_record(repo_root, run_id)
            self.assertEqual(persisted["result"], "completed")
            self.assertEqual(persisted["state"], "completed")


class WorkstreamHarnessRunnerTest(unittest.TestCase):
    def test_codex_exec_session_records_completed_result(self) -> None:
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
                                "notes": "fixture run",
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

            self.assertEqual(exit_code, 0)
            latest = latest_run_for_workstream(repo_root, slug)
            self.assertEqual(latest["mode"], "exec")
            self.assertEqual(latest["result"], "completed")
            self.assertEqual(
                get_workstream_claim_status(repo_root, slug)["effective_status"], "unclaimed"
            )

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


if __name__ == "__main__":
    unittest.main()
