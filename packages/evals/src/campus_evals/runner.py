from __future__ import annotations

from collections import Counter, defaultdict
from typing import Callable

from campus_evals.expectations import KNOWN_DETERMINISTIC_METRICS, evaluate_case
from campus_evals.models import CaseResult, ExecutionResult, GoldenCase, RunReport, SummaryCount


Executor = Callable[[GoldenCase], ExecutionResult]


def run_cases(
    cases: tuple[GoldenCase, ...],
    *,
    executor: Executor,
    split: str | None = None,
) -> RunReport:
    selected_cases = tuple(case for case in cases if split is None or case.split == split)
    results: list[CaseResult] = []
    split_stats: dict[str, Counter[str]] = defaultdict(Counter)
    dimension_stats: dict[str, Counter[str]] = defaultdict(Counter)
    metric_stats: dict[str, Counter[str]] = defaultdict(Counter)

    for case in selected_cases:
        result = evaluate_case(case, executor(case))
        results.append(result)
        split_stats[case.split]["total"] += 1
        split_stats[case.split]["passed" if result.passed else "failed"] += 1
        for name, dimension in (
            ("status", result.status_result),
            ("retrieval", result.retrieval_result),
            ("answer", result.answer_result),
            ("trace", result.trace_result),
        ):
            dimension_stats[name]["total"] += 1
            dimension_stats[name]["passed" if dimension.passed else "failed"] += 1
        for name, metric_result in result.metric_results.items():
            metric_stats[name]["total"] += 1
            metric_stats[name]["passed" if metric_result.passed else "failed"] += 1

    passed = sum(1 for result in results if result.passed)
    total = len(results)
    return RunReport(
        total=total,
        passed=passed,
        failed=total - passed,
        by_split={name: _summary_from_counter(counter) for name, counter in split_stats.items()},
        by_dimension={name: _summary_from_counter(counter) for name, counter in dimension_stats.items()},
        by_metric={
            name: _summary_from_counter(metric_stats.get(name, Counter()))
            for name in _metric_summary_names(metric_stats)
        },
        results=tuple(results),
    )


def _summary_from_counter(counter: Counter[str]) -> SummaryCount:
    total = counter.get("total", 0)
    passed = counter.get("passed", 0)
    failed = counter.get("failed", 0)
    return SummaryCount(
        total=total,
        passed=passed,
        failed=failed,
        pass_rate=(passed / total) if total else None,
        reason="" if total else "no_applicable_cases",
    )


def _metric_summary_names(metric_stats: dict[str, Counter[str]]) -> tuple[str, ...]:
    extras = sorted(name for name in metric_stats if name not in KNOWN_DETERMINISTIC_METRICS)
    return KNOWN_DETERMINISTIC_METRICS + tuple(extras)
