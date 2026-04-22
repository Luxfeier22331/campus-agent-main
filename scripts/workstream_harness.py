from __future__ import annotations

import argparse
import json
import subprocess
import sys
import uuid
from pathlib import Path

from .workstream_claim import run_session_command
from .workstream_harness_result import (
    RESULT_SCHEMA_VERSION,
    extract_result_payload,
    has_tracked_changes,
    validate_result_payload,
)
from .workstream_harness_runtime import (
    append_run_event,
    create_run_record,
    event_file_path,
    latest_run_for_workstream,
    load_run_record,
    output_file_path,
    run_file_path,
    update_run_record,
)
from .workstream_runtime import (
    DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    DEFAULT_LEASE_SECONDS,
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


def _schema_path(repo_root: Path) -> Path:
    return repo_root / ".codex" / "schemas" / f"{RESULT_SCHEMA_VERSION}.json"


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
        "--cd",
        str(repo_root),
        "--sandbox",
        sandbox,
        "--json",
        "--output-schema",
        str(_schema_path(repo_root)),
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
    output_last_message_path: Path,
) -> int:
    payload: dict[str, object] | None = None
    if output_last_message_path.exists():
        try:
            payload = json.loads(output_last_message_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            parsed = extract_result_payload(output_last_message_path.read_text(encoding="utf-8"))
            if parsed is not None:
                payload = parsed

    if payload is None:
        payload = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "result": "failed_needs_repair",
            "summary": "Codex exec finished without a valid harness result payload.",
            "verification": {
                "status": "failed" if process_result.returncode else "not_applicable",
                "commands": [],
                "notes": "The exec wrapper could not parse the final structured result.",
            },
            "blocker": None,
            "next_action": "Resume the run and emit a valid harness result payload.",
        }

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
            "next_action": "Resume the run, fix the payload, and stop again with a valid result.",
        }

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
            "exit_code": RESULT_EXIT_CODES[str(payload["result"])],
        },
    )
    append_run_event(
        repo_root,
        run_id=run_id,
        event_type="exec_finished",
        details={"result": payload["result"], "process_returncode": process_result.returncode},
    )
    return RESULT_EXIT_CODES[str(payload["result"])]


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
            },
        )
        append_run_event(cwd, run_id=run_id, event_type="run_started", details={"mode": "shell"})
        result = runner(argv, cwd=cwd, env=env)
        if getattr(result, "stdout", ""):
            sys.stdout.write(result.stdout)
        if getattr(result, "stderr", ""):
            sys.stderr.write(result.stderr)
        existing = load_run_record(cwd, run_id)
        if existing is not None and str(existing.get("state")) == "running":
            update_run_record(
                cwd,
                run_id=run_id,
                updates={
                    "state": "failed_needs_repair",
                    "result": "failed_needs_repair",
                    "summary": "Interactive shell exited without a persisted harness result.",
                    "verification": {
                        "status": "not_applicable",
                        "commands": [],
                        "notes": "The stop hook did not persist a terminal result before the shell exited.",
                    },
                    "blocker": None,
                    "exit_code": RESULT_EXIT_CODES["failed_needs_repair"],
                },
            )
        append_run_event(
            cwd,
            run_id=run_id,
            event_type="shell_finished",
            details={"process_returncode": result.returncode},
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
    last_message_path = output_file_path(repo, run_id)
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
                "last_message_path": str(last_message_path),
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
            output_last_message_path=last_message_path,
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


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repo-owned workstream harness entrypoint")
    parser.add_argument("--repo-root", type=Path, default=None)
    parser.add_argument("--json", action="store_true")
    subparsers = parser.add_subparsers(dest="command", required=True)

    codex_parser = subparsers.add_parser("codex")
    codex_subparsers = codex_parser.add_subparsers(dest="codex_command", required=True)

    shell_parser = codex_subparsers.add_parser("shell")
    shell_parser.add_argument("workstream")
    shell_parser.add_argument("--operator-id", default=None)
    shell_parser.add_argument("--session-key", default=None)
    shell_parser.add_argument("--model", default=None)
    shell_parser.add_argument("--profile", default=None)
    shell_parser.add_argument(
        "--sandbox",
        default="workspace-write",
        choices=("read-only", "workspace-write", "danger-full-access"),
    )
    shell_parser.add_argument(
        "--approval-policy",
        default="on-request",
        choices=("untrusted", "on-request", "never"),
    )
    shell_parser.add_argument("--lease-seconds", type=int, default=DEFAULT_LEASE_SECONDS)
    shell_parser.add_argument(
        "--heartbeat-seconds",
        type=int,
        default=DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    )
    shell_parser.add_argument("codex_args", nargs=argparse.REMAINDER)

    exec_parser = codex_subparsers.add_parser("exec")
    exec_parser.add_argument("workstream")
    exec_parser.add_argument("--operator-id", default=None)
    exec_parser.add_argument("--session-key", default=None)
    exec_parser.add_argument("--model", default=None)
    exec_parser.add_argument("--profile", default=None)
    exec_parser.add_argument(
        "--sandbox",
        default="workspace-write",
        choices=("read-only", "workspace-write", "danger-full-access"),
    )
    exec_parser.add_argument("--skip-git-repo-check", action="store_true")
    exec_parser.add_argument("--lease-seconds", type=int, default=DEFAULT_LEASE_SECONDS)
    exec_parser.add_argument(
        "--heartbeat-seconds",
        type=int,
        default=DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    )
    exec_parser.add_argument("prompt", nargs=argparse.REMAINDER)

    status_parser = subparsers.add_parser("status")
    status_parser.add_argument("--json", action="store_true")
    status_parser.add_argument("--current", action="store_true")
    status_parser.add_argument("workstream", nargs="?")

    doctor_parser = subparsers.add_parser("doctor")
    doctor_parser.add_argument("--json", action="store_true")
    doctor_parser.add_argument("--workstream", default=None)

    return parser.parse_args(argv)


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
        if prompt_parts and prompt_parts[0] == "--":
            prompt_parts = prompt_parts[1:]
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
