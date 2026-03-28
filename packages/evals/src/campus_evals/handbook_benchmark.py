from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, is_dataclass
import json
from pathlib import Path
from statistics import fmean
from typing import Callable

from campus_evals.judge_gate import evaluate_judge_gate, load_judge_gate_policy
from campus_evals.models import CaseResult, ExecutionResult, GoldenCase, RunReport, SupplementalResult, SummaryCount
from campus_evals.runner import SupplementalAdapter, run_cases


Executor = Callable[[GoldenCase], ExecutionResult]


def run_handbook_formal_benchmark(
    *,
    cases: tuple[GoldenCase, ...],
    executor: Executor,
    supplemental_adapters: tuple[SupplementalAdapter, ...],
    output_dir: str | Path,
    reruns: int,
    policy_path: str | Path | None = None,
    benchmark_type: str = "formal_benchmark",
) -> dict[str, object]:
    if reruns <= 0:
        raise ValueError("reruns must be greater than zero")
    resolved_output_dir = Path(output_dir)
    resolved_output_dir.mkdir(parents=True, exist_ok=True)
    policy = load_judge_gate_policy(policy_path)
    case_index = {case.case_id: case for case in cases}

    _write_json(
        resolved_output_dir / "benchmark-config.json",
        {
            "schema_version": 1,
            "benchmark_type": benchmark_type,
            "reruns": reruns,
            "policy_path": policy.get("path"),
            "supplemental_adapters": [adapter.adapter_id for adapter in supplemental_adapters],
            "case_set": _case_set_summary(cases),
        },
    )

    run_reports: list[RunReport] = []
    for run_number in range(1, reruns + 1):
        report = run_cases(
            cases,
            executor=executor,
            supplemental_adapters=supplemental_adapters,
        )
        run_reports.append(report)
        run_prefix = f"run-{run_number:02d}"
        _write_json(
            resolved_output_dir / f"{run_prefix}-case-results.json",
            {
                "schema_version": 1,
                "benchmark_type": benchmark_type,
                "run_number": run_number,
                "results": [_serialize_case_result(result) for result in report.results],
            },
        )
        _write_json(
            resolved_output_dir / f"{run_prefix}-summary.json",
            {
                "schema_version": 1,
                "benchmark_type": benchmark_type,
                "run_number": run_number,
                "summary": _serialize_run_report(report),
            },
        )

    supplemental_summary = _summarize_supplemental_across_runs(run_reports=run_reports, case_index=case_index)
    gate_report = evaluate_judge_gate(policy, supplemental_summary)
    summary = {
        "schema_version": 1,
        "benchmark_type": benchmark_type,
        "reruns": reruns,
        "case_set": _case_set_summary(cases),
        "deterministic": _summarize_deterministic_runs(run_reports),
        "aggregate": {
            "supplemental": supplemental_summary,
        },
        "gate_report": gate_report,
    }
    _write_json(resolved_output_dir / "summary.json", summary)
    _write_json(resolved_output_dir / "gate-report.json", gate_report)
    (resolved_output_dir / "SUMMARY.md").write_text(
        _render_summary_markdown(summary),
        encoding="utf-8",
    )
    return summary


def _case_set_summary(cases: tuple[GoldenCase, ...]) -> dict[str, object]:
    split_counts = Counter(case.split for case in cases)
    expected_status_counts = Counter(case.expected_status for case in cases)
    return {
        "total_cases": len(cases),
        "case_ids": [case.case_id for case in cases],
        "split_counts": dict(split_counts),
        "expected_status_counts": dict(expected_status_counts),
    }


def _serialize_run_report(report: RunReport) -> dict[str, object]:
    return {
        "total": report.total,
        "passed": report.passed,
        "failed": report.failed,
        "by_split": {name: _serialize_summary_count(item) for name, item in report.by_split.items()},
        "by_dimension": {name: _serialize_summary_count(item) for name, item in report.by_dimension.items()},
        "by_metric": {name: _serialize_summary_count(item) for name, item in report.by_metric.items()},
        "by_supplemental": {
            name: _serialize_dataclass(item)
            for name, item in report.by_supplemental.items()
        },
    }


def _serialize_case_result(result: CaseResult) -> dict[str, object]:
    return {
        "case_id": result.case_id,
        "passed": result.passed,
        "status_result": _serialize_dimension_result(result.status_result),
        "retrieval_result": _serialize_dimension_result(result.retrieval_result),
        "answer_result": _serialize_dimension_result(result.answer_result),
        "trace_result": _serialize_dimension_result(result.trace_result),
        "metric_results": {
            name: _serialize_dimension_result(metric_result)
            for name, metric_result in result.metric_results.items()
        },
        "supplemental_results": [
            _serialize_dataclass(item)
            for item in result.supplemental_results
        ],
    }


def _serialize_summary_count(item: SummaryCount) -> dict[str, object]:
    return {
        "total": item.total,
        "passed": item.passed,
        "failed": item.failed,
        "pass_rate": item.pass_rate,
        "reason": item.reason,
    }


def _serialize_dimension_result(item: object) -> dict[str, object]:
    if is_dataclass(item):
        return asdict(item)
    return dict(item)


