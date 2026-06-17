from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

REPO_ROOT = Path(__file__).resolve().parents[4]
EXECUTION_CONTROL_DIR = REPO_ROOT / "apps" / "execution-control"
DEFAULT_REPORT_NAME = "campus-services-product-path-opening-gate.json"
DEFAULT_SCHEMA_VERSION = "campus_services_product_path_opening_gate.v2"
DEFAULT_GATE_ID = "campus_services_product_path"


@dataclass(frozen=True, slots=True)
class CommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


@dataclass(frozen=True, slots=True)
class OpeningGateCheck:
    check_id: str
    passed: bool
    summary: dict[str, object]
    command: tuple[str, ...] = ()
    stdout: str = ""
    stderr: str = ""


@dataclass(frozen=True, slots=True)
class ToolOpeningVerdict:
    tool_name: str
    status: str
    required_checks: tuple[str, ...]
    failed_checks: tuple[str, ...]
    reason: str = ""


@dataclass(frozen=True, slots=True)
class ToolOpeningProfile:
    tool_name: str
    product_path_status: str
    required_checks: tuple[str, ...]
    reason: str


@dataclass(frozen=True, slots=True)
class CampusServicesProductPathOpeningGateReport:
    output_path: Path
    passed: bool
    checks: tuple[OpeningGateCheck, ...]
    tool_verdicts: tuple[ToolOpeningVerdict, ...]


class CommandRunner(Protocol):
    def __call__(
        self,
        command: tuple[str, ...],
        *,
        cwd: Path | None = None,
    ) -> CommandResult: ...


_SHARED_OPENING_CHECKS = (
    "supervisor_go_structured_runtime_tests",
    "campus_services_capability_adapter_tests",
    "app_api_campus_services_runtime_tests",
    "public_chat_worker_e2e_tests",
    "app_api_typecheck",
    "public_chat_typecheck",
)

_TOOL_OPENING_PROFILES = (
    ToolOpeningProfile(
        tool_name="service_status_lookup",
        product_path_status="open_candidate",
        required_checks=_SHARED_OPENING_CHECKS,
        reason="opened_by_campus_services_product_path",
    ),
    ToolOpeningProfile(
        tool_name="transport_schedule_lookup",
        product_path_status="open_candidate",
        required_checks=_SHARED_OPENING_CHECKS,
        reason="opened_by_campus_services_product_path",
    ),
    ToolOpeningProfile(
        tool_name="service_guide_lookup",
        product_path_status="open_candidate",
        required_checks=_SHARED_OPENING_CHECKS,
        reason="opened_by_campus_services_product_path",
    ),
    ToolOpeningProfile(
        tool_name="contact_directory_lookup",
        product_path_status="open_candidate",
        required_checks=_SHARED_OPENING_CHECKS,
        reason="opened_by_campus_services_product_path",
    ),
    ToolOpeningProfile(
        tool_name="service_process_lookup",
        product_path_status="keep_closed",
        required_checks=(),
        reason="later_wave_tool_not_admitted_to_product_path",
    ),
)


def validate_tool_opening_profiles(
    profiles: tuple[ToolOpeningProfile, ...],
) -> tuple[ToolOpeningProfile, ...]:
    seen: set[str] = set()
    for profile in profiles:
        tool_name = profile.tool_name.strip()
        if not tool_name:
            raise ValueError("tool opening profile tool_name must not be empty")
        if tool_name in seen:
            raise ValueError(f"duplicate tool opening profile: {tool_name}")
        seen.add(tool_name)
        if profile.product_path_status not in {"open_candidate", "keep_closed"}:
            raise ValueError(
                f"unsupported product_path_status for {tool_name}: {profile.product_path_status}"
            )
        if profile.product_path_status == "open_candidate" and not profile.required_checks:
            raise ValueError(f"open_candidate requires required_checks: {tool_name}")
        if profile.product_path_status == "keep_closed" and profile.required_checks:
            raise ValueError(f"keep_closed must not require checks: {tool_name}")
        if not profile.reason.strip():
            raise ValueError(f"tool opening profile reason must not be empty: {tool_name}")
    return profiles


