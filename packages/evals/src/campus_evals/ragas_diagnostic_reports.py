from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path

from campus_evals.ragas_adapter_projection import RagasProjection


def combine_ragas_diagnostic_reports(
    reports: list[Mapping[str, object]],
    *,
    schema_version: str,
    low_score_threshold: float,
) -> dict[str, object]:
    merged_cases_by_key: dict[tuple[str, str], dict[str, object]] = {}
    case_order: list[tuple[str, str]] = []
    metric_names: list[str] = []

    for report in reports:
        report_metric_names = _metric_names_for_report(report)
        for metric_name in report_metric_names:
            if metric_name not in metric_names:
                metric_names.append(metric_name)
        for source_case in _cases_for_report(report):
            case_key = _combined_case_key(source_case)
            if case_key not in merged_cases_by_key:
                merged_cases_by_key[case_key] = _base_combined_case(source_case)
                case_order.append(case_key)
            target_case = merged_cases_by_key[case_key]
            target_scores = target_case.setdefault("scores", {})
            if not isinstance(target_scores, dict):
                raise ValueError("combined case scores must be a mapping")
            source_scores = source_case.get("scores")
            if isinstance(source_scores, dict):
                for metric_name, score in source_scores.items():
                    target_scores[str(metric_name)] = (
                        float(score) if isinstance(score, int | float) else None
                    )
            source_metric_failures = _case_metric_failures_for_report(
                source_case,
                metric_names=tuple(report_metric_names),
            )
            if source_metric_failures:
                metric_failures = target_case.setdefault("metric_failures", [])
                if not isinstance(metric_failures, list):
                    raise ValueError("combined case metric_failures must be a list")
                metric_failures.extend(source_metric_failures)
                target_case["status"] = "failed"

    cases = [merged_cases_by_key[key] for key in case_order]
    failed_cases = [case for case in cases if isinstance(case.get("metric_failures"), list)]
    summary = {
        "total_reports": len(reports),
        "total_cases": len(cases),
        "completed_cases": len(cases) - len(failed_cases),
        "failed_cases": len(failed_cases),
        "low_score_threshold": low_score_threshold,
        "run_configs": _run_configs_for_reports(reports),
        "metrics": _summarize_combined_metrics(cases, metric_names=tuple(metric_names)),
        "low_score_cases": _low_score_cases(
            cases,
            metric_names=tuple(metric_names),
            low_score_threshold=low_score_threshold,
        ),
    }
    return {
        "schema_version": schema_version,
        "report_id": "ragas_diagnostic_combined",
        "passed": all(bool(report.get("passed")) for report in reports) and not failed_cases,
        "mode": "diagnostic_non_blocking",
        "summary": summary,
        "cases": cases,
    }


def identity_grounding_score(projection: RagasProjection) -> float:
    if str(projection.metadata.get("answer_shape") or "") != "title_lookup":
        return 0.0
    if str(projection.metadata.get("presentation_kind") or "") != "document_identity":
        return 0.0
    if _reference_doc_ids(projection).isdisjoint(_supporting_doc_ids(projection)):
        return 0.0
    response = str(projection.response or "")
    if "《" not in response or "》" not in response:
        return 0.0
    return 1.0


def passed_case_result(
    *,
    case_spec: dict[str, object],
    projection: RagasProjection,
    scores: Mapping[str, float | None],
    metric_names: tuple[str, ...],
    metric_applicability: Mapping[str, bool],
    duration_ms: int,
    performance_breakdown: Mapping[str, int],
    low_score_threshold: float,
) -> dict[str, object]:
    applicable_metric_names = tuple(
        metric_name for metric_name in metric_names if metric_applicability.get(metric_name, True)
    )
    metric_scores = {name: scores.get(name) for name in applicable_metric_names}
    if not applicable_metric_names:
        return _case_result_payload(
            case_spec=case_spec,
            projection=projection,
            status="completed",
            duration_ms=duration_ms,
            performance_breakdown=performance_breakdown,
            failure_attribution={"primary_stage": "passed", "metric_failures": {}},
            scores={},
        )
    metric_failures = _unavailable_metric_failures(
        metric_scores,
        metric_names=applicable_metric_names,
        projection=projection,
    )
    failure_attribution = _attribute_case_failure(
        projection=projection,
        scores=metric_scores,
        metric_names=applicable_metric_names,
        low_score_threshold=low_score_threshold,
    )
    result = _case_result_payload(
        case_spec=case_spec,
        projection=projection,
        status="failed" if metric_failures else "completed",
        duration_ms=duration_ms,
        performance_breakdown=performance_breakdown,
        failure_attribution=failure_attribution,
        scores=metric_scores,
    )
    if metric_failures:
        result["error_type"] = "RagasMetricUnavailable"
        result["error_message"] = str(metric_failures[0]["error_message"])
        result["metric_failures"] = metric_failures
    return result


