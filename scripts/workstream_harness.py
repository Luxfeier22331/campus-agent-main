from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import uuid
from pathlib import Path

from .workstream_claim import run_session_command
from .workstream_harness_cli import parse_args
from .workstream_harness_result import (
    RESULT_SCHEMA_VERSION,
    has_tracked_changes,
    resolve_terminal_result,
    validate_result_payload,
    write_result_artifact,
)
from .workstream_harness_runtime import (
    append_run_event,
    assistant_message_file_path,
    create_run_record,
    event_file_path,
    latest_run_for_workstream,
    load_run_record,
    result_file_path,
    run_file_path,
    update_run_record,
)
from .workstream_runtime import (
    collect_claim_doctor_status,
    get_workstream_claim_status,
    resolve_current_workstream,
    resolve_operator_id,
    resolve_repo_root,
    resolve_session_key,
)

RESULT_EXIT_CODES = {
    "completed": 0,
    "blocked": 20,
    "failed_needs_repair": 21,
}


def _subprocess_exec_runner(
    argv: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        cwd=str(cwd),
        env=env,
        check=False,
        text=True,
        capture_output=True,
    )


def _subprocess_shell_runner(
    argv: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        cwd=str(cwd),
        env=env,
        check=False,
    )


def _print_payload(payload: object, *, as_json: bool) -> None:
    if as_json or isinstance(payload, dict):
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    print(payload)


