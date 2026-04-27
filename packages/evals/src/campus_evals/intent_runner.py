from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import asdict
from pathlib import Path

from campus_evals.intent_models import (
    IntentCase,
    IntentCaseResult,
    IntentEvalReport,
    ObservedIntent,
)


def run_intent_cases(
    cases: tuple[IntentCase, ...],
    *,
    runner: str = "supervisor-api-go",
) -> IntentEvalReport:
    if runner == "supervisor-api-go":
        from campus_evals.intent_go_runner import run_intent_cases_with_go

        return run_intent_cases_with_go(cases)
    raise ValueError(f"unsupported intent runner: {runner}")


def build_intent_eval_report(
    cases: tuple[IntentCase, ...],
    results: tuple[IntentCaseResult, ...],
) -> IntentEvalReport:
    passed = sum(1 for result in results if result.passed)
    critical_results = tuple(result for result in results if result.critical)
    critical_passed = sum(1 for result in critical_results if result.passed)
    return IntentEvalReport(
        total=len(results),
        passed=passed,
        failed=len(results) - passed,
        overall_exact_match_rate=(passed / len(results)) if results else None,
        critical_total=len(critical_results),
        critical_passed=critical_passed,
        critical_gate_pass_rate=(
            critical_passed / len(critical_results) if critical_results else None
        ),
        confusion=_build_confusion(cases, results),
        results=results,
        capability_accuracy=_field_accuracy(cases, results, "expected_capability", "capability"),
        next_action_accuracy=_field_accuracy(cases, results, "expected_next_action", "next_action"),
        handoff_accuracy=_field_accuracy(cases, results, "expected_target", "target"),
        context_resolution_accuracy=_optional_field_accuracy(
            cases,
            results,
            "expected_context_resolution_state",
            "context_resolution_state",
        ),
        missing_slot_accuracy=_optional_field_accuracy(
            cases,
            results,
            "expected_missing_slots",
            "missing_slots",
        ),
    )


def intent_case_result_from_observed(
    case: IntentCase,
    observed: ObservedIntent,
) -> IntentCaseResult:
    critical = _is_critical_case(case)
    mismatches = (
        _error_mismatches(case, observed)
        if observed.error_code
        else _intent_mismatches(case, observed)
    )
    return IntentCaseResult(
        case_id=case.case_id,
        passed=not mismatches,
        critical=critical,
        observed=observed,
        mismatches=mismatches,
    )


def report_to_dict(report: IntentEvalReport) -> dict[str, object]:
    payload = asdict(report)
    payload["confusion"] = {key: dict(value) for key, value in report.confusion.items()}
    return payload


def _intent_mismatches(case: IntentCase, observed: ObservedIntent) -> dict[str, str]:
    checks = {
        "capability": (observed.capability, case.expected_capability),
        "task_kind": (observed.task_kind, case.expected_task_kind),
        "launch_state": (observed.launch_state, case.expected_launch_state),
        "next_action": (observed.next_action, case.expected_next_action),
        "scope_class": (observed.scope_class, case.expected_scope_class),
        "policy_reason": (observed.policy_reason, case.expected_policy_reason),
        "target": (observed.target, case.expected_target),
        "allowed_tools": (observed.allowed_tools, case.expected_allowed_tools),
    }
    if case.expected_scope_reason:
        checks["scope_reason"] = (observed.scope_reason, case.expected_scope_reason)
    if case.expected_context_resolution_state:
        checks["context_resolution_state"] = (
            observed.context_resolution_state,
            case.expected_context_resolution_state,
        )
    if case.expected_context_reference_type:
        checks["context_reference_type"] = (
            observed.context_reference_type,
            case.expected_context_reference_type,
        )
    if case.expected_missing_slots:
        checks["missing_slots"] = (observed.missing_slots, case.expected_missing_slots)
    return {
        name: f"{actual} != {expected}"
        for name, (actual, expected) in checks.items()
        if actual != expected
    }


def _error_mismatches(case: IntentCase, observed: ObservedIntent) -> dict[str, str]:
    if observed.error_code == case.expected_error_code:
        return {}
    return {"error_code": f"{observed.error_code} != {case.expected_error_code}"}


def _build_confusion(
    cases: tuple[IntentCase, ...],
    results: tuple[IntentCaseResult, ...],
) -> dict[str, dict[str, int]]:
    buckets: dict[str, Counter[str]] = defaultdict(Counter)
    for case, result in zip(cases, results, strict=True):
        observed = result.observed
        buckets["capability"][f"{case.expected_capability}->{observed.capability}"] += 1
        buckets["task_kind"][f"{case.expected_task_kind}->{observed.task_kind}"] += 1
        buckets["launch_state"][f"{case.expected_launch_state}->{observed.launch_state}"] += 1
        buckets["target"][f"{case.expected_target}->{observed.target}"] += 1
        if case.expected_context_resolution_state:
            buckets["context_resolution_state"][
                f"{case.expected_context_resolution_state}->{observed.context_resolution_state}"
            ] += 1
    return {name: dict(counter) for name, counter in buckets.items()}


def _field_accuracy(
    cases: tuple[IntentCase, ...],
    results: tuple[IntentCaseResult, ...],
    expected_field: str,
    observed_field: str,
) -> float | None:
    if not cases:
        return None
    matched = sum(
        1
        for case, result in zip(cases, results, strict=True)
        if getattr(case, expected_field) == getattr(result.observed, observed_field)
    )
    return matched / len(cases)


def _optional_field_accuracy(
    cases: tuple[IntentCase, ...],
    results: tuple[IntentCaseResult, ...],
    expected_field: str,
    observed_field: str,
) -> float | None:
    scoped_pairs = tuple(
        (case, result)
        for case, result in zip(cases, results, strict=True)
        if getattr(case, expected_field)
    )
    if not scoped_pairs:
        return None
    matched = sum(
        1
        for case, result in scoped_pairs
        if getattr(case, expected_field) == getattr(result.observed, observed_field)
    )
    return matched / len(scoped_pairs)


def _is_critical_case(case: IntentCase) -> bool:
    if case.critical:
        return True
    return (
        case.expected_launch_state in {"candidate_only", "closed"}
        or case.expected_next_action in {"out_of_scope", "approval_required", "rejected"}
        or bool(case.expected_error_code)
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run deterministic supervisor intent eval cases.")
    parser.add_argument("--output", required=True, help="Path to write JSON report.")
    parser.add_argument(
        "--suite",
        default="release_gate",
        help=(
            "Intent suite name: release_gate, context_follow_up, observed_regression, "
            "version_compat, synthetic_regression, synthetic_exploratory."
        ),
    )
    parser.add_argument(
        "--runner",
        default="supervisor-api-go",
        choices=("supervisor-api-go",),
        help="Intent runner to use.",
    )
    args = parser.parse_args(argv)

    from campus_evals.intent_scenarios import intent_suite_cases

    report = run_intent_cases(intent_suite_cases(args.suite), runner=args.runner)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report_to_dict(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0 if report.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "build_intent_eval_report",
    "intent_case_result_from_observed",
    "main",
    "report_to_dict",
    "run_intent_cases",
]
