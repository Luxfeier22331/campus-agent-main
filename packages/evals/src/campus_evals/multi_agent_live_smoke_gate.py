from __future__ import annotations

import argparse
import json
import socket
from collections.abc import Iterable, Sequence
from pathlib import Path

from campus_evals.workflow_trace_gate import (
    evaluate_workflow_trace_cases,
    load_process_smoke_workflow_trace_summaries,
    load_workflow_trace_cases,
)
from scripts.supervisor_runtime_process_smoke import (
    build_process_smoke_plan,
    run_process_smoke,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_REPORT_NAME = "multi-agent-live-smoke-gate.json"
DEFAULT_SCHEMA_VERSION = "multi_agent_live_smoke_gate.v1"
DEFAULT_GOVERNED_WORKFLOW_PROCESS_SMOKE_PROFILES = (
    "closed_gate",
    "terminal_fail_close",
    "rag_delegate",
    "multi_step_notice_knowledge_followthrough",
    "transport_notice_override_multistep",
    "selected_notice_knowledge_followthrough_ineligible",
)
DEFAULT_SINGLE_SURFACE_SDK_PROCESS_SMOKE_PROFILES = (
    "transport_schedule_sdk_opened",
    "transport_schedule_sdk_opened_stream",
    "service_status_sdk_opened",
    "service_guide_sdk_opened",
    "contact_directory_sdk_opened",
    "notice_discover_sdk_opened",
    "academic_calendar_sdk_opened",
    "transactional_approval_required",
)
DEFAULT_PROCESS_SMOKE_PROFILES = (
    *DEFAULT_GOVERNED_WORKFLOW_PROCESS_SMOKE_PROFILES,
    *DEFAULT_SINGLE_SURFACE_SDK_PROCESS_SMOKE_PROFILES,
)
PROFILE_WORKFLOW_TRACE_CASE_IDS = {
    "terminal_fail_close": "workflow-product-scope-fail-close",
    "rag_delegate": "workflow-knowledge-delegate",
    "multi_step_notice_knowledge_followthrough": (
        "workflow-notice-knowledge-followthrough-multistep"
    ),
    "transport_notice_override_multistep": ("workflow-transport-notice-override-multistep"),
    "selected_notice_knowledge_followthrough_ineligible": (
        "workflow-selected-notice-knowledge-followthrough-ineligible"
    ),
    "transport_schedule_sdk_opened": "workflow-transport-schedule-sdk",
    "transport_schedule_sdk_opened_stream": "workflow-transport-schedule-sdk",
    "service_status_sdk_opened": "workflow-service-status-sdk",
    "service_guide_sdk_opened": "workflow-service-guide-sdk",
    "contact_directory_sdk_opened": "workflow-contact-directory-sdk",
    "notice_discover_sdk_opened": "workflow-notice-discover-sdk",
    "academic_calendar_sdk_opened": "workflow-academic-calendar-sdk",
    "transactional_approval_required": "workflow-transactional-approval-required",
}


def run_multi_agent_live_smoke_gate(
    *,
    output_dir: Path,
    timeout_seconds: float = 45.0,
    profiles: Sequence[str] = DEFAULT_GOVERNED_WORKFLOW_PROCESS_SMOKE_PROFILES,
) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    process_output_dir = output_dir / "process-smoke"
    smoke_summaries = []
    report_paths = []
    for profile in profiles:
        profile_output_dir = process_output_dir / profile
        api_port, worker_port, object_store_port = _reserve_profile_ports()
        plan = build_process_smoke_plan(
            repo_root=REPO_ROOT,
            output_dir=profile_output_dir,
            profile=profile,
            api_port=api_port,
            worker_port=worker_port,
            object_store_port=object_store_port,
        )
        smoke_summary = run_process_smoke(plan, timeout_seconds=timeout_seconds)
        smoke_summaries.append(smoke_summary)
        report_path = profile_output_dir / "process-smoke-summary.json"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(smoke_summary, ensure_ascii=False, indent=2, default=str) + "\n",
            encoding="utf-8",
        )
        report_paths.append(report_path)
    smoke_by_profile = {str(summary.get("profile") or ""): summary for summary in smoke_summaries}
    passed_profiles = [
        profile for profile in profiles if smoke_by_profile.get(profile, {}).get("passed") is True
    ]
    workflow_trace_replay = _workflow_trace_replay(report_paths)
    workflow_replay_failures = (
        list(workflow_trace_replay.get("failed_case_ids") or [])
        + list(workflow_trace_replay.get("missing_case_ids") or [])
        + list(workflow_trace_replay.get("unknown_case_ids") or [])
    )
    payload = {
        "schema_version": DEFAULT_SCHEMA_VERSION,
        "gate_id": "multi_agent_live_smoke",
        "passed": len(passed_profiles) == len(profiles) and not workflow_replay_failures,
        "summary": {
            "total_profiles": len(profiles),
            "passed_profiles": len(passed_profiles),
            "failed_profiles": len(profiles) - len(passed_profiles),
            "workflow_trace_failed_cases": len(workflow_trace_replay.get("failed_case_ids") or []),
            "workflow_trace_missing_cases": len(
                workflow_trace_replay.get("missing_case_ids") or []
            ),
            "workflow_trace_unknown_cases": len(
                workflow_trace_replay.get("unknown_case_ids") or []
            ),
        },
        "scope": {
            "runtime": "direct_local_processes",
            "starts_docker": False,
            "starts_wrangler": False,
            "profiles": list(profiles),
            "probes": [
                "supervisor-agent-worker /internal/bridge/healthz",
                "execution-control /healthz",
                "execution-control /readyz",
                "execution-control /metrics",
                "execution-control /internal/execution/runs closed structured gate",
                "execution-control Temporal RAG activity delegate",
                "execution-control Temporal notice context + RAG multi-step workflow",
                "execution-control Temporal structured single step",
                "execution-control run event projection structured single step",
                "execution-control Temporal campus-services SDK adapter",
                "execution-control Temporal notice discover SDK adapter",
                "execution-control Temporal academic-calendar SDK adapter",
                "execution-control Temporal terminal approval-required guardrail",
            ],
        },
        "process_smoke": smoke_summaries[0] if len(smoke_summaries) == 1 else None,
        "process_smoke_profiles": smoke_summaries,
        "process_smoke_by_profile": smoke_by_profile,
        "workflow_trace_replay": workflow_trace_replay,
    }
    (output_dir / DEFAULT_REPORT_NAME).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    return payload


