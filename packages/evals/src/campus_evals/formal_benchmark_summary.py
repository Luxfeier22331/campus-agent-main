from __future__ import annotations

from collections import Counter, defaultdict
from statistics import fmean

from campus_evals.formal_benchmark_artifacts import _case_set_summary, _write_json
from campus_evals.formal_benchmark_preflight import _skipped_supplemental_metric_details
from campus_evals.judge_gate import evaluate_judge_gate
from campus_evals.models import GoldenCase, RunReport, SupplementalResult
from campus_evals.supplemental_http import classify_runtime_failure


def _write_benchmark_summary(
    *,
    output_dir,
    benchmark_type: str,
    reruns: int,
    cases: tuple[GoldenCase, ...],
    policy: dict[str, object],
    run_reports: list[RunReport],
    provenance: dict[str, object] | None = None,
    repair: dict[str, object] | None = None,
    supplemental_preflight: dict[str, object] | None = None,
    provider_summary: dict[str, object] | None = None,
    runtime_events_path=None,
    runtime_event_session_id: str | None = None,
) -> dict[str, object]:
    case_index = {case.case_id: case for case in cases}
    deterministic_summary = _summarize_deterministic_runs(run_reports)
    supplemental_summary = _summarize_supplemental_across_runs(
        run_reports=run_reports,
        case_index=case_index,
        supplemental_preflight=supplemental_preflight,
    )
    supplemental_runtime = _summarize_supplemental_runtime_health(supplemental_summary)
    gate_report = evaluate_judge_gate(policy, supplemental_summary)
    deterministic_gate = _evaluate_optional_deterministic_gate(
        policy=policy,
        deterministic_summary=deterministic_summary,
    )
    gate_report = {
        **gate_report,
        "supplemental_runtime": supplemental_runtime,
    }
    if deterministic_gate is not None:
        gate_report = {
            **gate_report,
            "overall_verdict": _merge_gate_verdict(
                str(gate_report.get("overall_verdict") or "pass"),
                str(deterministic_gate["verdict"]),
            ),
            "deterministic_gate": deterministic_gate,
        }
    if provenance is not None:
        gate_report = {
            **gate_report,
            "provenance": provenance,
        }
    if repair is not None:
        gate_report = {
            **gate_report,
            "repair": repair,
        }
    summary = {
        "schema_version": 1,
        "benchmark_type": benchmark_type,
        "reruns": reruns,
        "case_set": _case_set_summary(cases),
        "deterministic": deterministic_summary,
        "aggregate": {
            "supplemental": supplemental_summary,
        },
        "supplemental_runtime": supplemental_runtime,
        "gate_report": gate_report,
    }
    if provenance is not None:
        summary["provenance"] = provenance
    if repair is not None:
        summary["repair"] = repair
    if supplemental_preflight is not None:
        summary["supplemental_preflight"] = supplemental_preflight
    if provider_summary is not None:
        summary["supplemental_provider_summary"] = provider_summary
    if runtime_events_path is not None:
        summary["runtime_observability"] = {
            "events_path": str(runtime_events_path),
            "session_id": runtime_event_session_id,
            "provider_summary_path": str(output_dir / "supplemental-provider-summary.json"),
        }
    _write_json(output_dir / "summary.json", summary)
    _write_json(output_dir / "gate-report.json", gate_report)
    (output_dir / "SUMMARY.md").write_text(
        _render_summary_markdown(summary),
        encoding="utf-8",
    )
    return summary


def _summarize_deterministic_runs(run_reports: list[RunReport]) -> dict[str, object]:
    run_pass_counts = [report.passed for report in run_reports]
    run_pass_rates = [
        (report.passed / report.total) if report.total else None for report in run_reports
    ]
    return {
        "run_count": len(run_reports),
        "run_pass_counts": run_pass_counts,
        "run_failed_counts": [report.failed for report in run_reports],
        "run_pass_rates": run_pass_rates,
        "mean_pass_rate": fmean(item for item in run_pass_rates if item is not None)
        if run_pass_rates
        else None,
        "stable_across_runs": len(set(run_pass_counts)) == 1,
    }