def failed_case_result(
    *,
    case_spec: dict[str, object],
    exc: Exception,
    duration_ms: int,
) -> dict[str, object]:
    return {
        **case_spec,
        "status": "failed",
        "error_type": type(exc).__name__,
        "error_message": str(exc),
        "duration_ms": duration_ms,
        "scores": {},
    }


def case_performance_breakdown(
    *,
    projection_breakdown: Mapping[str, int],
    scorer_ms: int,
    duration_ms: int,
) -> dict[str, int]:
    retrieval_ms = int(projection_breakdown.get("retrieval_ms") or 0)
    answer_ms = int(projection_breakdown.get("answer_ms") or 0)
    diagnostic_ms = max(0, duration_ms - retrieval_ms - answer_ms)
    dependency_wait_ms = max(0, diagnostic_ms - scorer_ms)
    return {
        "retrieval_ms": retrieval_ms,
        "answer_ms": answer_ms,
        "scorer_ms": scorer_ms,
        "diagnostic_ms": diagnostic_ms,
        "dependency_wait_ms": dependency_wait_ms,
    }


def summarize_results(
    results: list[dict[str, object]],
    *,
    metric_names: tuple[str, ...],
) -> dict[str, object]:
    metrics = _summarize_combined_metrics(results, metric_names=metric_names)
    failed_cases = [item for item in results if item.get("status") != "completed"]
    return {
        "total_cases": len(results),
        "completed_cases": len(results) - len(failed_cases),
        "failed_cases": len(failed_cases),
        "metrics": metrics,
        "failure_attribution": _summarize_failure_attribution(results),
        "performance_breakdown": _summarize_performance_breakdown(results),
    }


def metric_report_filename(metric_names: tuple[str, ...]) -> str:
    if len(metric_names) == 1:
        return f"ragas-diagnostic.{metric_names[0]}.json"
    return "ragas-diagnostic.all.json"


def load_existing_metric_reports(output_dir: Path) -> list[dict[str, object]]:
    skipped_names = {
        "ragas-diagnostic.current.json",
        "ragas-diagnostic.combined.json",
        "ragas-diagnostic.summary.json",
    }
    reports: list[dict[str, object]] = []
    for path in sorted(output_dir.glob("ragas-diagnostic.*.json")):
        if path.name in skipped_names:
            continue
        report = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(report, dict):
            reports.append(report)
    if not reports:
        raise FileNotFoundError(f"no per-metric RAGAS diagnostic reports found in {output_dir}")
    return reports


