from __future__ import annotations

import io
import json
import os
import unittest
from contextlib import contextmanager, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.workstream_harness import (
    _exec_command,
    _shell_command,
    parse_args,
)
from scripts.workstream_harness import (
    main as workstream_harness_main,
)
from scripts.workstream_harness_hooks import handle_event
from scripts.workstream_harness_result import (
    RESULT_SCHEMA_VERSION,
    extract_result_payload,
    normalize_result_payload,
    validate_result_payload,
)
from scripts.workstream_harness_runtime import (
    create_run_record,
    load_run_record,
    result_file_path,
)


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

    def test_rejects_legacy_success_result_and_verification_array(self) -> None:
        payload = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "result": "success",
            "summary": "done",
            "verification": [
                {
                    "command": "pnpm web:lint",
                    "result": "passed",
                    "details": "Checked 670 files in 4s. No fixes applied.",
                },
                {
                    "command": "pnpm web:test",
                    "result": "success",
                    "details": "All tests passed.",
                },
            ],
            "blocker": None,
            "next_action": "commit",
            "extra_field": "ignored",
        }

        normalized, notes = normalize_result_payload(payload)
        errors = validate_result_payload(normalized, tracked_changes=True)

        self.assertEqual(normalized["result"], "success")
        self.assertEqual(normalized["verification"], payload["verification"])
        self.assertTrue(any("result 必须" in error for error in errors))
        self.assertTrue(any("verification 必须" in error for error in errors))
        self.assertEqual(
            set(normalized.keys()),
            {
                "schema_version",
                "result",
                "summary",
                "verification",
                "blocker",
                "next_action",
            },
        )
        self.assertEqual(notes, [])

    def test_rejects_legacy_verification_object_keys(self) -> None:
        payload = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "result": "completed",
            "summary": "done",
            "verification": {
                "command": "pnpm web:lint",
                "result": "success",
                "details": "lint passed",
            },
            "blocker": None,
            "next_action": "none",
        }

        normalized, notes = normalize_result_payload(payload)
        errors = validate_result_payload(normalized, tracked_changes=True)

        self.assertEqual(normalized["verification"], payload["verification"])
        self.assertTrue(any("verification.status 不合法" in error for error in errors))
        self.assertEqual(notes, [])