def _evaluate_optional_deterministic_gate(
    *,
    policy: dict[str, object],
    deterministic_summary: dict[str, object],
) -> dict[str, object] | None:
    deterministic_policy = policy.get("deterministic_gate")
    if not isinstance(deterministic_policy, dict):
        return None

    reasons: list[str] = []
    required_runs = int(policy["required_runs"])
    run_count = int(deterministic_summary.get("run_count") or 0)
    run_pass_rates = list(deterministic_summary.get("run_pass_rates") or ())
    mean_pass_rate = _read_optional_float(deterministic_summary.get("mean_pass_rate"))
    min_run_pass_rate = (
        min(rate for rate in run_pass_rates if rate is not None)
        if any(rate is not None for rate in run_pass_rates)
        else None
    )
    if run_count < required_runs:
        reasons.append("insufficient_total_runs")
    expected_min_mean = _read_optional_float(deterministic_policy.get("min_mean_pass_rate"))
    if mean_pass_rate is None:
        if expected_min_mean is not None:
            reasons.append("missing_mean_pass_rate")
    elif expected_min_mean is not None and mean_pass_rate < expected_min_mean:
        reasons.append("mean_pass_rate_below_threshold")
    expected_min_run = _read_optional_float(deterministic_policy.get("min_run_pass_rate"))
    if min_run_pass_rate is None:
        if expected_min_run is not None:
            reasons.append("missing_run_pass_rate")
    elif expected_min_run is not None and min_run_pass_rate < expected_min_run:
        reasons.append("min_run_pass_rate_below_threshold")
    if bool(deterministic_policy.get("require_stable_across_runs")) and not bool(
        deterministic_summary.get("stable_across_runs")
    ):
        reasons.append("unstable_across_runs")

    gate_level = str(deterministic_policy["gate_level"])
    verdict = "pass" if not reasons else ("fail" if gate_level == "hard_gate" else "warn")
    return {
        "gate_level": gate_level,
        "verdict": verdict,
        "thresholds": {
            "min_mean_pass_rate": expected_min_mean,
            "min_run_pass_rate": expected_min_run,
            "require_stable_across_runs": bool(
                deterministic_policy.get("require_stable_across_runs")
            ),
            "required_runs": required_runs,
        },
        "observed": {
            "run_count": run_count,
            "run_pass_counts": list(deterministic_summary.get("run_pass_counts") or ()),
            "run_failed_counts": list(deterministic_summary.get("run_failed_counts") or ()),
            "run_pass_rates": run_pass_rates,
            "mean_pass_rate": mean_pass_rate,
            "min_run_pass_rate": min_run_pass_rate,
            "stable_across_runs": bool(deterministic_summary.get("stable_across_runs")),
        },
        "reasons": reasons,
    }


def _merge_gate_verdict(current: str, candidate: str) -> str:
    if current == "fail" or candidate == "fail":
        return "fail"
    if current == "warn" or candidate == "warn":
        return "warn"
    return "pass"


def _read_optional_float(value: object) -> float | None:
    if value is None:
        return None
    return float(value)


def _summarize_supplemental_across_runs(
    *,
    run_reports: list[RunReport],
    case_index: dict[str, GoldenCase],
    supplemental_preflight: dict[str, object] | None = None,
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
            bucket = [
                supplemental
                for case, supplemental in items
                if case.expected_status == expected_status
            ]
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
            "run_average_drift": (max(run_average_scores) - min(run_average_scores))
            if run_average_scores
            else None,
            "by_expected_status": by_expected_status,
            "overall": _summarize_supplemental_bucket([supplemental for _, supplemental in items]),
        }
    if supplemental_preflight is not None:
        for metric_key, metric_payload in _build_preflight_unavailable_metric_aggregates(
            run_reports=run_reports,
            supplemental_preflight=supplemental_preflight,
        ).items():
            aggregate.setdefault(metric_key, metric_payload)
    return aggregate