def _case_result_payload(
    *,
    case_spec: dict[str, object],
    projection: RagasProjection,
    status: str,
    duration_ms: int,
    performance_breakdown: Mapping[str, int],
    failure_attribution: Mapping[str, object],
    scores: Mapping[str, float | None],
) -> dict[str, object]:
    return {
        **case_spec,
        "status": status,
        "answer_text": projection.response,
        "answer_shape": projection.metadata.get("answer_shape") or "",
        "presentation_kind": projection.metadata.get("presentation_kind") or "",
        "presentation_path": projection.metadata.get("presentation_path") or "",
        "diagnostic_reason": projection.metadata.get("diagnostic_reason") or "",
        "retrieval_intent_kind": projection.metadata.get("retrieval_intent_kind") or "",
        "retrieval_answer_kind": projection.metadata.get("retrieval_answer_kind") or "",
        "retrieved_context_count": len(projection.retrieved_contexts),
        "retrieved_context_ids": list(projection.retrieved_context_ids),
        "raw_retrieved_doc_ids": list(projection.metadata.get("retrieved_doc_ids") or ()),
        "raw_retrieved_chunk_ids": list(projection.metadata.get("retrieved_chunk_ids") or ()),
        "selected_support_doc_ids": list(projection.metadata.get("supporting_doc_ids") or ()),
        "selected_support_chunk_ids": list(projection.metadata.get("supporting_chunk_ids") or ()),
        "answer_used_context_ids": list(projection.retrieved_context_ids),
        "duration_ms": duration_ms,
        "performance_breakdown": dict(performance_breakdown),
        "failure_attribution": dict(failure_attribution),
        "scores": dict(scores),
    }


def _attribute_case_failure(
    *,
    projection: RagasProjection,
    scores: Mapping[str, float | None],
    metric_names: tuple[str, ...],
    low_score_threshold: float,
) -> dict[str, object]:
    metric_failures: dict[str, str] = {}
    for metric_name in metric_names:
        score = scores.get(metric_name)
        if not isinstance(score, int | float):
            metric_failures[metric_name] = "diagnostic"
            continue
        if float(score) >= low_score_threshold:
            continue
        metric_failures[metric_name] = _attribute_metric_failure(
            metric_name=metric_name,
            projection=projection,
        )
    return {
        "primary_stage": _primary_failure_stage(metric_failures),
        "metric_failures": metric_failures,
    }


def _attribute_metric_failure(*, metric_name: str, projection: RagasProjection) -> str:
    if metric_name == "identity_grounding":
        if _reference_doc_ids(projection).isdisjoint(_raw_retrieved_doc_ids(projection)):
            return "retrieval"
        if _reference_doc_ids(projection).isdisjoint(_supporting_doc_ids(projection)):
            return "evidence_selection"
        return "synthesis"
    if metric_name in {"context_recall", "context_precision"}:
        return "retrieval"
    if metric_name in {"faithfulness", "answer_relevancy"}:
        if _reference_doc_ids(projection).isdisjoint(_raw_retrieved_doc_ids(projection)):
            return "retrieval"
        if _reference_doc_ids(projection).isdisjoint(_supporting_doc_ids(projection)):
            return "evidence_selection"
        return "synthesis"
    if _reference_doc_ids(projection).isdisjoint(_raw_retrieved_doc_ids(projection)):
        return "retrieval"
    return "diagnostic"


def _reference_doc_ids(projection: RagasProjection) -> set[str]:
    return {str(item) for item in projection.reference_context_ids if str(item).strip()}


def _raw_retrieved_doc_ids(projection: RagasProjection) -> set[str]:
    values = projection.metadata.get("retrieved_doc_ids")
    if isinstance(values, list | tuple):
        return {str(item) for item in values if str(item).strip()}
    return {str(item) for item in projection.retrieved_context_ids if str(item).strip()}


def _supporting_doc_ids(projection: RagasProjection) -> set[str]:
    values = projection.metadata.get("supporting_doc_ids")
    if isinstance(values, list | tuple):
        return {str(item) for item in values if str(item).strip()}
    return {str(item) for item in projection.retrieved_context_ids if str(item).strip()}


def _primary_failure_stage(metric_failures: Mapping[str, str]) -> str:
    if not metric_failures:
        return "passed"
    for stage in (
        "retrieval",
        "rerank",
        "selection",
        "evidence_selection",
        "synthesis",
        "grounding",
        "diagnostic",
    ):
        if stage in metric_failures.values():
            return stage
    return "diagnostic"


