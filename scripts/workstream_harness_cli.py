from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .workstream_harness_result import (
    VALID_BLOCKER_KINDS,
    VALID_RESULTS,
    VALID_VERIFICATION_STATUSES,
)
from .workstream_runtime import (
    DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    DEFAULT_LEASE_SECONDS,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    normalized_argv = list(argv) if argv is not None else list(sys.argv[1:])
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

    status_parser = subparsers.add_parser("status")
    status_parser.add_argument("--json", action="store_true")
    status_parser.add_argument("--current", action="store_true")
    status_parser.add_argument("workstream", nargs="?")

    doctor_parser = subparsers.add_parser("doctor")
    doctor_parser.add_argument("--json", action="store_true")
    doctor_parser.add_argument("--workstream", default=None)

    result_parser = subparsers.add_parser("result")
    result_subparsers = result_parser.add_subparsers(dest="result_command", required=True)

    result_write_parser = result_subparsers.add_parser("write")
    result_write_parser.add_argument(
        "--result",
        required=True,
        choices=sorted(VALID_RESULTS),
    )
    result_write_parser.add_argument("--summary", required=True)
    result_write_parser.add_argument(
        "--verification-status",
        required=True,
        choices=sorted(VALID_VERIFICATION_STATUSES),
    )
    result_write_parser.add_argument(
        "--verification-command",
        dest="verification_commands",
        action="append",
        default=[],
    )
    result_write_parser.add_argument("--verification-notes", default="")
    result_write_parser.add_argument("--next-action", required=True)
    result_write_parser.add_argument(
        "--blocker-kind",
        choices=sorted(VALID_BLOCKER_KINDS),
        default=None,
    )
    result_write_parser.add_argument("--blocker-message", default=None)
    result_write_parser.add_argument("--run-id", default=None)
    result_write_parser.add_argument("--result-path", type=Path, default=None)

    args, remainder = parser.parse_known_args(normalized_argv)
    if args.command == "codex" and args.codex_command == "exec":
        prompt_parts = list(remainder)
        if prompt_parts and prompt_parts[0] == "--":
            prompt_parts = prompt_parts[1:]
        args.prompt = prompt_parts
        return args
    if remainder:
        parser.error(f"unrecognized arguments: {' '.join(remainder)}")
    return args
