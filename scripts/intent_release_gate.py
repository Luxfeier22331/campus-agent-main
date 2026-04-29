from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Callable
from pathlib import Path

from campus_evals.intent_policy_artifact import intent_policy_gate_metadata

DEFAULT_OUTPUT = Path(".tmp/evals/intent-release-gate.json")
INTENT_GATE_OUTPUT = Path(".tmp/evals/intent-gate.json")
CommandRunner = Callable[[tuple[str, ...]], dict[str, object]]


def release_gate_commands() -> tuple[tuple[str, ...], ...]:
    return (
        (
            "uv",
            "run",
            "--all-packages",
            "python",
            "-m",
            "scripts.intent_gate",
            "--runner",
            "supervisor-api-go",
            "--output",
            str(INTENT_GATE_OUTPUT),
        ),
        ("bash", "-lc", "cd apps/supervisor-api && go test ./..."),
        (
            "pnpm",
            "--dir",
            "apps/app-api",
            "exec",
            "vitest",
            "run",
            "-c",
            "vitest.node.config.mts",
            "test/supervisor-adapter.test.ts",
            "test/chat-command.service.observability.suite.ts",
            "test/operator-query.store.test.ts",
        ),
        (
            "uv",
            "run",
            "--all-packages",
            "python",
            "-m",
            "unittest",
            "tests.evals.eval_admission_suite",
            "tests.evals.intent_observed_regression_suite",
            "tests.evals.intent_drift_suite",
        ),
    )


def run_release_gate(
    *,
    command_runner: CommandRunner | None = None,
) -> dict[str, object]:
    runner = command_runner or _run_command
    command_results = [runner(command) for command in release_gate_commands()]
    policy_metadata = intent_policy_gate_metadata()
    return {
        "schema_version": 1,
        "runner": "supervisor-api-go",
        "case_set_version": policy_metadata["case_set_version"],
        "policy_artifact": {
            "schema_version": policy_metadata["schema_version"],
            "policy_version": policy_metadata["policy_version"],
            "classifier_version": policy_metadata["classifier_version"],
            "intent_schema_version": policy_metadata["intent_schema_version"],
        },
        "passed": all(int(result.get("exit_code", 1)) == 0 for result in command_results),
        "command_results": command_results,
    }


def write_release_gate_report(payload: dict[str, object], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def render_summary_text(payload: dict[str, object], output_path: Path) -> str:
    status = "PASS" if payload["passed"] else "FAIL"
    return (
        f"Intent cross-layer release gate: {status} "
        f"commands={len(payload['command_results'])} "
        f"runner={payload['runner']} output={output_path}"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the cross-layer intent release gate.")
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Path to write the release gate JSON report.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    output_path = Path(args.output)
    payload = run_release_gate()
    write_release_gate_report(payload, output_path)
    print(render_summary_text(payload, output_path))
    return 0 if payload["passed"] else 1


def _run_command(command: tuple[str, ...]) -> dict[str, object]:
    completed = subprocess.run(
        command,
        text=True,
        capture_output=True,
        check=False,
    )
    return {
        "command": list(command),
        "exit_code": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "DEFAULT_OUTPUT",
    "INTENT_GATE_OUTPUT",
    "build_parser",
    "main",
    "release_gate_commands",
    "render_summary_text",
    "run_release_gate",
    "write_release_gate_report",
]
