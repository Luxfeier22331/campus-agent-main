from __future__ import annotations

import json
import subprocess
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class CommandRunResult:
    command: tuple[str, ...]
    exit_code: int
    stdout: str
    stderr: str
    elapsed_seconds: float


def json_or_none(stdout: str) -> dict[str, Any] | None:
    stripped = stdout.strip()
    if not stripped:
        return None
    try:
        payload = json.loads(stripped)
        return payload if isinstance(payload, dict) else None
    except json.JSONDecodeError:
        pass
    for index in range(len(stripped) - 1, -1, -1):
        if stripped[index] != "{":
            continue
        candidate = stripped[index:]
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return None


def run_command(command: Sequence[str], *, cwd: str) -> CommandRunResult:
    started = time.monotonic()
    completed = subprocess.run(
        tuple(command),
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    elapsed_seconds = round(time.monotonic() - started, 3)
    return CommandRunResult(
        command=tuple(command),
        exit_code=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
        elapsed_seconds=elapsed_seconds,
    )


def build_step_report(
    *,
    name: str,
    result: CommandRunResult,
    parsed_json: dict[str, Any] | None,
    status_override: str | None = None,
    failure_reason: str | None = None,
) -> dict[str, Any]:
    status = status_override or ("succeeded" if result.exit_code == 0 else "failed")
    payload: dict[str, Any] = {
        "name": name,
        "status": status,
        "exit_code": result.exit_code,
        "elapsed_seconds": result.elapsed_seconds,
        "command": list(result.command),
        "stdout_tail": result.stdout[-2000:],
        "stderr_tail": result.stderr[-2000:],
    }
    if parsed_json is not None:
        payload["output_json"] = parsed_json
    if failure_reason:
        payload["failure_reason"] = failure_reason
    return payload


def run_pipeline_step(
    *,
    step_name: str,
    command: Sequence[str],
    cwd: str,
    require_json: bool,
    command_runner: Any,
) -> dict[str, Any]:
    result = command_runner(command, cwd=cwd)
    parsed_json = json_or_none(result.stdout)
    if result.exit_code != 0:
        return build_step_report(name=step_name, result=result, parsed_json=parsed_json)
    if require_json and parsed_json is None:
        return build_step_report(
            name=step_name,
            result=result,
            parsed_json=None,
            status_override="failed",
            failure_reason="expected JSON output",
        )
    return build_step_report(name=step_name, result=result, parsed_json=parsed_json)


__all__ = [
    "CommandRunResult",
    "build_step_report",
    "json_or_none",
    "run_command",
    "run_pipeline_step",
]