TOOL_OPENING_PROFILES = validate_tool_opening_profiles(_TOOL_OPENING_PROFILES)


def _supervisor_go_structured_runtime_command() -> tuple[str, ...]:
    return (
        "go",
        "test",
        "./internal/structuredquery",
        "./internal/structuredplanning",
        "./internal/runtimepolicy",
        "./internal/httpapi",
        "-run",
        "ServiceGuide|ContactDirectory|TransportSchedule|ServiceStatus|StructuredPlan|AllowedTools|StructuredAnswerText|Readyz",
    )


def _campus_services_capability_adapter_command() -> tuple[str, ...]:
    return (
        "uv",
        "run",
        "--all-packages",
        "python",
        "-m",
        "unittest",
        "tests.agent.test_campus_services_capability",
    )


def _app_api_runtime_command() -> tuple[str, ...]:
    return (
        "pnpm",
        "--dir",
        "apps/app-api",
        "exec",
        "vitest",
        "run",
        "-c",
        "vitest.node.config.mts",
        "test/chat-command.service.test.ts",
        "test/chat-command.service.core.suite.ts",
    )


def _public_chat_worker_e2e_command() -> tuple[str, ...]:
    return (
        "pnpm",
        "--dir",
        "apps/public-chat-web",
        "test:worker",
        "--",
        "--runInBand",
        "test/worker.test.ts",
    )


def _app_api_typecheck_command() -> tuple[str, ...]:
    return (
        "pnpm",
        "--dir",
        "apps/app-api",
        "typecheck",
    )


def _public_chat_typecheck_command() -> tuple[str, ...]:
    return (
        "pnpm",
        "--dir",
        "apps/public-chat-web",
        "typecheck",
    )