def _toml_inline(value: object) -> str:
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return "[" + ",".join(_toml_inline(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(f"{key}={_toml_inline(item)}" for key, item in value.items()) + "}"
    raise TypeError(f"unsupported TOML inline value: {type(value).__name__}")


def _hook_command(repo_root: Path, event: str) -> str:
    repo = shlex.quote(str(repo_root))
    return f"cd {repo} && /usr/bin/python3 -m scripts.workstream_harness_hooks {event}"


def _codex_hooks_config(repo_root: Path) -> str:
    def command_hook(event: str, *, status_message: str, timeout: int) -> dict[str, object]:
        return {
            "type": "command",
            "command": _hook_command(repo_root, event),
            "statusMessage": status_message,
            "timeout": timeout,
        }

    hooks = {
        "SessionStart": [
            {
                "matcher": "startup|resume",
                "hooks": [
                    command_hook(
                        "session-start",
                        status_message="Loading workstream harness contract",
                        timeout=10,
                    )
                ],
            }
        ],
        "PreToolUse": [
            {
                "matcher": "Bash",
                "hooks": [
                    command_hook(
                        "pre-tool-use",
                        status_message="Checking destructive Bash commands",
                        timeout=10,
                    )
                ],
            }
        ],
        "PermissionRequest": [
            {
                "matcher": "Bash",
                "hooks": [
                    command_hook(
                        "permission-request",
                        status_message="Checking repo risk gates",
                        timeout=10,
                    )
                ],
            }
        ],
        "Stop": [
            {
                "hooks": [
                    command_hook(
                        "stop",
                        status_message="Validating harness result",
                        timeout=15,
                    )
                ],
            }
        ],
    }
    return "hooks=" + _toml_inline(hooks)


def _shell_command(
    repo_root: Path,
    *,
    model: str | None,
    profile: str | None,
    sandbox: str,
    approval_policy: str,
    codex_args: list[str],
) -> list[str]:
    command = [
        "codex",
        "--enable",
        "codex_hooks",
        "-c",
        _codex_hooks_config(repo_root),
        "--cd",
        str(repo_root),
        "--sandbox",
        sandbox,
        "--ask-for-approval",
        approval_policy,
    ]
    if profile:
        command.extend(["--profile", profile])
    if model:
        command.extend(["--model", model])
    command.extend(codex_args)
    return command


def _exec_command(
    repo_root: Path,
    *,
    model: str | None,
    profile: str | None,
    sandbox: str,
    prompt: str,
    output_last_message_path: Path,
    skip_git_repo_check: bool,
) -> list[str]:
    command = [
        "codex",
        "exec",
        "--enable",
        "codex_hooks",
        "-c",
        _codex_hooks_config(repo_root),
        "--cd",
        str(repo_root),
        "--sandbox",
        sandbox,
        "-o",
        str(output_last_message_path),
    ]
    if profile:
        command.extend(["--profile", profile])
    if model:
        command.extend(["--model", model])
    if skip_git_repo_check:
        command.append("--skip-git-repo-check")
    command.append(prompt)
    return command


def _write_exec_stream_artifacts(
    repo_root: Path,
    *,
    run_id: str,
    stdout: str,
    stderr: str,
) -> None:
    events_path = event_file_path(repo_root, run_id)
    events_path.parent.mkdir(parents=True, exist_ok=True)
    if stdout:
        with events_path.open("a", encoding="utf-8") as handle:
            for line in stdout.splitlines():
                handle.write(
                    json.dumps({"stream": "stdout", "line": line}, ensure_ascii=False) + "\n"
                )
    if stderr:
        with events_path.open("a", encoding="utf-8") as handle:
            for line in stderr.splitlines():
                handle.write(
                    json.dumps({"stream": "stderr", "line": line}, ensure_ascii=False) + "\n"
                )


def _finish_exec_run(
    repo_root: Path,
    *,
    run_id: str,
    process_result: subprocess.CompletedProcess[str],
    result_artifact_path: Path,
) -> int:
    resolution = resolve_terminal_result(
        result_artifact_path=result_artifact_path,
    )
    payload = resolution["payload"]
    source = resolution["source"]

    normalization_notes = resolution["normalization_notes"]
    if normalization_notes:
        append_run_event(
            repo_root,
            run_id=run_id,
            event_type="result_normalized",
            details={
                "notes": normalization_notes,
                "normalized_result": payload.get("result") if isinstance(payload, dict) else None,
                "source": source,
            },
        )

    if payload is None:
        hard_error = resolution["hard_error"]
        payload = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "result": "failed_needs_repair",
            "summary": (
                "Codex exec finished with an unreadable terminal result artifact."
                if hard_error
                else "Codex exec finished without a valid harness result payload."
            ),
            "verification": {
                "status": "failed" if process_result.returncode else "not_applicable",
                "commands": [],
                "notes": hard_error
                if isinstance(hard_error, str) and hard_error
                else "The exec wrapper could not resolve any terminal harness result payload.",
            },
            "blocker": None,
            "next_action": "Resume the run and write a valid harness result artifact before exit.",
        }
        source = "synthetic_failure"
    else:
        errors = validate_result_payload(payload, tracked_changes=has_tracked_changes(repo_root))
        if errors:
            payload = {
                "schema_version": RESULT_SCHEMA_VERSION,
                "result": "failed_needs_repair",
                "summary": "Codex exec returned an invalid harness result payload.",
                "verification": {
                    "status": "failed",
                    "commands": [],
                    "notes": "；".join(errors),
                },
                "blocker": None,
                "next_action": "Resume the run, fix the result artifact, and stop again.",
            }
            source = source or "synthetic_failure"

    update_run_record(
        repo_root,
        run_id=run_id,
        updates={
            "state": payload["result"],
            "result": payload["result"],
            "summary": payload["summary"],
            "verification": payload["verification"],
            "blocker": payload["blocker"],
            "result_payload": payload,
            "result_source": source,
            "exit_code": RESULT_EXIT_CODES[str(payload["result"])],
        },
    )
    append_run_event(
        repo_root,
        run_id=run_id,
        event_type="exec_finished",
        details={
            "result": payload["result"],
            "process_returncode": process_result.returncode,
            "result_source": source,
        },
    )
    return RESULT_EXIT_CODES[str(payload["result"])]


def _finalize_shell_run_if_needed(
    repo_root: Path,
    *,
    run_id: str,
    process_returncode: int,
    result_artifact_path: Path,
) -> None:
    existing = load_run_record(repo_root, run_id)
    if existing is None or str(existing.get("state")) != "running":
        return

    resolution = resolve_terminal_result(result_artifact_path=result_artifact_path)
    payload = resolution["payload"]
    source = resolution["source"]

    normalization_notes = resolution["normalization_notes"]
    if normalization_notes:
        append_run_event(
            repo_root,
            run_id=run_id,
            event_type="result_normalized",
            details={
                "notes": normalization_notes,
                "normalized_result": payload.get("result") if isinstance(payload, dict) else None,
                "source": source,
            },
        )

    if payload is None:
        hard_error = resolution["hard_error"]
        payload = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "result": "failed_needs_repair",
            "summary": (
                "Interactive shell exited with an unreadable terminal result artifact."
                if hard_error
                else "Interactive shell exited without a terminal result artifact."
            ),
            "verification": {
                "status": "failed" if process_returncode else "not_applicable",
                "commands": [],
                "notes": hard_error
                if isinstance(hard_error, str) and hard_error
                else "The shell exited before any valid terminal result artifact was written.",
            },
            "blocker": None,
            "next_action": "Resume the run and write a valid harness result artifact before exit.",
        }
        source = "synthetic_failure"
    else:
        errors = validate_result_payload(payload, tracked_changes=has_tracked_changes(repo_root))
        if errors:
            payload = {
                "schema_version": RESULT_SCHEMA_VERSION,
                "result": "failed_needs_repair",
                "summary": "Interactive shell exited with an invalid terminal result artifact.",
                "verification": {
                    "status": "failed",
                    "commands": [],
                    "notes": "；".join(errors),
                },
                "blocker": None,
                "next_action": "Resume the run, fix the result artifact, and stop again.",
            }
            source = source or "synthetic_failure"

    update_run_record(
        repo_root,
        run_id=run_id,
        updates={
            "state": payload["result"],
            "result": payload["result"],
            "summary": payload["summary"],
            "verification": payload["verification"],
            "blocker": payload["blocker"],
            "result_payload": payload,
            "result_source": source,
            "exit_code": RESULT_EXIT_CODES[str(payload["result"])],
        },
    )
    append_run_event(
        repo_root,
        run_id=run_id,
        event_type="shell_result_finalized",
        details={
            "result": payload["result"],
            "process_returncode": process_returncode,
            "result_source": source,
        },
    )