def _summarize_failure_attribution(results: list[dict[str, object]]) -> dict[str, int]:
    summary = {
        "passed": 0,
        "retrieval": 0,
        "rerank": 0,
        "selection": 0,
        "evidence_selection": 0,
        "synthesis": 0,
        "grounding": 0,
        "diagnostic": 0,
        "failed": 0,
    }
    for item in results:
        if item.get("status") != "completed":
            summary["failed"] += 1
            continue
        attribution = item.get("failure_attribution")
        stage = str(attribution.get("primary_stage") or "") if isinstance(attribution, dict) else ""
        if stage not in summary:
            stage = "diagnostic"
        summary[stage] += 1
    return summary


def _unavailable_metric_failures(
    scores: Mapping[str, object],
    *,
    metric_names: tuple[str, ...],
    projection: RagasProjection | None = None,
) -> list[dict[str, str]]:
    failures: list[dict[str, str]] = []
    metric_diagnostics = (
        dict(projection.metadata.get("metric_diagnostics") or {}) if projection is not None else {}
    )
    for metric_name in metric_names:
        score = scores.get(metric_name)
        if isinstance(score, int | float):
            continue
        diagnostic = dict(metric_diagnostics.get(metric_name) or {})
        failures.append(
            {
                "metric_name": metric_name,
                "error_type": "RagasMetricUnavailable",
                "error_message": _metric_unavailable_message(
                    metric_name,
                    diagnostic=diagnostic,
                ),
            }
        )
    return failures


def _case_metric_failures_for_report(
    source_case: Mapping[str, object],
    *,
    metric_names: tuple[str, ...],
) -> list[dict[str, object]]:
    explicit_failures = source_case.get("metric_failures")
    if isinstance(explicit_failures, list) and explicit_failures:
        return [dict(item) for item in explicit_failures if isinstance(item, dict)]
    if source_case.get("status") != "completed":
        return [
            {
                "metric_names": list(metric_names),
                "error_type": source_case.get("error_type"),
                "error_message": source_case.get("error_message"),
            }
        ]
    scores = source_case.get("scores")
    if not isinstance(scores, dict):
        return [
            {
                "metric_names": list(metric_names),
                "error_type": "RagasMetricUnavailable",
                "error_message": "requested RAGAS metrics did not return scores",
            }
        ]
    failures: list[dict[str, object]] = []
    for metric_name in metric_names:
        score = scores.get(metric_name)
        if isinstance(score, int | float):
            continue
        failures.append(
            {
                "metric_names": [metric_name],
                "error_type": "RagasMetricUnavailable",
                "error_message": _metric_unavailable_message(metric_name),
            }
        )
    return failures


def _metric_unavailable_message(
    metric_name: str,
    *,
    diagnostic: Mapping[str, object] | None = None,
) -> str:
    base = f"requested RAGAS metric {metric_name} did not return a numeric score"
    if diagnostic is None:
        return base
    rationale = str(diagnostic.get("rationale") or "").strip()
    metadata = dict(diagnostic.get("metadata") or {})
    judge_error = str(metadata.get("judge_error") or "").strip()
    failure_reasons = tuple(
        str(item) for item in metadata.get("failure_reasons") or () if str(item)
    )
    details = tuple(item for item in (rationale, judge_error, ", ".join(failure_reasons)) if item)
    if not details:
        return base
    return f"{base}: {' | '.join(details)}"


def _summarize_performance_breakdown(results: list[dict[str, object]]) -> dict[str, object]:
    breakdowns = [
        item.get("performance_breakdown")
        for item in results
        if isinstance(item.get("performance_breakdown"), dict)
    ]
    summary: dict[str, object] = {"case_count": len(breakdowns)}
    for key in (
        "retrieval_ms",
        "answer_ms",
        "scorer_ms",
        "diagnostic_ms",
        "dependency_wait_ms",
    ):
        values = [
            int(breakdown[key]) for breakdown in breakdowns if isinstance(breakdown.get(key), int)
        ]
        summary[key] = {
            "sum": sum(values),
            "mean": (sum(values) / len(values)) if values else None,
            "max": max(values) if values else None,
        }
    return summary