def _summarize_supplemental_bucket(items: list[SupplementalResult]) -> dict[str, object]:
    scored_items = [item.score for item in items if item.score is not None]
    runtime_failures = [
        _supplemental_runtime_failure(item)
        for item in items
        if item.verdict == "failed" and item.score is None
    ]
    transient_runtime_failure_count = sum(
        1 for failure in runtime_failures if failure["disposition"] == "transient_retryable"
    )
    hard_unavailable_failure_count = sum(
        1 for failure in runtime_failures if failure["disposition"] == "hard_unavailable"
    )
    non_retryable_runtime_failure_count = sum(
        1 for failure in runtime_failures if failure["disposition"] == "non_retryable_request"
    )
    failure_disposition_counts = Counter(
        failure["disposition"] for failure in runtime_failures if failure["disposition"]
    )
    verdict_counts = Counter(item.verdict for item in items if item.verdict is not None)
    runtime_status = _resolve_supplemental_runtime_status(
        score_count=len(scored_items),
        verdict_counts=verdict_counts,
        transient_runtime_failure_count=transient_runtime_failure_count,
        hard_unavailable_failure_count=hard_unavailable_failure_count,
        non_retryable_runtime_failure_count=non_retryable_runtime_failure_count,
    )
    return {
        "total": len(items),
        "score_count": len(scored_items),
        "average_score": fmean(scored_items) if scored_items else None,
        "verdict_counts": dict(verdict_counts),
        "runtime_status": runtime_status,
        "transient_runtime_failure_count": transient_runtime_failure_count,
        "hard_unavailable_failure_count": hard_unavailable_failure_count,
        "non_retryable_runtime_failure_count": non_retryable_runtime_failure_count,
        "failure_disposition_counts": dict(failure_disposition_counts),
        "preflight_failure_count": 0,
        "preflight_failure_reasons": [],
        "skip_reason": "",
        "runtime_failure_reasons": sorted(
            {reason for failure in runtime_failures for reason in failure["reasons"]}
        ),
    }


def _supplemental_runtime_failure(item: SupplementalResult) -> dict[str, object]:
    if item.verdict != "failed" or item.score is not None:
        return {"reasons": (), "disposition": None}
    metadata = dict(item.metadata or {})
    metadata_reasons = tuple(str(reason) for reason in metadata.get("failure_reasons") or ())
    metadata_disposition = metadata.get("failure_disposition")
    if metadata_reasons or metadata_disposition:
        return {
            "reasons": metadata_reasons,
            "disposition": str(metadata_disposition) if metadata_disposition is not None else None,
        }
    classification = classify_runtime_failure(
        item.rationale,
        error_type=str(metadata.get("judge_error") or ""),
    )
    return {
        "reasons": classification.reasons,
        "disposition": classification.disposition,
    }


def _resolve_supplemental_runtime_status(
    *,
    score_count: int,
    verdict_counts: Counter[str],
    transient_runtime_failure_count: int,
    hard_unavailable_failure_count: int,
    non_retryable_runtime_failure_count: int,
) -> str:
    if score_count > 0:
        return "available"
    failed_count = int(verdict_counts.get("failed", 0))
    if failed_count == 0:
        return "not_applicable_only"
    runtime_unavailable_failure_count = (
        transient_runtime_failure_count + hard_unavailable_failure_count
    )
    if (
        runtime_unavailable_failure_count == failed_count
        and non_retryable_runtime_failure_count == 0
    ):
        return "unavailable"
    return "degraded"


def _summarize_supplemental_runtime_health(
    aggregate: dict[str, dict[str, object]],
) -> dict[str, object]:
    status_to_metric_keys: dict[str, list[str]] = defaultdict(list)
    for metric_key, metric_summary in aggregate.items():
        overall = dict(metric_summary.get("overall") or {})
        status = str(overall.get("runtime_status") or "unknown")
        status_to_metric_keys[status].append(metric_key)
    return {
        "status_counts": {
            status: len(metric_keys)
            for status, metric_keys in sorted(status_to_metric_keys.items())
        },
        "metric_keys_by_status": {
            status: sorted(metric_keys)
            for status, metric_keys in sorted(status_to_metric_keys.items())
        },
    }


