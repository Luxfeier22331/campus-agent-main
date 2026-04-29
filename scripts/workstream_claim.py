from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

from .workstream_runtime import (
    DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    DEFAULT_LEASE_SECONDS,
    ClaimConflictError,
    ClaimNotFoundError,
    OperatorNotConfiguredError,
    WorkstreamClaimError,
    accept_workstream_handoff,
    acquire_workstream_claim,
    clear_gsd_active_workstream_pointer,
    clear_operator_profile,
    collect_claim_doctor_status,
    get_operator_profile,
    get_workstream_claim_status,
    handoff_workstream_claim,
    list_workstream_claims,
    release_workstream_claim,
    renew_workstream_claim,
    resolve_current_workstream,
    resolve_existing_session_key,
    resolve_operator_id,
    resolve_repo_root,
    resolve_session_key,
    set_operator_profile,
    takeover_workstream_claim,
    write_gsd_active_workstream_pointer,
)


def _default_runner(
    argv: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, cwd=str(cwd), env=env, check=False)


def _print_payload(payload: object, *, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    if isinstance(payload, dict):
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    print(payload)


def _format_claim_summary(payload: dict[str, object]) -> str:
    status = payload.get("effective_status")
    if status == "unclaimed":
        return f"{payload['workstream']}: unclaimed"
    base = f"{payload['workstream']}: {status}"
    operator_id = payload.get("operator_id")
    if operator_id:
        base += f" ({operator_id})"
    if payload.get("handoff_to_operator_id"):
        base += f" -> {payload['handoff_to_operator_id']}"
    return base


def _heartbeat_loop(
    *,
    repo_root: Path,
    workstream: str,
    claim_id: str,
    operator_id: str,
    session_key: str,
    heartbeat_interval_seconds: int,
    stop_event: threading.Event,
) -> None:
    interval = max(1, heartbeat_interval_seconds)
    while not stop_event.wait(interval):
        result = renew_workstream_claim(
            repo_root=repo_root,
            workstream=workstream,
            claim_id=claim_id,
            operator_id=operator_id,
            session_key=session_key,
        )
        if not result.get("renewed"):
            return


def run_session_command(
    *,
    repo_root: Path | str,
    workstream: str,
    command: list[str],
    operator_id: str,
    session_key: str | None = None,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    heartbeat_interval_seconds: int = DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    runner=_default_runner,
    environ: dict[str, str] | None = None,
) -> int:
    repo = resolve_repo_root(repo_root)
    env = dict(environ or os.environ)
    resolved_session_key = resolve_session_key(
        explicit_session_key=session_key,
        environ=env,
    )
    claim = acquire_workstream_claim(
        repo_root=repo,
        workstream=workstream,
        operator_id=operator_id,
        session_key=resolved_session_key,
        lease_seconds=lease_seconds,
        heartbeat_interval_seconds=heartbeat_interval_seconds,
    )

    write_gsd_active_workstream_pointer(
        repo,
        workstream=workstream,
        session_key=resolved_session_key,
    )

    child_env = dict(env)
    child_env.update(
        {
            "GSD_WORKSTREAM": str(claim["workstream"]),
            "GSD_SESSION_KEY": resolved_session_key,
            "GSD_OPERATOR_ID": operator_id,
            "CAMPUS_WORKSTREAM_CLAIM_ID": str(claim["claim_id"]),
        }
    )

    stop_event = threading.Event()
    heartbeat_thread = threading.Thread(
        target=_heartbeat_loop,
        kwargs={
            "repo_root": repo,
            "workstream": str(claim["workstream"]),
            "claim_id": str(claim["claim_id"]),
            "operator_id": operator_id,
            "session_key": resolved_session_key,
            "heartbeat_interval_seconds": int(claim["heartbeat_interval_seconds"]),
            "stop_event": stop_event,
        },
        daemon=True,
    )
    heartbeat_thread.start()

    exit_code = 1
    try:
        result = runner(command, cwd=repo, env=child_env)
        exit_code = int(getattr(result, "returncode", result))
        return int(getattr(result, "returncode", result))
    finally:
        stop_event.set()
        heartbeat_thread.join(timeout=2)
        clear_gsd_active_workstream_pointer(repo, session_key=resolved_session_key)
        release_workstream_claim(
            repo_root=repo,
            workstream=workstream,
            claim_id=str(claim["claim_id"]),
            operator_id=operator_id,
            session_key=resolved_session_key,
            reason=f"session exited with code {exit_code}",
            strict=False,
        )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Repo-owned workstream claim, handoff, and session workflow",
    )
    parser.add_argument("--repo-root", type=Path, default=None)
    parser.add_argument("--json", action="store_true")
    subparsers = parser.add_subparsers(dest="command", required=True)

    operator_parser = subparsers.add_parser("operator")
    operator_subparsers = operator_parser.add_subparsers(dest="operator_command", required=True)

    operator_set = operator_subparsers.add_parser("set")
    operator_set.add_argument("operator_id")
    operator_set.add_argument("--display-name", default=None)

    operator_subparsers.add_parser("get")
    operator_subparsers.add_parser("clear")

    session_parser = subparsers.add_parser("session")
    session_subparsers = session_parser.add_subparsers(dest="session_command", required=True)

    session_start = session_subparsers.add_parser("start")
    session_start.add_argument("workstream")
    session_start.add_argument("--operator-id", default=None)
    session_start.add_argument("--session-key", default=None)
    session_start.add_argument("--lease-seconds", type=int, default=DEFAULT_LEASE_SECONDS)
    session_start.add_argument(
        "--heartbeat-seconds",
        type=int,
        default=DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    )
    session_start.add_argument("command", nargs=argparse.REMAINDER)

    session_shell = session_subparsers.add_parser("shell")
    session_shell.add_argument("workstream")
    session_shell.add_argument("--operator-id", default=None)
    session_shell.add_argument("--session-key", default=None)
    session_shell.add_argument("--shell", default=os.environ.get("SHELL") or "/bin/bash")
    session_shell.add_argument("--lease-seconds", type=int, default=DEFAULT_LEASE_SECONDS)
    session_shell.add_argument(
        "--heartbeat-seconds",
        type=int,
        default=DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    )

    session_subparsers.add_parser("current")

    claim_parser = subparsers.add_parser("claim")
    claim_subparsers = claim_parser.add_subparsers(dest="claim_command", required=True)

    claim_subparsers.add_parser("list")

    claim_status = claim_subparsers.add_parser("status")
    claim_status.add_argument("workstream")

    claim_release = claim_subparsers.add_parser("release")
    claim_release.add_argument("workstream", nargs="?")
    claim_release.add_argument("--current", action="store_true")
    claim_release.add_argument("--reason", required=True)
    claim_release.add_argument("--operator-id", default=None)
    claim_release.add_argument("--session-key", default=None)
    claim_release.add_argument("--claim-id", default=None)
    claim_release.add_argument("--force", action="store_true")

    claim_handoff = claim_subparsers.add_parser("handoff")
    claim_handoff.add_argument("workstream", nargs="?")
    claim_handoff.add_argument("--current", action="store_true")
    claim_handoff.add_argument("--to", required=True)
    claim_handoff.add_argument("--note", default=None)
    claim_handoff.add_argument("--operator-id", default=None)
    claim_handoff.add_argument("--session-key", default=None)
    claim_handoff.add_argument("--claim-id", default=None)

    claim_accept = claim_subparsers.add_parser("accept")
    claim_accept.add_argument("workstream", nargs="?")
    claim_accept.add_argument("--current", action="store_true")
    claim_accept.add_argument("--operator-id", default=None)
    claim_accept.add_argument("--session-key", default=None)
    claim_accept.add_argument("--lease-seconds", type=int, default=None)
    claim_accept.add_argument("--heartbeat-seconds", type=int, default=None)

    claim_takeover = claim_subparsers.add_parser("takeover")
    claim_takeover.add_argument("workstream")
    claim_takeover.add_argument("--reason", required=True)
    claim_takeover.add_argument("--operator-id", default=None)
    claim_takeover.add_argument("--session-key", default=None)
    claim_takeover.add_argument("--lease-seconds", type=int, default=DEFAULT_LEASE_SECONDS)
    claim_takeover.add_argument(
        "--heartbeat-seconds",
        type=int,
        default=DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    )
    claim_takeover.add_argument("--force", action="store_true")

    claim_subparsers.add_parser("doctor")

    return parser.parse_args(argv)


