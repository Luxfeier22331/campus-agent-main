from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from campus_ingestion_core.contact_directory_projection import (
    assert_contact_directory_projection_release_ready,
    build_contact_directory_projection_bundle_from_handbook_document_units,
    write_contact_directory_projection_release,
)

from campus_evals.contact_directory_projection_eval import (
    evaluate_contact_directory_projection_bundle,
    load_default_contact_directory_projection_eval_cases,
)
from campus_evals.intent_models import IntentCase, IntentEvalReport
from campus_evals.intent_runner import report_to_dict, run_intent_cases
from campus_evals.official_web_selected_write_tool_readiness_audit import (
    audit_selected_write_preview_report,
)
from campus_evals.official_web_selected_write_preview_runtime_verifier import (
    BUNDLE_SCOPE_FULL_IMPACT,
    BUNDLE_SCOPE_TASK_SCOPE,
    OfficialWebSelectedWritePreviewRuntimeVerificationReport,
    run_selected_write_preview_runtime_verification,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
SUPERVISOR_API_DIR = REPO_ROOT / "apps" / "supervisor-api"
DEFAULT_REPORT_NAME = "contact-directory-lookup-release-gate.json"
DEFAULT_GENERATED_AT = "2026-04-27T00:00:00+08:00"
DEFAULT_RELEASE_ID = "contact-directory-lookup-release-gate"
SUPERVISOR_GO_CONTACT_DIRECTORY_TEST_COMMAND = (
    "go",
    "test",
    "./internal/structuredquery",
    "./internal/structuredplanning",
    "./internal/runtimepolicy",
    "./internal/httpapi",
    "-run",
    "ContactDirectory|StructuredPlan|AllowedTools|StructuredAnswerText|Readyz",
)
CAMPUS_SERVICES_AGENT_TEST_COMMAND = (
    "python",
    "-m",
    "unittest",
    "tests.agent.test_campus_services_agent",
)
APP_API_CONTACT_DIRECTORY_TEST_COMMAND = (
    "pnpm",
    "--dir",
    "apps/app-api",
    "exec",
    "vitest",
    "run",
    "-c",
    "vitest.node.config.mts",
    "test/chat-command.service.test.ts",
)
DEFAULT_DOCUMENT_UNITS = (
    {
        "unit_type": "policy_page",
        "clean_text": "校园110 68932220\n研究生院(学位办)办公室 68932649",
        "anchor": {
            "section_path": ["校级办公与公共服务"],
            "page_start": 261,
            "page_end": 261,
        },
    },
    {
        "unit_type": "policy_page",
        "clean_text": "信息化建设管理处办公室 68933381",
        "anchor": {
            "section_path": ["机关部门办公电话"],
            "page_start": 261,
            "page_end": 261,
        },
    },
)


@dataclass(frozen=True, slots=True)
class CommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


@dataclass(frozen=True, slots=True)
class ReleaseGateCheck:
    check_id: str
    passed: bool
    summary: dict[str, object]
    command: tuple[str, ...] = ()
    stdout: str = ""
    stderr: str = ""


@dataclass(frozen=True, slots=True)
class ContactDirectoryLookupReleaseGateReport:
    passed: bool
    output_path: Path
    checks: tuple[ReleaseGateCheck, ...]


IntentRunner = Callable[[tuple[IntentCase, ...]], IntentEvalReport]
SelectedWritePreviewRuntimeRunner = Callable[
    ...,
    OfficialWebSelectedWritePreviewRuntimeVerificationReport,
]


class CommandRunner(Protocol):
    def __call__(
        self,
        command: tuple[str, ...],
        *,
        cwd: Path | None = None,
    ) -> CommandResult: ...


def contact_directory_lookup_intent_gate_cases() -> tuple[IntentCase, ...]:
    return (
        IntentCase(
            case_id="intent-contact-directory-001",
            user_goal="研究生院招生办公室电话是多少",
            requested_capability="knowledge",
            expected_capability="campus_services",
            expected_task_kind="campus_services_lookup",
            expected_launch_state="open",
            expected_next_action="delegate",
            expected_scope_class="in_scope",
            expected_scope_reason="structured_runtime_candidate_signal",
            expected_target="campus-services-agent",
            expected_allowed_tools=("contact_directory_lookup",),
            critical=True,
            tags=("campus_services", "contact_directory"),
        ),
        IntentCase(
            case_id="intent-contact-directory-002",
            user_goal="教务处邮箱是什么",
            requested_capability="knowledge",
            expected_capability="campus_services",
            expected_task_kind="campus_services_lookup",
            expected_launch_state="open",
            expected_next_action="delegate",
            expected_scope_class="in_scope",
            expected_scope_reason="structured_runtime_candidate_signal",
            expected_target="campus-services-agent",
            expected_allowed_tools=("contact_directory_lookup",),
            critical=True,
            tags=("campus_services", "contact_directory"),
        ),
        IntentCase(
            case_id="intent-contact-directory-003",
            user_goal="国际合作处办公地点在哪里",
            requested_capability="knowledge",
            expected_capability="campus_services",
            expected_task_kind="campus_services_lookup",
            expected_launch_state="open",
            expected_next_action="delegate",
            expected_scope_class="in_scope",
            expected_scope_reason="structured_runtime_candidate_signal",
            expected_target="campus-services-agent",
            expected_allowed_tools=("contact_directory_lookup",),
            critical=True,
            tags=("campus_services", "contact_directory"),
        ),
        IntentCase(
            case_id="intent-contact-directory-004",
            user_goal="研究生院办公室电话",
            requested_capability="campus_services",
            expected_capability="campus_services",
            expected_task_kind="campus_services_lookup",
            expected_launch_state="open",
            expected_next_action="delegate",
            expected_scope_class="in_scope",
            expected_scope_reason="explicit_requested_capability",
            expected_target="campus-services-agent",
            expected_allowed_tools=("contact_directory_lookup",),
            critical=True,
            tags=("campus_services", "contact_directory", "explicit_requested_capability"),
        ),
        IntentCase(
            case_id="intent-contact-directory-action-guardrail-001",
            user_goal="帮我打电话给研究生院招生办公室",
            requested_capability="campus_services",
            expected_capability="campus_services",
            expected_task_kind="campus_services_lookup",
            expected_launch_state="closed",
            expected_next_action="approval_required",
            expected_scope_class="in_scope",
            expected_policy_reason="approval_required",
            expected_scope_reason="transaction_guardrail",
            expected_target="none",
            critical=True,
            tags=("campus_services", "contact_directory", "approval_required"),
        ),
        IntentCase(
            case_id="intent-contact-directory-action-guardrail-002",
            user_goal="帮我发邮件给国际合作处",
            requested_capability="campus_services",
            expected_capability="campus_services",
            expected_task_kind="campus_services_lookup",
            expected_launch_state="closed",
            expected_next_action="approval_required",
            expected_scope_class="in_scope",
            expected_policy_reason="approval_required",
            expected_scope_reason="transaction_guardrail",
            expected_target="none",
            critical=True,
            tags=("campus_services", "contact_directory", "approval_required"),
        ),
    )


def run_contact_directory_lookup_release_gate(
    *,
    output_dir: Path,
    command_runner: CommandRunner | None = None,
    intent_runner: IntentRunner | None = None,
    selected_write_preview_report_path: Path | None = None,
    selected_write_preview_runtime_runner: SelectedWritePreviewRuntimeRunner | None = None,
) -> ContactDirectoryLookupReleaseGateReport:
    output_dir.mkdir(parents=True, exist_ok=True)
    projection_dir = output_dir / "projection"
    resolved_command_runner = command_runner or _run_command
    resolved_intent_runner = intent_runner or _run_intent_cases

    checks = (
        _run_projection_eval_check(output_dir=projection_dir),
        _run_intent_gate_check(
            output_dir=output_dir,
            intent_runner=resolved_intent_runner,
        ),
        _run_command_check(
            check_id="supervisor_go_contact_directory_tests",
            command=SUPERVISOR_GO_CONTACT_DIRECTORY_TEST_COMMAND,
            command_runner=resolved_command_runner,
            cwd=SUPERVISOR_API_DIR,
        ),
        _run_command_check(
            check_id="campus_services_agent_contract_tests",
            command=CAMPUS_SERVICES_AGENT_TEST_COMMAND,
            command_runner=resolved_command_runner,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="app_api_contact_directory_structured_answer_tests",
            command=APP_API_CONTACT_DIRECTORY_TEST_COMMAND,
            command_runner=resolved_command_runner,
            cwd=REPO_ROOT,
        ),
    ) + (
        (
            _run_selected_write_preview_tool_readiness_check(
                output_dir=output_dir / "selected-write-preview-tool-readiness",
                report_path=selected_write_preview_report_path,
                collection="contact_directory",
            ),
            _run_selected_write_preview_runtime_verification_check(
                output_dir=output_dir / "selected-write-preview-runtime-verification",
                report_path=selected_write_preview_report_path,
                bundle_scope=BUNDLE_SCOPE_TASK_SCOPE,
                check_id="selected_write_preview_runtime_verification_task_scope",
                runtime_runner=selected_write_preview_runtime_runner
                or _run_selected_write_preview_runtime_verification,
            ),
            _run_selected_write_preview_runtime_verification_check(
                output_dir=output_dir / "selected-write-preview-runtime-verification-full-impact",
                report_path=selected_write_preview_report_path,
                bundle_scope=BUNDLE_SCOPE_FULL_IMPACT,
                check_id="selected_write_preview_runtime_verification_full_impact",
                runtime_runner=selected_write_preview_runtime_runner
                or _run_selected_write_preview_runtime_verification,
            ),
        )
        if selected_write_preview_report_path is not None
        else ()
    )
    report = ContactDirectoryLookupReleaseGateReport(
        passed=all(check.passed for check in checks),
        output_path=output_dir / DEFAULT_REPORT_NAME,
        checks=checks,
    )
    report.output_path.write_text(
        json.dumps(_report_payload(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return report


def _run_projection_eval_check(
    *,
    output_dir: Path,
) -> ReleaseGateCheck:
    output_dir.mkdir(parents=True, exist_ok=True)
    build_result = build_contact_directory_projection_bundle_from_handbook_document_units(
        document_units=DEFAULT_DOCUMENT_UNITS,
        generated_at=DEFAULT_GENERATED_AT,
        source_title="中央民族大学校内常用电话",
        source_page_start=261,
        source_page_end=261,
    )
    assert_contact_directory_projection_release_ready(
        build_result.bundle,
        expected_ready_records=3,
    )
    release_report = write_contact_directory_projection_release(
        bundle=build_result.bundle,
        output_dir=output_dir,
        release_id=DEFAULT_RELEASE_ID,
        generated_at=DEFAULT_GENERATED_AT,
        manual_review_sources=build_result.manual_review_sources,
    )
    eval_report = evaluate_contact_directory_projection_bundle(
        build_result.bundle,
        cases=load_default_contact_directory_projection_eval_cases(),
    )
    summary: dict[str, object] = {
        "projection_path": release_report.current_projection_path,
        "release_manifest_path": release_report.release_manifest_path,
        "manual_review_report_path": release_report.manual_review_report_path,
        "contact_records": len(build_result.bundle.get("contact_records") or ()),
        "conflict_records": len(build_result.bundle.get("conflict_records") or ()),
        "manual_review_sources": len(build_result.bundle.get("manual_review_sources") or ()),
        "eval": eval_report.summary,
        "failed_case_ids": eval_report.failed_case_ids,
    }
    return ReleaseGateCheck(
        check_id="projection_default_cases",
        passed=eval_report.passed,
        summary=summary,
    )


def _run_intent_gate_check(
    *,
    output_dir: Path,
    intent_runner: IntentRunner,
) -> ReleaseGateCheck:
    cases = contact_directory_lookup_intent_gate_cases()
    report = intent_runner(cases)
    intent_report_path = output_dir / "contact-directory-lookup-intent-gate.json"
    intent_report_path.write_text(
        json.dumps(report_to_dict(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return ReleaseGateCheck(
        check_id="intent_contact_directory_cases",
        passed=report.failed == 0,
        summary={
            "intent_report_path": str(intent_report_path),
            "total": report.total,
            "passed": report.passed,
            "failed": report.failed,
            "critical_total": report.critical_total,
            "critical_passed": report.critical_passed,
        },
    )


def _run_command_check(
    *,
    check_id: str,
    command: tuple[str, ...],
    command_runner: CommandRunner,
    cwd: Path,
) -> ReleaseGateCheck:
    result = command_runner(command, cwd=cwd)
    return ReleaseGateCheck(
        check_id=check_id,
        passed=result.returncode == 0,
        command=command,
        stdout=result.stdout,
        stderr=result.stderr,
        summary={"returncode": result.returncode, "cwd": str(cwd)},
    )


def _run_intent_cases(cases: tuple[IntentCase, ...]) -> IntentEvalReport:
    return run_intent_cases(cases, runner="supervisor-api-go")


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


def _run_selected_write_preview_tool_readiness_check(
    *,
    output_dir: Path,
    report_path: Path,
    collection: str,
) -> ReleaseGateCheck:
    audit = audit_selected_write_preview_report(
        report_path=report_path,
        output_dir=output_dir,
    )
    relevant = [item for item in audit.record_results if item.collection == collection]
    failed = [item for item in relevant if not item.passed]
    return ReleaseGateCheck(
        check_id="selected_write_preview_tool_readiness",
        passed=bool(relevant) and not failed,
        summary={
            "report_path": str(report_path),
            "audit_output_path": str(audit.output_path),
            "collection": collection,
            "record_count": len(relevant),
            "failed_record_ids": [item.selected_write_id for item in failed],
        },
    )


def _run_selected_write_preview_runtime_verification_check(
    *,
    output_dir: Path,
    report_path: Path,
    bundle_scope: str,
    check_id: str,
    runtime_runner: SelectedWritePreviewRuntimeRunner,
) -> ReleaseGateCheck:
    report = runtime_runner(
        report_path=report_path,
        output_dir=output_dir,
        bundle_scope=bundle_scope,
    )
    summary = dict(report.summary)
    summary["report_path"] = str(report_path)
    summary["runtime_output_path"] = str(report.output_path)
    return ReleaseGateCheck(
        check_id=check_id,
        passed=report.passed,
        summary=summary,
    )


def _run_selected_write_preview_runtime_verification(
    *,
    report_path: Path,
    output_dir: Path,
    bundle_scope: str,
) -> OfficialWebSelectedWritePreviewRuntimeVerificationReport:
    return run_selected_write_preview_runtime_verification(
        report_path=report_path,
        output_dir=output_dir,
        bundle_scope=bundle_scope,
    )


def _report_payload(report: ContactDirectoryLookupReleaseGateReport) -> dict[str, object]:
    checks = tuple(asdict(check) for check in report.checks)
    failed = sum(1 for check in report.checks if not check.passed)
    return {
        "schema_version": "contact_directory_lookup_release_gate.v1",
        "gate_id": "contact_directory_lookup",
        "passed": report.passed,
        "summary": {
            "total_checks": len(report.checks),
            "passed_checks": len(report.checks) - failed,
            "failed_checks": failed,
        },
        "checks": checks,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run contact_directory_lookup release gate.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    accept_parser = subparsers.add_parser(
        "accept",
        help="Run deterministic contact_directory_lookup release gate checks.",
    )
    accept_parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory for release gate artifacts.",
    )
    accept_parser.add_argument(
        "--reruns",
        type=int,
        default=1,
        help="Accepted for shared eval_gate profile compatibility; must be 1.",
    )
    accept_parser.add_argument(
        "--selected-write-preview-report",
        help="Optional real selected-write preview report path for answer-facing tool-readiness audit.",
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
            "contact_directory_lookup release gate is deterministic and requires reruns=1"
        )
    report = run_contact_directory_lookup_release_gate(
        output_dir=Path(args.output_dir),
        selected_write_preview_report_path=(
            Path(args.selected_write_preview_report)
            if args.selected_write_preview_report
            else None
        ),
    )
    if args.verbose:
        print(
            "contact_directory_lookup release gate: "
            f"{'PASS' if report.passed else 'FAIL'} "
            f"artifact={report.output_path}"
        )
    return 0 if report.passed else 1


__all__ = [
    "CAMPUS_SERVICES_AGENT_TEST_COMMAND",
    "DEFAULT_REPORT_NAME",
    "SUPERVISOR_GO_CONTACT_DIRECTORY_TEST_COMMAND",
    "CommandResult",
    "ContactDirectoryLookupReleaseGateReport",
    "ReleaseGateCheck",
    "SelectedWritePreviewRuntimeRunner",
    "contact_directory_lookup_intent_gate_cases",
    "main",
    "run_contact_directory_lookup_release_gate",
]


if __name__ == "__main__":
    raise SystemExit(main())