def _result_payload_from_args(args: argparse.Namespace) -> dict[str, object]:
    blocker: dict[str, object] | None = None
    if args.blocker_kind or args.blocker_message:
        blocker = {
            "kind": args.blocker_kind,
            "message": args.blocker_message,
        }
    return {
        "schema_version": RESULT_SCHEMA_VERSION,
        "result": args.result,
        "summary": args.summary,
        "verification": {
            "status": args.verification_status,
            "commands": list(args.verification_commands or []),
            "notes": args.verification_notes,
        },
        "blocker": blocker,
        "next_action": args.next_action,
    }


def write_terminal_result(
    *,
    repo_root: Path | str,
    args: argparse.Namespace,
) -> int:
    repo = resolve_repo_root(repo_root)
    run_id = args.run_id or os.environ.get("CAMPUS_WORKSTREAM_RUN_ID")
    if not isinstance(run_id, str) or not run_id.strip():
        raise ValueError("result write requires CAMPUS_WORKSTREAM_RUN_ID or --run-id")

    result_path = (
        Path(args.result_path)
        if args.result_path
        else Path(os.environ.get("CAMPUS_WORKSTREAM_RESULT_PATH") or result_file_path(repo, run_id))
    )
    normalized, normalization_notes = write_result_artifact(
        result_path,
        _result_payload_from_args(args),
        tracked_changes=has_tracked_changes(repo),
    )
    append_run_event(
        repo,
        run_id=run_id,
        event_type="result_written",
        details={
            "result": normalized["result"],
            "path": str(result_path),
            "normalization_notes": normalization_notes,
        },
    )
    if args.json:
        _print_payload(
            {
                "run_id": run_id,
                "result_path": str(result_path),
                "payload": normalized,
            },
            as_json=True,
        )
    return 0