def _render_summary_markdown(summary: dict[str, object]) -> str:
    deterministic = summary["deterministic"]
    gate_report = summary["gate_report"]
    deterministic_gate = (
        gate_report.get("deterministic_gate") if isinstance(gate_report, dict) else None
    )
    benchmark_title = str(summary.get("benchmark_type") or "benchmark").replace("_", " ").title()
    lines = [
        f"# {benchmark_title}",
        "",
        f"- benchmark_type: `{summary['benchmark_type']}`",
        f"- reruns: `{summary['reruns']}`",
        f"- total_cases: `{summary['case_set']['total_cases']}`",
        f"- gate verdict: `{gate_report['overall_verdict']}`",
    ]
    provenance = summary.get("provenance")
    if isinstance(provenance, dict):
        lines.append(f"- provenance.mode: `{provenance.get('mode')}`")
        lines.append(f"- provenance.repair_of: `{provenance.get('repair_of')}`")
    repair = summary.get("repair")
    if isinstance(repair, dict):
        lines.append(f"- repair.selected_tool_count: `{repair.get('selected_tool_count')}`")
        lines.append(f"- repair.applied_target_count: `{repair.get('applied_target_count')}`")
    supplemental_preflight = summary.get("supplemental_preflight")
    if isinstance(supplemental_preflight, dict):
        lines.append(
            f"- supplemental_preflight.status_counts: `{supplemental_preflight.get('summary', {}).get('status_counts')}`"
        )
    supplemental_runtime = summary.get("supplemental_runtime")
    if isinstance(supplemental_runtime, dict):
        lines.append(
            f"- supplemental_runtime.status_counts: `{supplemental_runtime.get('status_counts')}`"
        )
    runtime_observability = summary.get("runtime_observability")
    if isinstance(runtime_observability, dict):
        lines.append(
            f"- runtime_observability.events_path: `{runtime_observability.get('events_path')}`"
        )
    lines.extend(
        (
            "",
            "## Deterministic Stability",
            "",
            f"- run_pass_counts: `{deterministic['run_pass_counts']}`",
            f"- run_pass_rates: `{deterministic['run_pass_rates']}`",
            f"- stable_across_runs: `{deterministic['stable_across_runs']}`",
            "",
        )
    )
    if isinstance(deterministic_gate, dict):
        lines.extend(
            (
                "## Deterministic Gate",
                "",
                f"- verdict: `{deterministic_gate['verdict']}`",
                f"- thresholds: `{deterministic_gate['thresholds']}`",
                f"- reasons: `{deterministic_gate['reasons']}`",
                "",
            )
        )
    lines.extend(
        (
            "## Supplemental Metrics",
            "",
        )
    )
    supplemental = summary["aggregate"]["supplemental"]
    if not supplemental:
        lines.append("- none")
    else:
        for metric_key, metric_summary in supplemental.items():
            lines.append(
                f"- `{metric_key}`: mean={metric_summary['mean_average_score']}, min_run={metric_summary['min_run_average_score']}, drift={metric_summary['run_average_drift']}, applicable_runs={metric_summary['applicable_runs']}, runtime={metric_summary['overall']['runtime_status']}"
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


def _build_preflight_unavailable_metric_aggregates(
    *,
    run_reports: list[RunReport],
    supplemental_preflight: dict[str, object],
) -> dict[str, dict[str, object]]:
    skipped_metrics = _skipped_supplemental_metric_details(supplemental_preflight)
    aggregates: dict[str, dict[str, object]] = {}
    for metric_key, details in skipped_metrics.items():
        failure_disposition = str(details.get("failure_disposition") or "unknown")
        failure_reasons = list(details.get("failure_reasons") or [])
        failure_disposition_counts = {failure_disposition: 1} if failure_disposition else {}
        aggregates[metric_key] = {
            "metric_key": metric_key,
            "run_count": len(run_reports),
            "applicable_runs": 0,
            "run_average_scores": [],
            "mean_average_score": None,
            "min_run_average_score": None,
            "max_run_average_score": None,
            "run_average_drift": None,
            "by_expected_status": {},
            "overall": {
                "total": 0,
                "score_count": 0,
                "average_score": None,
                "verdict_counts": {},
                "runtime_status": "unavailable",
                "transient_runtime_failure_count": 1
                if failure_disposition == "transient_retryable"
                else 0,
                "hard_unavailable_failure_count": 1
                if failure_disposition == "hard_unavailable"
                else 0,
                "non_retryable_runtime_failure_count": 0,
                "failure_disposition_counts": failure_disposition_counts,
                "preflight_failure_count": 1,
                "preflight_failure_reasons": failure_reasons,
                "skip_reason": "preflight_unavailable",
                "runtime_failure_reasons": failure_reasons,
            },
        }
    return aggregates