def _summarize_combined_metrics(
    cases: list[dict[str, object]],
    *,
    metric_names: tuple[str, ...],
) -> dict[str, dict[str, object]]:
    metrics: dict[str, dict[str, object]] = {}
    for metric_name in metric_names:
        values = [
            float(scores[metric_name])
            for item in cases
            for scores in (item.get("scores"),)
            if isinstance(scores, dict) and isinstance(scores.get(metric_name), int | float)
        ]
        metrics[metric_name] = {
            "count": len(values),
            "mean": (sum(values) / len(values)) if values else None,
            "min": min(values) if values else None,
            "max": max(values) if values else None,
        }
    return metrics


def _low_score_cases(
    cases: list[dict[str, object]],
    *,
    metric_names: tuple[str, ...],
    low_score_threshold: float,
) -> list[dict[str, object]]:
    low_cases: list[dict[str, object]] = []
    for item in cases:
        scores = item.get("scores")
        if not isinstance(scores, dict):
            continue
        for metric_name in metric_names:
            score = scores.get(metric_name)
            if not isinstance(score, int | float) or float(score) >= low_score_threshold:
                continue
            low_cases.append(
                {
                    "surface_key": item.get("surface_key"),
                    "case_id": item.get("case_id"),
                    "metric_name": metric_name,
                    "score": float(score),
                    "query": item.get("query"),
                    "expected_doc_ids": item.get("expected_doc_ids"),
                    "retrieved_context_ids": item.get("retrieved_context_ids"),
                }
            )
    return sorted(
        low_cases,
        key=lambda item: (
            float(item["score"]),
            str(item["surface_key"]),
            str(item["case_id"]),
            str(item["metric_name"]),
        ),
    )


def _metric_names_for_report(report: Mapping[str, object]) -> list[str]:
    manifest = report.get("sample_manifest")
    if isinstance(manifest, dict):
        manifest_metric_names = manifest.get("metric_names")
        if isinstance(manifest_metric_names, list):
            return [str(metric_name) for metric_name in manifest_metric_names]
    summary = report.get("summary")
    if isinstance(summary, dict):
        metrics = summary.get("metrics")
        if isinstance(metrics, dict):
            return [str(metric_name) for metric_name in metrics]
    metric_names: list[str] = []
    for item in _cases_for_report(report):
        scores = item.get("scores")
        if not isinstance(scores, dict):
            continue
        for metric_name in scores:
            name = str(metric_name)
            if name not in metric_names:
                metric_names.append(name)
    return metric_names


def _run_configs_for_reports(reports: list[Mapping[str, object]]) -> list[dict[str, object]]:
    run_configs: list[dict[str, object]] = []
    for report in reports:
        run_config = report.get("run_config")
        if isinstance(run_config, dict):
            run_configs.append(dict(run_config))
    return run_configs


def _cases_for_report(report: Mapping[str, object]) -> list[dict[str, object]]:
    cases = report.get("cases")
    if not isinstance(cases, list):
        return []
    return [dict(item) for item in cases if isinstance(item, dict)]


def _combined_case_key(item: Mapping[str, object]) -> tuple[str, str]:
    return (str(item.get("surface_key") or ""), str(item.get("case_id") or ""))


def _base_combined_case(item: Mapping[str, object]) -> dict[str, object]:
    base_keys = (
        "surface_key",
        "case_id",
        "split",
        "query",
        "expected_doc_ids",
        "forbidden_doc_ids",
        "answer_text",
        "answer_shape",
        "presentation_kind",
        "diagnostic_reason",
        "retrieval_intent_kind",
        "retrieval_answer_kind",
        "retrieved_context_count",
        "retrieved_context_ids",
        "raw_retrieved_doc_ids",
        "raw_retrieved_chunk_ids",
        "selected_support_doc_ids",
        "selected_support_chunk_ids",
        "failure_attribution",
    )
    combined = {key: item[key] for key in base_keys if key in item}
    combined["status"] = "completed"
    combined["scores"] = {}
    return combined


__all__ = [
    "case_performance_breakdown",
    "combine_ragas_diagnostic_reports",
    "failed_case_result",
    "identity_grounding_score",
    "load_existing_metric_reports",
    "metric_report_filename",
    "passed_case_result",
    "summarize_results",
]
