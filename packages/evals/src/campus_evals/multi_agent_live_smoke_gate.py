from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
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
DEFAULT_PROCESS_SMOKE_PROFILES = (
    "closed_gate",
    "terminal_fail_close",
    "rag_delegate",
    "structured_direct_opened",
    "structured_direct_opened_stream",
    "notice_get_direct_opened",
)
PROFILE_WORKFLOW_TRACE_CASE_IDS = {
    "terminal_fail_close": "workflow-transactional-service-fail-close",
    "rag_delegate": "workflow-knowledge-delegate",
    "structured_direct_opened": "workflow-transport-schedule-direct",
    "structured_direct_opened_stream": "workflow-transport-schedule-direct",
    "notice_get_direct_opened": "workflow-notice-detail-direct",
}


def run_multi_agent_live_smoke_gate(
    *,
    output_dir: Path,
    timeout_seconds: float = 45.0,
    profiles: Sequence[str] = DEFAULT_PROCESS_SMOKE_PROFILES,
) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    process_output_dir = output_dir / "process-smoke"
    smoke_summaries = []
    report_paths = []
    for profile in profiles:
        profile_output_dir = process_output_dir / profile
        plan = build_process_smoke_plan(
            repo_root=REPO_ROOT,
            output_dir=profile_output_dir,
            profile=profile,
        )
        smoke_summary = run_process_smoke(plan, timeout_seconds=timeout_seconds)
        smoke_summaries.append(smoke_summary)
        report_path = profile_output_dir / "process-smoke-summary.json"
        if not report_path.exists():
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
    payload = {
        "schema_version": DEFAULT_SCHEMA_VERSION,
        "gate_id": "multi_agent_live_smoke",
        "passed": len(passed_profiles) == len(profiles),
        "summary": {
            "total_profiles": len(profiles),
            "passed_profiles": len(passed_profiles),
            "failed_profiles": len(profiles) - len(passed_profiles),
        },
        "scope": {
            "runtime": "direct_local_processes",
            "starts_docker": False,
            "starts_wrangler": False,
            "profiles": list(profiles),
            "probes": [
                "supervisor-agent-worker /internal/bridge/healthz",
                "supervisor-api /healthz",
                "supervisor-api /readyz",
                "supervisor-api /metrics",
                "supervisor-api /api/v1/answer closed structured gate",
                "supervisor-api /api/v1/answer RAG delegate",
                "supervisor-api /api/v1/answer opened structured direct runtime",
                "supervisor-api /api/v1/answer/stream opened structured direct runtime",
                "supervisor-api /api/v1/answer opened notice direct runtime",
            ],
        },
        "process_smoke": smoke_summaries[0] if len(smoke_summaries) == 1 else None,
        "process_smoke_profiles": smoke_summaries,
        "process_smoke_by_profile": smoke_by_profile,
        "workflow_trace_replay": _workflow_trace_replay(report_paths),
    }
    (output_dir / DEFAULT_REPORT_NAME).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    return payload


def _workflow_trace_replay(report_paths: Sequence[Path]) -> dict[str, object]:
    case_set = load_workflow_trace_cases()
    summaries = load_process_smoke_workflow_trace_summaries(
        report_paths,
        profile_case_ids=PROFILE_WORKFLOW_TRACE_CASE_IDS,
    )
    cases_by_id = {case.case_id: case for case in case_set.cases}
    evaluated_case_ids = tuple(case_id for case_id in summaries if case_id in cases_by_id)
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
            profile
            for profile, case_id in PROFILE_WORKFLOW_TRACE_CASE_IDS.items()
            if case_id in evaluated_case_ids
        ],
        "evaluated_case_ids": list(evaluated_case_ids),
        "failed_case_ids": failed_case_ids,
        "report_only": True,
    }


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
        help="Accepted for shared eval_gate profile compatibility; must be 1.",
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