def run_campus_services_product_path_opening_gate(
    *,
    output_dir: Path,
    command_runner: CommandRunner | None = None,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> CampusServicesProductPathOpeningGateReport:
    output_dir.mkdir(parents=True, exist_ok=True)
    command = command_runner or _run_command
    resolve_git_head = git_head_resolver or _resolve_git_head

    checks = (
        _run_command_check(
            check_id="supervisor_go_structured_runtime_tests",
            command=_supervisor_go_structured_runtime_command(),
            command_runner=command,
            cwd=EXECUTION_CONTROL_DIR,
        ),
        _run_command_check(
            check_id="campus_services_capability_adapter_tests",
            command=_campus_services_capability_adapter_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="app_api_campus_services_runtime_tests",
            command=_app_api_runtime_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="public_chat_worker_e2e_tests",
            command=_public_chat_worker_e2e_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="app_api_typecheck",
            command=_app_api_typecheck_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="public_chat_typecheck",
            command=_public_chat_typecheck_command(),
            command_runner=command,
            cwd=REPO_ROOT,
        ),
    )

    tool_verdicts = _build_tool_opening_verdicts(checks)
    report = CampusServicesProductPathOpeningGateReport(
        output_path=output_dir / DEFAULT_REPORT_NAME,
        passed=all(check.passed for check in checks),
        checks=checks,
        tool_verdicts=tool_verdicts,
    )

    payload = _report_payload(
        report=report,
        git_head=resolve_git_head(),
    )
    report.output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return report


def _run_command_check(
    *,
    check_id: str,
    command: tuple[str, ...],
    command_runner: CommandRunner,
    cwd: Path,
    artifact_path: Path | None = None,
) -> OpeningGateCheck:
    result = command_runner(command, cwd=cwd)
    summary: dict[str, object] = {
        "cwd": str(cwd),
        "returncode": result.returncode,
    }
    if artifact_path is not None:
        summary["artifact_path"] = str(artifact_path)
        summary["artifact_exists"] = artifact_path.exists()
    return OpeningGateCheck(
        check_id=check_id,
        passed=result.returncode == 0,
        summary=summary,
        command=command,
        stdout=result.stdout,
        stderr=result.stderr,
    )


def _build_tool_opening_verdicts(
    checks: tuple[OpeningGateCheck, ...],
) -> tuple[ToolOpeningVerdict, ...]:
    passed_checks = {check.check_id for check in checks if check.passed}
    tool_verdicts: list[ToolOpeningVerdict] = []
    for profile in TOOL_OPENING_PROFILES:
        if profile.product_path_status == "keep_closed":
            tool_verdicts.append(
                ToolOpeningVerdict(
                    tool_name=profile.tool_name,
                    status="keep_closed",
                    required_checks=(),
                    failed_checks=(),
                    reason=profile.reason,
                )
            )
            continue
        failed_checks = tuple(
            check_id for check_id in profile.required_checks if check_id not in passed_checks
        )
        tool_verdicts.append(
            ToolOpeningVerdict(
                tool_name=profile.tool_name,
                status="open" if not failed_checks else "blocked",
                required_checks=profile.required_checks,
                failed_checks=failed_checks,
                reason=profile.reason,
            )
        )
    return tuple(tool_verdicts)


def _report_payload(
    *,
    report: CampusServicesProductPathOpeningGateReport,
    git_head: str | None,
) -> dict[str, object]:
    checks = tuple(asdict(check) for check in report.checks)
    tool_verdicts = tuple(asdict(item) for item in report.tool_verdicts)
    passed_checks = sum(1 for check in report.checks if check.passed)
    failed_checks = len(report.checks) - passed_checks
    opened_tools = sorted(item.tool_name for item in report.tool_verdicts if item.status == "open")
    blocked_tools = sorted(
        item.tool_name for item in report.tool_verdicts if item.status == "blocked"
    )
    closed_tools = sorted(
        item.tool_name for item in report.tool_verdicts if item.status == "keep_closed"
    )
    return {
        "schema_version": DEFAULT_SCHEMA_VERSION,
        "gate_id": DEFAULT_GATE_ID,
        "passed": report.passed,
        "summary": {
            "total_checks": len(report.checks),
            "passed_checks": passed_checks,
            "failed_checks": failed_checks,
            "opened_tools": opened_tools,
            "blocked_tools": blocked_tools,
            "closed_tools": closed_tools,
        },
        "checks": checks,
        "tool_verdicts": tool_verdicts,
        "version_summary": {
            "generated_at": datetime.now(UTC).isoformat(),
            "git_head": git_head,
            "runner": DEFAULT_SCHEMA_VERSION,
        },
        "scope": {
            "local_gate_scope": [
                "deterministic local/runtime/e2e acceptance only",
                "does not claim staging rollout readiness",
            ],
            "staging_gate_scope": [
                "requires staging host live smoke with real dependency readiness",
                "requires rollout decision from opening verdict phase",
            ],
        },
    }


def render_summary_text(report: CampusServicesProductPathOpeningGateReport) -> str:
    opened = [item.tool_name for item in report.tool_verdicts if item.status == "open"]
    blocked = [item.tool_name for item in report.tool_verdicts if item.status == "blocked"]
    closed = [item.tool_name for item in report.tool_verdicts if item.status == "keep_closed"]
    return (
        "campus-services product-path opening gate: "
        f"{'PASS' if report.passed else 'FAIL'} "
        f"opened={','.join(opened) if opened else 'none'} "
        f"blocked={','.join(blocked) if blocked else 'none'} "
        f"closed={','.join(closed) if closed else 'none'} "
        f"artifact={report.output_path}"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run campus-services product-path opening gate.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    accept_parser = subparsers.add_parser(
        "accept",
        help="Run deterministic campus-services product-path opening gate checks.",
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
        raise ValueError(
            "campus-services product-path opening gate is deterministic and requires reruns=1"
        )
    report = run_campus_services_product_path_opening_gate(output_dir=Path(args.output_dir))
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
    "TOOL_OPENING_PROFILES",
    "CampusServicesProductPathOpeningGateReport",
    "CommandResult",
    "OpeningGateCheck",
    "ToolOpeningProfile",
    "ToolOpeningVerdict",
    "build_parser",
    "main",
    "render_summary_text",
    "run_campus_services_product_path_opening_gate",
    "validate_tool_opening_profiles",
]


if __name__ == "__main__":
    raise SystemExit(main())