def _serialize_dataclass(item: object) -> dict[str, object]:
    if is_dataclass(item):
        return asdict(item)
    if isinstance(item, dict):
        return dict(item)
    raise TypeError(f"cannot serialize object of type {type(item)!r}")


def _summarize_deterministic_runs(run_reports: list[RunReport]) -> dict[str, object]:
    run_pass_counts = [report.passed for report in run_reports]
    run_pass_rates = [
        (report.passed / report.total) if report.total else None
        for report in run_reports
    ]
    return {
        "run_count": len(run_reports),
        "run_pass_counts": run_pass_counts,
        "run_failed_counts": [report.failed for report in run_reports],
        "run_pass_rates": run_pass_rates,
        "mean_pass_rate": fmean(item for item in run_pass_rates if item is not None) if run_pass_rates else None,
        "stable_across_runs": len(set(run_pass_counts)) == 1,
    }


def _summarize_supplemental_across_runs(
    *,
    run_reports: list[RunReport],
    case_index: dict[str, GoldenCase],
) -> dict[str, dict[str, object]]:
    per_metric_items: dict[str, list[tuple[GoldenCase, SupplementalResult]]] = defaultdict(list)
    per_metric_run_averages: dict[str, list[float]] = defaultdict(list)
    all_metric_keys: set[str] = set()

    for report in run_reports:
        all_metric_keys.update(report.by_supplemental.keys())
        for metric_key, metric_summary in report.by_supplemental.items():
            if metric_summary.average_score is not None:
                per_metric_run_averages[metric_key].append(metric_summary.average_score)
        for result in report.results:
            case = case_index[result.case_id]
            for supplemental in result.supplemental_results:
                metric_key = f"{supplemental.adapter_id}.{supplemental.metric_name}"
                all_metric_keys.add(metric_key)
                per_metric_items[metric_key].append((case, supplemental))

    aggregate: dict[str, dict[str, object]] = {}
    for metric_key in sorted(all_metric_keys):
        items = per_metric_items.get(metric_key, [])
        by_expected_status: dict[str, dict[str, object]] = {}
        for expected_status in sorted({case.expected_status for case, _ in items}):
            bucket = [supplemental for case, supplemental in items if case.expected_status == expected_status]
            by_expected_status[expected_status] = _summarize_supplemental_bucket(bucket)
        run_average_scores = per_metric_run_averages.get(metric_key, [])
        aggregate[metric_key] = {
            "metric_key": metric_key,
            "run_count": len(run_reports),
            "applicable_runs": len(run_average_scores),
            "run_average_scores": run_average_scores,
            "mean_average_score": fmean(run_average_scores) if run_average_scores else None,
            "min_run_average_score": min(run_average_scores) if run_average_scores else None,
            "max_run_average_score": max(run_average_scores) if run_average_scores else None,
            "run_average_drift": (max(run_average_scores) - min(run_average_scores)) if run_average_scores else None,
            "by_expected_status": by_expected_status,
            "overall": _summarize_supplemental_bucket([supplemental for _, supplemental in items]),
        }
    return aggregate


def _summarize_supplemental_bucket(items: list[SupplementalResult]) -> dict[str, object]:
    scored_items = [item.score for item in items if item.score is not None]
    verdict_counts = Counter(
        item.verdict
        for item in items
        if item.verdict is not None
    )
    return {
        "total": len(items),
        "score_count": len(scored_items),
        "average_score": fmean(scored_items) if scored_items else None,
        "verdict_counts": dict(verdict_counts),
    }


def _render_summary_markdown(summary: dict[str, object]) -> str:
    deterministic = summary["deterministic"]
    gate_report = summary["gate_report"]
    lines = [
        "# Student Handbook Formal Benchmark",
        "",
        f"- benchmark_type: `{summary['benchmark_type']}`",
        f"- reruns: `{summary['reruns']}`",
        f"- total_cases: `{summary['case_set']['total_cases']}`",
        f"- gate verdict: `{gate_report['overall_verdict']}`",
        "",
        "## Deterministic Stability",
        "",
        f"- run_pass_counts: `{deterministic['run_pass_counts']}`",
        f"- run_pass_rates: `{deterministic['run_pass_rates']}`",
        f"- stable_across_runs: `{deterministic['stable_across_runs']}`",
        "",
        "## Supplemental Metrics",
        "",
    ]
    supplemental = summary["aggregate"]["supplemental"]
    if not supplemental:
        lines.append("- none")
    else:
        for metric_key, metric_summary in supplemental.items():
            lines.append(
                f"- `{metric_key}`: mean={metric_summary['mean_average_score']}, min_run={metric_summary['min_run_average_score']}, drift={metric_summary['run_average_drift']}, applicable_runs={metric_summary['applicable_runs']}"
            )
    lines.extend(
        (
            "",
            "## Gate",
            "",
        )
    )
    for metric_report in gate_report["metrics"]:
        lines.append(
            f"- `{metric_report['metric_key']}`: verdict={metric_report['verdict']}, reasons={metric_report['reasons']}"
        )
    return "\n".join(lines) + "\n"


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
