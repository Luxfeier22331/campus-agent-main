from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from campus_ingestion_core.service_guide_projection import (
    write_service_guide_projection_release_from_source_truth_manifest,
)

from campus_evals.intent_models import IntentCase, IntentEvalReport
from campus_evals.intent_runner import report_to_dict, run_intent_cases
from campus_evals.intent_scenarios import intent_release_gate_cases
from campus_evals.official_web_selected_write_preview_runtime_verifier import (
    BUNDLE_SCOPE_FULL_IMPACT,
    BUNDLE_SCOPE_TASK_SCOPE,
    OfficialWebSelectedWritePreviewRuntimeVerificationReport,
    run_selected_write_preview_runtime_verification,
)
from campus_evals.official_web_selected_write_tool_readiness_audit import (
    audit_selected_write_preview_report,
)
from campus_evals.service_guide_projection_eval import (
    evaluate_service_guide_projection_bundle,
    load_default_service_guide_projection_eval_cases,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
EXECUTION_CONTROL_DIR = REPO_ROOT / "apps" / "execution-control"
DEFAULT_REPORT_NAME = "service-guide-lookup-release-gate.json"
DEFAULT_SOURCE_TRUTH_MANIFEST = (
    REPO_ROOT / "configs/ingestion/campus_services/service_guide/source-truth.v1.json"
)
DEFAULT_GENERATED_AT = "2026-04-26T00:00:00+08:00"
DEFAULT_RELEASE_ID = "service-guide-lookup-release-gate"
SUPERVISOR_GO_SERVICE_GUIDE_TEST_COMMAND = (
    "go",
    "test",
    "./internal/structuredquery",
    "./internal/structuredplanning",
    "./internal/runtimepolicy",
    "./internal/httpapi",
    "-run",
    "ServiceGuide|StructuredPlan|AllowedTools|StructuredAnswerText|Readyz",
)
CAMPUS_SERVICES_AGENT_TEST_COMMAND = (
    "python",
    "-m",
    "unittest",
    "tests.agent.test_campus_services_agent",
)
APP_API_SERVICE_GUIDE_TEST_COMMAND = (
    "pnpm",
    "--dir",
    "apps/app-api",
    "exec",
    "vitest",
    "run",
    "-c",
    "vitest.node.config.mts",
    "test/chat-command.service.test.ts",
    "-t",
    "renders campus-services answers from structured tool facts and safe source categories",
)
SERVICE_GUIDE_MATRIX_COVERAGE: dict[str, object] = {
    "total_cases": 33,
    "positive_service_guide_cases": 20,
    "boundary_cases": 7,
    "fail_close_cases": 6,
    "focus_counts": {
        "contact": 3,
        "eligibility": 2,
        "entry": 5,
        "full_guide": 1,
        "office_hours": 2,
        "procedure": 4,
        "required_materials": 3,
    },
}
SERVICE_GUIDE_PUBLIC_CHAT_SUBSET_COVERAGE: dict[str, object] = {
    "case_ids": [
        "public-entry-campus-card-loss-guide",
        "public-entry-academic-calendar-guide-entry",
        "public-entry-public-medical-materials",
        "public-entry-vpn-login-entry",
    ],
    "matrix_case_ids": [
        "sg-procedure-campus-card-loss",
        "sg-entry-calendar-url",
        "sg-materials-medical-reimbursement",
        "sg-entry-vpn-login",
    ],
    "coverage_class": "representative_public_chat_subset",
}


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
class ServiceGuideLookupReleaseGateReport:
    passed: bool
    output_path: Path
    checks: tuple[ReleaseGateCheck, ...]


IntentRunner = Callable[[tuple[IntentCase, ...]], IntentEvalReport]
RuntimeSmokeRunner = Callable[[Path], dict[str, object]]
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


class _NoopObjectStore:
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        return None


def service_guide_lookup_intent_gate_cases() -> tuple[IntentCase, ...]:
    return tuple(
        case
        for case in intent_release_gate_cases()
        if case.expected_allowed_tools == ("service_guide_lookup",)
        or (
            case.expected_capability == "campus_services"
            and case.expected_next_action == "approval_required"
        )
    )


def run_service_guide_lookup_release_gate(
    *,
    output_dir: Path,
    source_truth_manifest_path: Path = DEFAULT_SOURCE_TRUTH_MANIFEST,
    command_runner: CommandRunner | None = None,
    intent_runner: IntentRunner | None = None,
    include_runtime_smoke: bool = False,
    runtime_smoke_runner: RuntimeSmokeRunner | None = None,
    selected_write_preview_report_path: Path | None = None,
    selected_write_preview_runtime_runner: SelectedWritePreviewRuntimeRunner | None = None,
) -> ServiceGuideLookupReleaseGateReport:
    output_dir.mkdir(parents=True, exist_ok=True)
    projection_dir = output_dir / "projection"
    resolved_command_runner = command_runner or _run_command
    resolved_intent_runner = intent_runner or _run_intent_cases

    checks = [
        _run_projection_eval_check(
            output_dir=projection_dir,
            source_truth_manifest_path=source_truth_manifest_path,
        ),
        _run_intent_gate_check(
            output_dir=output_dir,
            intent_runner=resolved_intent_runner,
        ),
        _run_command_check(
            check_id="supervisor_go_service_guide_tests",
            command=SUPERVISOR_GO_SERVICE_GUIDE_TEST_COMMAND,
            command_runner=resolved_command_runner,
            cwd=EXECUTION_CONTROL_DIR,
        ),
        _run_command_check(
            check_id="campus_services_agent_contract_tests",
            command=CAMPUS_SERVICES_AGENT_TEST_COMMAND,
            command_runner=resolved_command_runner,
            cwd=REPO_ROOT,
        ),
        _run_command_check(
            check_id="app_api_service_guide_structured_answer_tests",
            command=APP_API_SERVICE_GUIDE_TEST_COMMAND,
            command_runner=resolved_command_runner,
            cwd=REPO_ROOT,
        ),
    ]
    if include_runtime_smoke:
        checks.append(
            _run_selected_write_runtime_smoke_check(
                output_dir=output_dir / "selected-write-runtime-smoke",
                runtime_smoke_runner=runtime_smoke_runner or _run_selected_write_runtime_smoke,
            )
        )
    if selected_write_preview_report_path is not None:
        checks.append(
            _run_selected_write_preview_tool_readiness_check(
                output_dir=output_dir / "selected-write-preview-tool-readiness",
                report_path=selected_write_preview_report_path,
                collection="service_guide",
            )
        )
        checks.append(
            _run_selected_write_preview_runtime_verification_check(
                output_dir=output_dir / "selected-write-preview-runtime-verification",
                report_path=selected_write_preview_report_path,
                bundle_scope=BUNDLE_SCOPE_TASK_SCOPE,
                check_id="selected_write_preview_runtime_verification_task_scope",
                runtime_runner=selected_write_preview_runtime_runner
                or _run_selected_write_preview_runtime_verification,
            )
        )
        checks.append(
            _run_selected_write_preview_runtime_verification_check(
                output_dir=output_dir / "selected-write-preview-runtime-verification-full-impact",
                report_path=selected_write_preview_report_path,
                bundle_scope=BUNDLE_SCOPE_FULL_IMPACT,
                check_id="selected_write_preview_runtime_verification_full_impact",
                runtime_runner=selected_write_preview_runtime_runner
                or _run_selected_write_preview_runtime_verification,
            )
        )
    report = ServiceGuideLookupReleaseGateReport(
        passed=all(check.passed for check in checks),
        output_path=output_dir / DEFAULT_REPORT_NAME,
        checks=tuple(checks),
    )
    report.output_path.write_text(
        json.dumps(_report_payload(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return report


def _run_projection_eval_check(
    *,
    output_dir: Path,
    source_truth_manifest_path: Path,
) -> ReleaseGateCheck:
    output_dir.mkdir(parents=True, exist_ok=True)
    projection_report = write_service_guide_projection_release_from_source_truth_manifest(
        source_truth_manifest_path=source_truth_manifest_path,
        output_dir=output_dir,
        generated_at=DEFAULT_GENERATED_AT,
        object_store=_NoopObjectStore(),
        bucket="campus-rag-derived",
        release_id=DEFAULT_RELEASE_ID,
    )
    bundle = json.loads(Path(projection_report.current_projection_path).read_text(encoding="utf-8"))
    eval_report = evaluate_service_guide_projection_bundle(
        bundle,
        cases=load_default_service_guide_projection_eval_cases(),
    )
    summary: dict[str, object] = {
        "projection_path": str(projection_report.current_projection_path),
        "release_manifest_path": str(projection_report.release_manifest_path),
        "manual_review_report_path": str(projection_report.manual_review_report_path),
        "service_guide_records": len(bundle.get("service_guide_records") or ()),
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
    cases = service_guide_lookup_intent_gate_cases()
    report = intent_runner(cases)
    intent_report_path = output_dir / "service-guide-lookup-intent-gate.json"
    intent_report_path.write_text(
        json.dumps(report_to_dict(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return ReleaseGateCheck(
        check_id="intent_service_guide_cases",
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


def _run_selected_write_runtime_smoke_check(
    *,
    output_dir: Path,
    runtime_smoke_runner: RuntimeSmokeRunner,
) -> ReleaseGateCheck:
    try:
        payload = runtime_smoke_runner(output_dir)
    except Exception as exc:
        return ReleaseGateCheck(
            check_id="selected_write_runtime_smoke",
            passed=False,
            summary={"error": str(exc), "output_dir": str(output_dir)},
        )
    projection = payload.get("projection") if isinstance(payload.get("projection"), dict) else {}
    probes = payload.get("probes") if isinstance(payload.get("probes"), dict) else {}
    failed_probe_ids = probes.get("failed_probe_ids") if isinstance(probes, dict) else []
    summary = {
        "output_dir": str(output_dir),
        "release_id": str(projection.get("release_id") or ""),
        "service_guide_records": int(projection.get("service_guide_records") or 0),
        "conflict_records": int(projection.get("conflict_records") or 0),
        "manual_review_sources": int(projection.get("manual_review_sources") or 0),
        "failed_probe_ids": failed_probe_ids if isinstance(failed_probe_ids, list) else [],
    }
    return ReleaseGateCheck(
        check_id="selected_write_runtime_smoke",
        passed=payload.get("passed") is True,
        summary=summary,
    )


def _run_selected_write_runtime_smoke(output_dir: Path) -> dict[str, object]:
    from scripts.service_guide_selected_write_runtime_smoke import (
        build_service_guide_selected_write_runtime_smoke_plan,
        run_service_guide_selected_write_runtime_smoke,
    )

    plan = build_service_guide_selected_write_runtime_smoke_plan(
        repo_root=REPO_ROOT,
        output_dir=output_dir,
    )
    return run_service_guide_selected_write_runtime_smoke(plan)


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


def _run_intent_cases(cases: tuple[IntentCase, ...]) -> IntentEvalReport:
    return run_intent_cases(cases, runner="execution-control-go")


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


def _report_payload(report: ServiceGuideLookupReleaseGateReport) -> dict[str, object]:
    checks = tuple(asdict(check) for check in report.checks)
    failed = sum(1 for check in report.checks if not check.passed)
    return {
        "schema_version": "service_guide_lookup_release_gate.v1",
        "gate_id": "service_guide_lookup",
        "passed": report.passed,
        "summary": {
            "total_checks": len(report.checks),
            "passed_checks": len(report.checks) - failed,
            "failed_checks": failed,
        },
        "coverage": {
            "coverage_sources": {
                "deterministic_matrix": "QUESTION-MATRIX.md",
                "representative_public_chat_subset": (
                    "packages/evals/fixtures/public_chat_entry_cases.v1.json"
                ),
            },
            "matrix": SERVICE_GUIDE_MATRIX_COVERAGE,
            "public_chat_subset": SERVICE_GUIDE_PUBLIC_CHAT_SUBSET_COVERAGE,
        },
        "checks": checks,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run service_guide_lookup release gate.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    accept_parser = subparsers.add_parser(
        "accept",
        help="Run deterministic service_guide_lookup release gate checks.",
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
        help="Deterministic gate rerun contract; must be 1.",
    )
    accept_parser.add_argument(
        "--source-truth-manifest",
        default=str(DEFAULT_SOURCE_TRUTH_MANIFEST),
        help="service_guide source-truth manifest path.",
    )
    accept_parser.add_argument("--verbose", action="store_true")
    accept_parser.add_argument("--log-jsonl")
    accept_parser.add_argument(
        "--include-runtime-smoke",
        action="store_true",
        help=(
            "Also run the read-only selected-write runtime smoke against local "
            "Postgres current service_guide projection."
        ),
    )
    accept_parser.add_argument(
        "--selected-write-preview-report",
        help="Optional real selected-write preview report path for answer-facing tool-readiness audit.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if args.command != "accept":
        raise ValueError(f"unsupported command: {args.command}")
    if args.reruns != 1:
        raise ValueError("service_guide_lookup release gate is deterministic and requires reruns=1")
    report = run_service_guide_lookup_release_gate(
        output_dir=Path(args.output_dir),
        source_truth_manifest_path=Path(args.source_truth_manifest),
        include_runtime_smoke=bool(args.include_runtime_smoke),
        selected_write_preview_report_path=(
            Path(args.selected_write_preview_report) if args.selected_write_preview_report else None
        ),
    )
    if args.verbose:
        print(
            "service_guide_lookup release gate: "
            f"{'PASS' if report.passed else 'FAIL'} "
            f"artifact={report.output_path}"
        )
    return 0 if report.passed else 1


__all__ = [
    "APP_API_SERVICE_GUIDE_TEST_COMMAND",
    "CAMPUS_SERVICES_AGENT_TEST_COMMAND",
    "DEFAULT_REPORT_NAME",
    "SERVICE_GUIDE_MATRIX_COVERAGE",
    "SERVICE_GUIDE_PUBLIC_CHAT_SUBSET_COVERAGE",
    "SUPERVISOR_GO_SERVICE_GUIDE_TEST_COMMAND",
    "CommandResult",
    "ReleaseGateCheck",
    "RuntimeSmokeRunner",
    "SelectedWritePreviewRuntimeRunner",
    "ServiceGuideLookupReleaseGateReport",
    "main",
    "run_service_guide_lookup_release_gate",
    "service_guide_lookup_intent_gate_cases",
]


if __name__ == "__main__":
    raise SystemExit(main())
