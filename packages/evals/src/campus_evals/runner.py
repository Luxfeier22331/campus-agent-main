from __future__ import annotations

from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from dataclasses import replace
from statistics import fmean
from typing import Callable, Protocol

from campus_evals.expectations import KNOWN_DETERMINISTIC_METRICS, evaluate_case
from campus_evals.models import (
    CaseResult,
    ExecutionResult,
    GoldenCase,
    RunReport,
    SupplementalMetricSummary,
    SupplementalResult,
    SummaryCount,
)
from campus_evals.runtime_observability import bind_runtime_event_context


Executor = Callable[[GoldenCase], ExecutionResult]


class SupplementalAdapter(Protocol):
    adapter_id: str

    def evaluate(self, case: GoldenCase, execution: ExecutionResult) -> tuple[SupplementalResult, ...]:
        ...


def run_cases(
    cases: tuple[GoldenCase, ...],
    *,
    executor: Executor,
    split: str | None = None,
    supplemental_adapters: tuple[SupplementalAdapter, ...] = (),
    run_number: int | None = None,
    benchmark_mode: str = "run",
    case_workers: int = 1,
) -> RunReport:
    if case_workers <= 0:
        raise ValueError("case_workers must be greater than zero")
    selected_cases = tuple(case for case in cases if split is None or case.split == split)
    if case_workers == 1 or len(selected_cases) <= 1:
        return summarize_case_results(
            selected_cases,
            tuple(
                _run_case(
                    case,
                    executor=executor,
                    supplemental_adapters=supplemental_adapters,
                    run_number=run_number,
                    benchmark_mode=benchmark_mode,
                )
                for case in selected_cases
            ),
        )

    indexed_results: list[CaseResult | None] = [None] * len(selected_cases)
    with ThreadPoolExecutor(max_workers=case_workers) as pool:
        futures = [
            (
                index,
                pool.submit(
                    copy_context().run,
                    _run_case,
                    case,
                    executor,
                    supplemental_adapters,
                    run_number,
                    benchmark_mode,
                ),
            )
            for index, case in enumerate(selected_cases)
        ]
        for index, future in futures:
            indexed_results[index] = future.result()

    return summarize_case_results(
        selected_cases,
        tuple(result for result in indexed_results if result is not None),
    )


def _run_case(
    case: GoldenCase,
    executor: Executor,
    supplemental_adapters: tuple[SupplementalAdapter, ...],
    run_number: int | None,
    benchmark_mode: str,
) -> CaseResult:
    with bind_runtime_event_context(
        run_number=run_number,
        benchmark_mode=benchmark_mode,
        case_id=case.case_id,
        case_split=case.split,
        expected_status=case.expected_status,
    ):
        execution = executor(case)
        result = evaluate_case(case, execution)
        if execution.observed_trace is not None:
            result = replace(result, observed_trace=execution.observed_trace)
        if execution.request_correlation is not None:
            result = replace(result, request_correlation=execution.request_correlation)
        supplemental_results = _evaluate_supplemental_results(
            case,
            execution,
            supplemental_adapters=supplemental_adapters,
        )
        if supplemental_results:
            result = replace(result, supplemental_results=supplemental_results)
        return result


def summarize_case_results(
    cases: tuple[GoldenCase, ...],
    results: tuple[CaseResult, ...],
) -> RunReport:
    case_index = {case.case_id: case for case in cases}
    unknown_case_ids = sorted({result.case_id for result in results} - set(case_index))
    if unknown_case_ids:
        raise ValueError(f"run results contain unknown case ids: {unknown_case_ids}")

    split_stats: dict[str, Counter[str]] = defaultdict(Counter)
    dimension_stats: dict[str, Counter[str]] = defaultdict(Counter)
    metric_stats: dict[str, Counter[str]] = defaultdict(Counter)
    supplemental_buckets: dict[str, list[SupplementalResult]] = defaultdict(list)

    for result in results:
        case = case_index[result.case_id]
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
        for supplemental in result.supplemental_results:
            supplemental_buckets[_supplemental_bucket_key(supplemental)].append(supplemental)

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
        by_supplemental={
            key: _summarize_supplemental_results(key, items)
            for key, items in sorted(supplemental_buckets.items())
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


def _evaluate_supplemental_results(
    case: GoldenCase,
    execution: ExecutionResult,
    *,
    supplemental_adapters: tuple[SupplementalAdapter, ...],
) -> tuple[SupplementalResult, ...]:
    results: list[SupplementalResult] = []
    for adapter in supplemental_adapters:
        results.extend(adapter.evaluate(case, execution))
    return tuple(results)


def _supplemental_bucket_key(result: SupplementalResult) -> str:
    return f"{result.adapter_id}.{result.metric_name}"


def _summarize_supplemental_results(
    key: str,
    items: list[SupplementalResult],
) -> SupplementalMetricSummary:
    adapter_id, metric_name = key.split(".", 1)
    scored_items = [item.score for item in items if item.score is not None]
    verdict_counts = Counter(
        item.verdict
        for item in items
        if item.verdict is not None
    )
    return SupplementalMetricSummary(
        adapter_id=adapter_id,
        metric_name=metric_name,
        total=len(items),
        score_count=len(scored_items),
        average_score=fmean(scored_items) if scored_items else None,
        verdict_counts=dict(verdict_counts),
        report_only=not any(item.gating for item in items),
        reason="" if items else "no_adapter_results",
    )