def run_codex_shell_session(
    *,
    repo_root: Path | str,
    workstream: str,
    operator_id: str,
    session_key: str | None,
    model: str | None,
    profile: str | None,
    sandbox: str,
    approval_policy: str,
    codex_args: list[str],
    lease_seconds: int,
    heartbeat_interval_seconds: int,
    runner=_subprocess_shell_runner,
    environ: dict[str, str] | None = None,
) -> int:
    repo = resolve_repo_root(repo_root)
    resolved_session_key = resolve_session_key(explicit_session_key=session_key, environ=environ)
    run_id = f"run-{uuid.uuid4().hex}"
    result_path = result_file_path(repo, run_id)
    command = _shell_command(
        repo,
        model=model,
        profile=profile,
        sandbox=sandbox,
        approval_policy=approval_policy,
        codex_args=codex_args,
    )

    def shell_runner(
        argv: list[str],
        *,
        cwd: Path,
        env: dict[str, str],
    ) -> subprocess.CompletedProcess[str]:
        env["CAMPUS_WORKSTREAM_RUN_ID"] = run_id
        env["CAMPUS_WORKSTREAM_REPO_ROOT"] = str(cwd)
        env["CAMPUS_WORKSTREAM_HARNESS_MODE"] = "shell"
        env["CAMPUS_WORKSTREAM_RESULT_PATH"] = str(result_path)
        env.pop("CAMPUS_WORKSTREAM_ASSISTANT_MESSAGE_PATH", None)
        create_run_record(
            cwd,
            run_id=run_id,
            workstream=workstream,
            operator_id=operator_id,
            session_key=resolved_session_key,
            mode="shell",
            command=argv,
            claim_id=env.get("CAMPUS_WORKSTREAM_CLAIM_ID"),
            artifacts={
                "run_path": str(run_file_path(cwd, run_id)),
                "events_path": str(event_file_path(cwd, run_id)),
                "result_path": str(result_path),
            },
        )
        append_run_event(cwd, run_id=run_id, event_type="run_started", details={"mode": "shell"})
        result = runner(argv, cwd=cwd, env=env)
        if getattr(result, "stdout", ""):
            sys.stdout.write(result.stdout)
        if getattr(result, "stderr", ""):
            sys.stderr.write(result.stderr)
        _finalize_shell_run_if_needed(
            cwd,
            run_id=run_id,
            process_returncode=result.returncode,
            result_artifact_path=result_path,
        )
        append_run_event(
            cwd,
            run_id=run_id,
            event_type="shell_finished",
            details={
                "process_returncode": result.returncode,
                "result_source": (load_run_record(cwd, run_id) or {}).get("result_source"),
            },
        )
        existing = load_run_record(cwd, run_id) or {}
        final_code = RESULT_EXIT_CODES.get(
            str(existing.get("result")), RESULT_EXIT_CODES["failed_needs_repair"]
        )
        return subprocess.CompletedProcess(
            argv, final_code, stdout=result.stdout, stderr=result.stderr
        )

    return run_session_command(
        repo_root=repo,
        workstream=workstream,
        command=command,
        operator_id=operator_id,
        session_key=resolved_session_key,
        lease_seconds=lease_seconds,
        heartbeat_interval_seconds=heartbeat_interval_seconds,
        runner=shell_runner,
        environ=environ,
    )