def _workflow_trace_replay(report_paths: Sequence[Path]) -> dict[str, object]:
    case_set = load_workflow_trace_cases()
    profile_case_ids = _profile_case_ids_from_reports(report_paths)
    expected_case_ids = _unique_case_ids(case_id for _, case_id in profile_case_ids)
    summaries = load_process_smoke_workflow_trace_summaries(
        report_paths,
        profile_case_ids=PROFILE_WORKFLOW_TRACE_CASE_IDS,
    )
    cases_by_id = {case.case_id: case for case in case_set.cases}
    unknown_case_ids = [case_id for case_id in expected_case_ids if case_id not in cases_by_id]
    missing_case_ids = [
        case_id
        for case_id in expected_case_ids
        if case_id in cases_by_id and case_id not in summaries
    ]
    evaluated_case_ids = tuple(
        case_id for case_id in expected_case_ids if case_id in cases_by_id and case_id in summaries
    )
    results = evaluate_workflow_trace_cases(
        (cases_by_id[case_id] for case_id in evaluated_case_ids),
        summaries,
    )
    failed_case_ids = [
        case_id
        for case_id, result in results.items()
        if not all(
            (
                result.direct_vs_delegate_branch_correctness.passed,
                result.handoff_correctness.passed,
                result.tool_argument_precision.passed,
                result.guardrail_correctness.passed,
                result.fail_close_correctness.passed,
                result.trace_projection_completeness.passed,
            )
        )
    ]
    return {
        "case_family": case_set.case_family,
        "evaluated_profiles": [
            profile for profile, case_id in profile_case_ids if case_id in evaluated_case_ids
        ],
        "evaluated_case_ids": list(evaluated_case_ids),
        "failed_case_ids": failed_case_ids,
        "missing_case_ids": missing_case_ids,
        "unknown_case_ids": unknown_case_ids,
        "report_only": False,
    }


def _profile_case_ids_from_reports(report_paths: Sequence[Path]) -> list[tuple[str, str]]:
    profile_case_ids: list[tuple[str, str]] = []
    for report_path in report_paths:
        payload = json.loads(Path(report_path).read_text(encoding="utf-8"))
        profile = str(payload.get("profile") or "").strip()
        case_id = PROFILE_WORKFLOW_TRACE_CASE_IDS.get(profile, "")
        if case_id:
            profile_case_ids.append((profile, case_id))
    return profile_case_ids


def _reserve_profile_ports() -> tuple[int, int, int]:
    return (_reserve_local_port(), _reserve_local_port(), _reserve_local_port())


def _reserve_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return int(sock.getsockname()[1])


def _unique_case_ids(case_ids: Iterable[str]) -> tuple[str, ...]:
    seen: set[str] = set()
    unique = []
    for case_id in case_ids:
        if not case_id or case_id in seen:
            continue
        seen.add(case_id)
        unique.append(case_id)
    return tuple(unique)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run multi-agent direct-process live smoke gate.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    accept_parser = subparsers.add_parser(
        "accept",
        help="Run direct local process multi-agent smoke.",
    )
    accept_parser.add_argument("--output-dir", required=True)
    accept_parser.add_argument(
        "--reruns",
        type=int,
        default=1,
        help="Deterministic gate rerun contract; must be 1.",
    )
    accept_parser.add_argument("--timeout-seconds", type=float, default=45.0)
    accept_parser.add_argument("--verbose", action="store_true")
    accept_parser.add_argument("--log-jsonl")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if args.command != "accept":
        raise ValueError(f"unsupported command: {args.command}")
    if args.reruns != 1:
        raise ValueError("multi-agent live-smoke gate requires reruns=1")
    payload = run_multi_agent_live_smoke_gate(
        output_dir=Path(args.output_dir),
        timeout_seconds=float(args.timeout_seconds),
    )
    if args.verbose:
        print(
            "multi-agent live-smoke gate: "
            f"{'PASS' if payload['passed'] else 'FAIL'} "
            f"artifact={Path(args.output_dir) / DEFAULT_REPORT_NAME}"
        )
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