def _resolve_target_workstream(
    repo_root: Path,
    *,
    workstream: str | None,
    use_current: bool,
    environ: dict[str, str] | None = None,
) -> str:
    if workstream and use_current:
        raise ValueError("Specify either <workstream> or --current, not both")
    if workstream:
        return workstream
    if use_current:
        current = resolve_current_workstream(repo_root, environ=environ)
        if current:
            return current
        raise ValueError("Could not resolve current workstream from session context")
    raise ValueError("Missing workstream target")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    repo_root = resolve_repo_root(args.repo_root)

    try:
        if args.command == "operator":
            if args.operator_command == "set":
                payload = set_operator_profile(
                    repo_root=repo_root,
                    operator_id=args.operator_id,
                    display_name=args.display_name,
                )
                if args.json:
                    _print_payload(payload, as_json=True)
                else:
                    print(f"operator set: {payload['operator_id']}")
                return 0

            if args.operator_command == "get":
                payload = get_operator_profile(repo_root)
                if args.json:
                    _print_payload(payload, as_json=True)
                else:
                    print(payload["operator_id"] if payload else "operator not set")
                return 0

            if args.operator_command == "clear":
                clear_operator_profile(repo_root)
                print("operator cleared")
                return 0

        if args.command == "session":
            if args.session_command == "current":
                session_key = resolve_existing_session_key()
                current = resolve_current_workstream(repo_root)
                payload = {
                    "session_key": session_key,
                    "workstream": current,
                    "operator_id": os.environ.get("GSD_OPERATOR_ID"),
                }
                if args.json:
                    _print_payload(payload, as_json=True)
                else:
                    print(json.dumps(payload, ensure_ascii=False, indent=2))
                return 0

            operator_id = resolve_operator_id(
                repo_root,
                explicit_operator_id=args.operator_id,
            )
            if args.session_command == "shell":
                command = [args.shell]
            else:
                command = list(args.command)
                if command and command[0] == "--":
                    command = command[1:]
                if not command:
                    raise ValueError("session start requires a command after `--`")

            return run_session_command(
                repo_root=repo_root,
                workstream=args.workstream,
                command=command,
                operator_id=operator_id,
                session_key=args.session_key,
                lease_seconds=args.lease_seconds,
                heartbeat_interval_seconds=args.heartbeat_seconds,
            )

        if args.command == "claim":
            if args.claim_command == "list":
                payload = list_workstream_claims(repo_root)
                if args.json:
                    _print_payload(payload, as_json=True)
                else:
                    for row in payload:
                        print(_format_claim_summary(row))
                return 0

            if args.claim_command == "status":
                payload = get_workstream_claim_status(repo_root, args.workstream)
                if args.json:
                    _print_payload(payload, as_json=True)
                else:
                    print(json.dumps(payload, ensure_ascii=False, indent=2))
                return 0

            if args.claim_command == "doctor":
                payload = collect_claim_doctor_status(repo_root)
                if args.json:
                    _print_payload(payload, as_json=True)
                else:
                    print(json.dumps(payload, ensure_ascii=False, indent=2))
                return 0

            target_workstream = _resolve_target_workstream(
                repo_root,
                workstream=getattr(args, "workstream", None),
                use_current=getattr(args, "current", False),
            )
            operator_id = resolve_operator_id(
                repo_root,
                explicit_operator_id=getattr(args, "operator_id", None),
            )
            session_key = resolve_session_key(
                explicit_session_key=getattr(args, "session_key", None),
            )

            if args.claim_command == "release":
                payload = release_workstream_claim(
                    repo_root=repo_root,
                    workstream=target_workstream,
                    claim_id=args.claim_id,
                    operator_id=operator_id,
                    session_key=session_key,
                    reason=args.reason,
                    force=args.force,
                )
                if args.json:
                    _print_payload(payload, as_json=True)
                else:
                    print(f"released: {target_workstream}")
                return 0

            if args.claim_command == "handoff":
                claim_status = get_workstream_claim_status(repo_root, target_workstream)
                payload = handoff_workstream_claim(
                    repo_root=repo_root,
                    workstream=target_workstream,
                    claim_id=args.claim_id or str(claim_status["claim_id"]),
                    operator_id=operator_id,
                    session_key=session_key,
                    to_operator_id=args.to,
                    note=args.note,
                )
                if args.json:
                    _print_payload(payload, as_json=True)
                else:
                    print(
                        f"handoff requested: {target_workstream} -> {payload['handoff_to_operator_id']}"
                    )
                return 0

            if args.claim_command == "accept":
                payload = accept_workstream_handoff(
                    repo_root=repo_root,
                    workstream=target_workstream,
                    operator_id=operator_id,
                    session_key=session_key,
                    lease_seconds=args.lease_seconds,
                    heartbeat_interval_seconds=args.heartbeat_seconds,
                )
                write_gsd_active_workstream_pointer(
                    repo_root,
                    workstream=target_workstream,
                    session_key=session_key,
                )
                if args.json:
                    _print_payload(payload, as_json=True)
                else:
                    print(f"handoff accepted: {target_workstream}")
                return 0

            if args.claim_command == "takeover":
                payload = takeover_workstream_claim(
                    repo_root=repo_root,
                    workstream=target_workstream,
                    operator_id=operator_id,
                    session_key=session_key,
                    reason=args.reason,
                    force=args.force,
                    lease_seconds=args.lease_seconds,
                    heartbeat_interval_seconds=args.heartbeat_seconds,
                )
                write_gsd_active_workstream_pointer(
                    repo_root,
                    workstream=target_workstream,
                    session_key=session_key,
                )
                if args.json:
                    _print_payload(payload, as_json=True)
                else:
                    print(f"claim taken over: {target_workstream}")
                return 0

    except (
        ClaimConflictError,
        ClaimNotFoundError,
        OperatorNotConfiguredError,
        ValueError,
        WorkstreamClaimError,
        FileNotFoundError,
    ) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    raise AssertionError(f"Unhandled command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
