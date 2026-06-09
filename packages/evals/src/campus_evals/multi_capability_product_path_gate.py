from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from campus_evals.public_chat_product_path_eval import load_public_chat_product_path_cases
from campus_evals.tool_family_denominator import load_tool_family_denominator
from campus_evals.workflow_trace_gate import (
    load_workflow_trace_cases,
    validate_workflow_trace_case_set,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
EXECUTION_CONTROL_DIR = REPO_ROOT / "apps" / "execution-control"
DEFAULT_REPORT_NAME = "multi-agent-runtime-contract-gate.json"
DEFAULT_SCHEMA_VERSION = "multi_capability_runtime_contract_gate.v1"
DEFAULT_GATE_ID = "multi_capability_runtime_contract"


@dataclass(frozen=True, slots=True)
class CommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


@dataclass(frozen=True, slots=True)
class MultiCapabilityGateCheck:
    check_id: str
    passed: bool
    summary: dict[str, object]
    command: tuple[str, ...] = ()
    stdout: str = ""
    stderr: str = ""


@dataclass(frozen=True, slots=True)
class MultiCapabilityProductPathGateReport:
    output_path: Path
    passed: bool
    checks: tuple[MultiCapabilityGateCheck, ...]


class CommandRunner(Protocol):
    def __call__(
        self,
        command: tuple[str, ...],
        *,
        cwd: Path | None = None,
    ) -> CommandResult: ...


def run_multi_capability_product_path_gate(
    *,
    output_dir: Path,
    command_runner: CommandRunner | None = None,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> MultiCapabilityProductPathGateReport:
    output_dir.mkdir(parents=True, exist_ok=True)
    command = command_runner or _run_command
    resolve_git_head = git_head_resolver or _resolve_git_head

    workflow_trace_summary = _build_workflow_trace_summary()
    tool_family_summary = _build_tool_family_summary()
    public_chat_product_path_summary = _build_public_chat_product_path_summary()

    checks = (
        _run_command_check(
            check_id="supervisor_execution_contract_generation_check",
            command=_supervisor_execution_contract_generation_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="workflow_trace_eval_tests",
            command=_workflow_trace_eval_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="tool_family_denominator_tests",
            command=_tool_family_denominator_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="public_chat_product_path_eval_tests",
            command=_public_chat_product_path_eval_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="supervisor_multi_capability_runtime_tests",
            command=_supervisor_multi_capability_runtime_command(),
            command_runner=command,
            cwd=EXECUTION_CONTROL_DIR,
        ),
        _run_command_check(
            check_id="domain_capability_adapter_tests",
            command=_domain_capability_adapter_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="app_api_multi_capability_observability_tests",
            command=_app_api_multi_capability_observability_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="panel_multi_capability_observability_tests",
            command=_panel_multi_capability_observability_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
    )
    report = MultiCapabilityProductPathGateReport(
        output_path=output_dir / DEFAULT_REPORT_NAME,
        passed=all(check.passed for check in checks),
        checks=checks,
    )
    payload = _report_payload(
        report=report,
        workflow_trace_summary=workflow_trace_summary,
        tool_family_summary=tool_family_summary,
        public_chat_product_path_summary=public_chat_product_path_summary,
        git_head=resolve_git_head(),
    )
    report.output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return report


def _build_workflow_trace_summary() -> dict[str, object]:
    case_set = load_workflow_trace_cases()
    validate_workflow_trace_case_set(case_set)
    return {
        "case_family": case_set.case_family,
        "case_count": len(case_set.cases),
    }


def _build_tool_family_summary() -> dict[str, object]:
    denominator = load_tool_family_denominator()
    return {
        "tool_count": len(denominator.tools),
        "case_count": len(denominator.cases),
    }


def _build_public_chat_product_path_summary() -> dict[str, object]:
    case_set = load_public_chat_product_path_cases()
    return {
        "case_family": case_set.case_family,
        "case_count": len(case_set.cases),
    }


def _supervisor_execution_contract_generation_command() -> tuple[str, ...]:
    return (
        "uv",
        "run",
        "--all-packages",
        "python",
        "-m",
        "scripts.generate_supervisor_execution_contracts",
        "--check",
    )


def _workflow_trace_eval_command() -> tuple[str, ...]:
    return (
        "uv",
        "run",
        "--all-packages",
        "python",
        "-m",
        "unittest",
        "tests.evals.test_workflow_trace_gate",
    )


def _tool_family_denominator_command() -> tuple[str, ...]:
    return (
        "uv",
        "run",
        "--all-packages",
        "python",
        "-m",
        "unittest",
        "tests.evals.test_tool_family_denominator",
    )


def _public_chat_product_path_eval_command() -> tuple[str, ...]:
    return (
        "uv",
        "run",
        "--all-packages",
        "python",
        "-m",
        "unittest",
        "tests.evals.test_public_chat_product_path_eval",
    )


def _supervisor_multi_capability_runtime_command() -> tuple[str, ...]:
    return (
        "go",
        "test",
        "./internal/httpapi",
        "./internal/structuredplanning",
        "./internal/runtimepolicy",
        "./internal/structuredquery",
    )


def _domain_capability_adapter_command() -> tuple[str, ...]:
    return (
        "uv",
        "run",
        "--all-packages",
        "python",
        "-m",
        "unittest",
        "tests.agent.test_campus_services_capability",
        "tests.agent.test_notice_capability",
    )


def _app_api_multi_capability_observability_command() -> tuple[str, ...]:
    return (
        "pnpm",
        "--dir",
        "apps/app-api",
        "exec",
        "vitest",
        "run",
        "-c",
        "vitest.node.config.mts",
        "test/supervisor-adapter.test.ts",
        "test/operator-query.store.test.ts",
        "test/request-observability.test.ts",
    )


def _panel_multi_capability_observability_command() -> tuple[str, ...]:
    return (
        "pnpm",
        "--dir",
        "apps/protected-panel-web",
        "exec",
        "vitest",
        "run",
        "-c",
        "vitest.node.config.mts",
        "test/data-provider.test.ts",
        "test/panel-shell-copy-regression.test.ts",
        "test/request-formatters.test.ts",
    )


def _run_command_check(
    *,
    check_id: str,
    command: tuple[str, ...],
    command_runner: CommandRunner,
    cwd: Path,
) -> MultiCapabilityGateCheck:
    result = command_runner(command, cwd=cwd)
    return MultiCapabilityGateCheck(
        check_id=check_id,
        passed=result.returncode == 0,
        summary={
            "cwd": str(cwd),
            "returncode": result.returncode,
        },
        command=command,
        stdout=result.stdout,
        stderr=result.stderr,
    )


def _report_payload(
    *,
    report: MultiCapabilityProductPathGateReport,
    workflow_trace_summary: dict[str, object],
    tool_family_summary: dict[str, object],
    public_chat_product_path_summary: dict[str, object],
    git_head: str | None,
) -> dict[str, object]:
    checks = tuple(asdict(check) for check in report.checks)
    passed_checks = sum(1 for check in report.checks if check.passed)
    failed_checks = len(report.checks) - passed_checks
    return {
        "schema_version": DEFAULT_SCHEMA_VERSION,
        "gate_id": DEFAULT_GATE_ID,
        "passed": report.passed,
        "summary": {
            "total_checks": len(report.checks),
            "passed_checks": passed_checks,
            "failed_checks": failed_checks,
        },
        "workflow_trace_summary": workflow_trace_summary,
        "tool_family_summary": tool_family_summary,
        "public_chat_product_path_summary": public_chat_product_path_summary,
        "checks": checks,
        "version_summary": {
            "generated_at": datetime.now(UTC).isoformat(),
            "git_head": git_head,
            "runner": DEFAULT_SCHEMA_VERSION,
        },
        "scope": {
            "deterministic_gate_scope": [
                "schema-first supervisor execution contract generation check",
                "workflow trace fixture and evaluator coverage",
                "tool-family denominator fixture and evaluator coverage",
                "public-chat product-path fixture and evaluator coverage",
                "targeted supervisor/app-api/panel test lanes",
            ],
            "excluded_scope": [
                "does not mutate serving admission",
                "does not start local live processes",
                "does not replace supervisor-led orchestration with an SDK runtime",
            ],
        },
    }


def render_summary_text(report: MultiCapabilityProductPathGateReport) -> str:
    passed_checks = sum(1 for check in report.checks if check.passed)
    failed_checks = len(report.checks) - passed_checks
    return (
        "multi-agent runtime-contract gate: "
        f"{'PASS' if report.passed else 'FAIL'} "
        f"passed={passed_checks} failed={failed_checks} "
        f"artifact={report.output_path}"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run multi-agent runtime-contract eval gate.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    accept_parser = subparsers.add_parser(
        "accept",
        help="Run deterministic multi-agent runtime-contract checks.",
    )
    accept_parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory for gate artifacts.",
    )
    accept_parser.add_argument(
        "--reruns",
        type=int,
        default=1,
        help="Deterministic gate rerun contract; must be 1.",
    )
    accept_parser.add_argument("--verbose", action="store_true")
    accept_parser.add_argument("--log-jsonl")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if args.command != "accept":
        raise ValueError(f"unsupported command: {args.command}")
    if args.reruns != 1:
        raise ValueError("multi-agent runtime-contract gate is deterministic and requires reruns=1")
    report = run_multi_capability_product_path_gate(output_dir=Path(args.output_dir))
    if args.verbose:
        print(render_summary_text(report))
    return 0 if report.passed else 1


def _run_command(command: tuple[str, ...], *, cwd: Path | None = None) -> CommandResult:
    completed = subprocess.run(
        command,
        cwd=cwd or REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return CommandResult(
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )


def _resolve_git_head() -> str | None:
    completed = subprocess.run(
        ("git", "rev-parse", "HEAD"),
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        return None
    candidate = completed.stdout.strip()
    return candidate or None


__all__ = [
    "DEFAULT_GATE_ID",
    "DEFAULT_REPORT_NAME",
    "DEFAULT_SCHEMA_VERSION",
    "EXECUTION_CONTROL_DIR",
    "REPO_ROOT",
    "CommandResult",
    "MultiCapabilityGateCheck",
    "MultiCapabilityProductPathGateReport",
    "build_parser",
    "main",
    "render_summary_text",
    "run_multi_capability_product_path_gate",
]


if __name__ == "__main__":
    raise SystemExit(main())