class WorkstreamHarnessHookTest(unittest.TestCase):
    def test_shell_command_injects_runtime_hooks_config(self) -> None:
        command = _shell_command(
            Path("/repo"),
            model=None,
            profile=None,
            sandbox="danger-full-access",
            approval_policy="never",
            codex_args=[],
        )

        self.assertIn("--enable", command)
        self.assertIn("codex_hooks", command)
        config = command[command.index("-c") + 1]
        self.assertTrue(config.startswith("hooks="))
        self.assertIn("SessionStart", config)
        self.assertIn("PreToolUse", config)
        self.assertIn("PermissionRequest", config)
        self.assertIn("Stop", config)
        self.assertIn("scripts.workstream_harness_hooks", config)

    def test_exec_command_injects_runtime_hooks_config(self) -> None:
        command = _exec_command(
            Path("/repo"),
            model=None,
            profile=None,
            sandbox="danger-full-access",
            prompt="do work",
            output_last_message_path=Path("/repo/.planning/runtime/harness/message.txt"),
            skip_git_repo_check=True,
        )

        self.assertIn("--enable", command)
        self.assertIn("codex_hooks", command)
        config = command[command.index("-c") + 1]
        self.assertTrue(config.startswith("hooks="))
        self.assertIn("SessionStart", config)
        self.assertIn("PreToolUse", config)
        self.assertIn("PermissionRequest", config)
        self.assertIn("Stop", config)
        self.assertIn("scripts.workstream_harness_hooks", config)

    def test_session_start_is_noop_outside_harness_session(self) -> None:
        output = handle_event(
            "SessionStart",
            {
                "cwd": str(Path.cwd()),
                "source": "startup",
                "session_id": "session-discuss",
            },
        )
        self.assertIsNone(output)

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
            slug = "repo-wide-agent-harness-rollout"
            run_id = "run-missing"
            _seed_repo(repo_root, slug)
            create_run_record(
                repo_root,
                run_id=run_id,
                workstream=slug,
                operator_id="alice",
                session_key="session-missing",
                mode="shell",
                command=["codex"],
                claim_id="claim-missing",
                artifacts={"result_path": str(result_file_path(repo_root, run_id))},
            )

            with _patched_env(
                CAMPUS_WORKSTREAM_RUN_ID=run_id,
                CAMPUS_WORKSTREAM_REPO_ROOT=str(repo_root),
                CAMPUS_WORKSTREAM_RESULT_PATH=str(result_file_path(repo_root, run_id)),
                CAMPUS_WORKSTREAM_HARNESS_MODE="shell",
                GSD_WORKSTREAM=slug,
            ):
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

    def test_stop_hook_persists_result_artifact_without_visible_json(self) -> None:
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
                artifacts={"result_path": str(result_file_path(repo_root, run_id))},
            )
            _write(
                result_file_path(repo_root, run_id),
                json.dumps(
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
                ),
            )

            with _patched_env(
                CAMPUS_WORKSTREAM_RUN_ID=run_id,
                CAMPUS_WORKSTREAM_REPO_ROOT=str(repo_root),
                CAMPUS_WORKSTREAM_RESULT_PATH=str(result_file_path(repo_root, run_id)),
                CAMPUS_WORKSTREAM_HARNESS_MODE="shell",
                GSD_WORKSTREAM=slug,
            ):
                result = handle_event(
                    "Stop",
                    {
                        "cwd": str(repo_root),
                        "last_assistant_message": "Human-readable closeout without machine JSON.",
                        "stop_hook_active": False,
                    },
                )

            self.assertIsNone(result)
            persisted = load_run_record(repo_root, run_id)
            self.assertEqual(persisted["result"], "completed")
            self.assertEqual(persisted["state"], "completed")
            self.assertEqual(persisted["result_source"], "result_file")

    def test_stop_hook_ignores_last_assistant_message_when_result_file_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "repo-wide-agent-harness-rollout"
            _seed_repo(repo_root, slug)
            run_id = "run-missing-result"
            create_run_record(
                repo_root,
                run_id=run_id,
                workstream=slug,
                operator_id="alice",
                session_key="session-missing-result",
                mode="shell",
                command=["codex"],
                claim_id="claim-missing-result",
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
                CAMPUS_WORKSTREAM_RESULT_PATH=str(result_file_path(repo_root, run_id)),
                CAMPUS_WORKSTREAM_HARNESS_MODE="shell",
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

            self.assertEqual(result["decision"], "block")
            self.assertIn("write a canonical workstream result artifact", result["reason"])

    def test_stop_hook_blocks_unreadable_result_artifact(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "repo-wide-agent-harness-rollout"
            _seed_repo(repo_root, slug)
            run_id = "run-invalid-artifact"
            create_run_record(
                repo_root,
                run_id=run_id,
                workstream=slug,
                operator_id="alice",
                session_key="session-invalid-artifact",
                mode="shell",
                command=["codex"],
                claim_id="claim-invalid-artifact",
                artifacts={"result_path": str(result_file_path(repo_root, run_id))},
            )
            _write(result_file_path(repo_root, run_id), "{invalid json")

            message = json.dumps(
                {
                    "schema_version": RESULT_SCHEMA_VERSION,
                    "result": "completed",
                    "summary": "artifact should take precedence",
                    "verification": {
                        "status": "not_applicable",
                        "commands": [],
                        "notes": "artifact should take precedence",
                    },
                    "blocker": None,
                    "next_action": "none",
                }
            )

            with _patched_env(
                CAMPUS_WORKSTREAM_RUN_ID=run_id,
                CAMPUS_WORKSTREAM_REPO_ROOT=str(repo_root),
                CAMPUS_WORKSTREAM_RESULT_PATH=str(result_file_path(repo_root, run_id)),
                CAMPUS_WORKSTREAM_HARNESS_MODE="shell",
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

            self.assertEqual(result["decision"], "block")
            self.assertIn("unreadable workstream result artifact", result["reason"])


class WorkstreamHarnessCliTest(unittest.TestCase):
    def test_exec_parser_accepts_options_after_workstream(self) -> None:
        args = parse_args(
            [
                "codex",
                "exec",
                "repo-wide-agent-harness-rollout",
                "--operator-id",
                "codex",
                "--session-key",
                "acceptance-smoke",
                "--skip-git-repo-check",
                "--",
                "run acceptance smoke",
            ]
        )

        self.assertEqual(args.command, "codex")
        self.assertEqual(args.codex_command, "exec")
        self.assertEqual(args.workstream, "repo-wide-agent-harness-rollout")
        self.assertEqual(args.operator_id, "codex")
        self.assertEqual(args.session_key, "acceptance-smoke")
        self.assertTrue(args.skip_git_repo_check)
        self.assertEqual(args.prompt, ["run acceptance smoke"])

    def test_result_write_writes_canonical_artifact(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "repo-wide-agent-harness-rollout"
            run_id = "run-cli"
            _seed_repo(repo_root, slug)
            create_run_record(
                repo_root,
                run_id=run_id,
                workstream=slug,
                operator_id="alice",
                session_key="session-cli",
                mode="shell",
                command=["codex"],
                claim_id="claim-cli",
            )

            stdout = io.StringIO()
            with (
                _patched_env(
                    CAMPUS_WORKSTREAM_RUN_ID=run_id,
                    CAMPUS_WORKSTREAM_REPO_ROOT=str(repo_root),
                    CAMPUS_WORKSTREAM_RESULT_PATH=str(result_file_path(repo_root, run_id)),
                ),
                redirect_stdout(stdout),
            ):
                exit_code = workstream_harness_main(
                    [
                        "--repo-root",
                        str(repo_root),
                        "result",
                        "write",
                        "--result",
                        "completed",
                        "--summary",
                        "implemented",
                        "--verification-status",
                        "not_applicable",
                        "--verification-notes",
                        "docs-only",
                        "--next-action",
                        "none",
                    ]
                )

            self.assertEqual(exit_code, 0)
            self.assertEqual(stdout.getvalue(), "")
            persisted = json.loads(result_file_path(repo_root, run_id).read_text(encoding="utf-8"))
            self.assertEqual(persisted["result"], "completed")
            self.assertEqual(persisted["verification"]["notes"], "docs-only")

    def test_result_write_rejects_blocked_without_blocker(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "repo-wide-agent-harness-rollout"
            run_id = "run-cli-blocked"
            _seed_repo(repo_root, slug)
            create_run_record(
                repo_root,
                run_id=run_id,
                workstream=slug,
                operator_id="alice",
                session_key="session-cli-blocked",
                mode="shell",
                command=["codex"],
                claim_id="claim-cli-blocked",
            )

            with (
                _patched_env(
                    CAMPUS_WORKSTREAM_RUN_ID=run_id,
                    CAMPUS_WORKSTREAM_REPO_ROOT=str(repo_root),
                    CAMPUS_WORKSTREAM_RESULT_PATH=str(result_file_path(repo_root, run_id)),
                ),
                self.assertRaisesRegex(ValueError, "blocked 结果必须提供 blocker"),
            ):
                workstream_harness_main(
                    [
                        "--repo-root",
                        str(repo_root),
                        "result",
                        "write",
                        "--result",
                        "blocked",
                        "--summary",
                        "waiting",
                        "--verification-status",
                        "not_applicable",
                        "--next-action",
                        "need external input",
                    ]
                )


if __name__ == "__main__":
    unittest.main()