def run_codex_exec_session(
    *,
    repo_root: Path | str,
    workstream: str,
    operator_id: str,
    session_key: str | None,
    model: str | None,
    profile: str | None,
    sandbox: str,
    prompt: str,
    skip_git_repo_check: bool,
    lease_seconds: int,
    heartbeat_interval_seconds: int,
    runner=_subprocess_exec_runner,
    environ: dict[str, str] | None = None,
) -> int:
    repo = resolve_repo_root(repo_root)
    resolved_session_key = resolve_session_key(explicit_session_key=session_key, environ=environ)
    run_id = f"run-{uuid.uuid4().hex}"
    result_path = result_file_path(repo, run_id)
    last_message_path = assistant_message_file_path(repo, run_id)
    command = _exec_command(
        repo,
        model=model,
        profile=profile,
        sandbox=sandbox,
        prompt=prompt,
        output_last_message_path=last_message_path,
        skip_git_repo_check=skip_git_repo_check,
    )

    def exec_runner(
        argv: list[str],
        *,
        cwd: Path,
        env: dict[str, str],
    ) -> subprocess.CompletedProcess[str]:
        env["CAMPUS_WORKSTREAM_RUN_ID"] = run_id
        env["CAMPUS_WORKSTREAM_REPO_ROOT"] = str(cwd)
        env["CAMPUS_WORKSTREAM_HARNESS_MODE"] = "exec"
        env["CAMPUS_WORKSTREAM_RESULT_PATH"] = str(result_path)
        env["CAMPUS_WORKSTREAM_ASSISTANT_MESSAGE_PATH"] = str(last_message_path)
        create_run_record(
            cwd,
            run_id=run_id,
            workstream=workstream,
            operator_id=operator_id,
            session_key=resolved_session_key,
            mode="exec",
            command=argv,
            claim_id=env.get("CAMPUS_WORKSTREAM_CLAIM_ID"),
            artifacts={
                "run_path": str(run_file_path(cwd, run_id)),
                "events_path": str(event_file_path(cwd, run_id)),
                "result_path": str(result_path),
                "assistant_message_path": str(last_message_path),
            },
        )
        append_run_event(cwd, run_id=run_id, event_type="run_started", details={"mode": "exec"})
        result = runner(argv, cwd=cwd, env=env)
        _write_exec_stream_artifacts(
            cwd,
            run_id=run_id,
            stdout=result.stdout or "",
            stderr=result.stderr or "",
        )
        if result.stdout:
            sys.stdout.write(result.stdout)
        if result.stderr:
            sys.stderr.write(result.stderr)
        final_code = _finish_exec_run(
            cwd,
            run_id=run_id,
            process_result=result,
            result_artifact_path=result_path,
        )
        return subprocess.CompletedProcess(
            argv, final_code, stdout=result.stdout, stderr=result.stderr
        )

    return run_session_command(
        repo_root=repo,
        workstream=workstream,
        command=command,
        operator_id=operator_id,
        session_key=resolved_session_key,
        lease_seconds=lease_seconds,
        heartbeat_interval_seconds=heartbeat_interval_seconds,
        runner=exec_runner,
        environ=environ,
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    repo_root = resolve_repo_root(args.repo_root)

    if args.command == "codex":
        operator_id = resolve_operator_id(
            repo_root, explicit_operator_id=getattr(args, "operator_id", None)
        )
        if args.codex_command == "shell":
            codex_args = list(args.codex_args)
            if codex_args and codex_args[0] == "--":
                codex_args = codex_args[1:]
            return run_codex_shell_session(
                repo_root=repo_root,
                workstream=args.workstream,
                operator_id=operator_id,
                session_key=args.session_key,
                model=args.model,
                profile=args.profile,
                sandbox=args.sandbox,
                approval_policy=args.approval_policy,
                codex_args=codex_args,
                lease_seconds=args.lease_seconds,
                heartbeat_interval_seconds=args.heartbeat_seconds,
            )
        prompt_parts = list(args.prompt)
        if not prompt_parts:
            raise ValueError("codex exec requires a prompt after `--`")
        return run_codex_exec_session(
            repo_root=repo_root,
            workstream=args.workstream,
            operator_id=operator_id,
            session_key=args.session_key,
            model=args.model,
            profile=args.profile,
            sandbox=args.sandbox,
            prompt=" ".join(prompt_parts).strip(),
            skip_git_repo_check=args.skip_git_repo_check,
            lease_seconds=args.lease_seconds,
            heartbeat_interval_seconds=args.heartbeat_seconds,
        )

    if args.command == "result":
        if args.result_command == "write":
            return write_terminal_result(repo_root=repo_root, args=args)
        raise ValueError(f"Unsupported result command: {args.result_command}")

    if args.command == "status":
        if args.current:
            current_workstream = resolve_current_workstream(repo_root)
            if current_workstream is None:
                raise ValueError("Could not resolve current workstream from session context")
            workstream = current_workstream
        else:
            if not args.workstream:
                raise ValueError("status requires a workstream or --current")
            workstream = args.workstream
        payload = {
            "workstream": workstream,
            "claim": get_workstream_claim_status(repo_root, workstream),
            "latest_run": latest_run_for_workstream(repo_root, workstream),
        }
        _print_payload(payload, as_json=args.json)
        return 0

    payload = {
        "claims": collect_claim_doctor_status(repo_root),
        "latest_run": (
            latest_run_for_workstream(repo_root, args.workstream) if args.workstream else None
        ),
    }
    _print_payload(payload, as_json=args.json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
