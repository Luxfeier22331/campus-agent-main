from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from pathlib import Path

from campus_contracts import AgentResponse, RagResultPayload
from campus_rag_agent import RagAgent
from campus_rag_agent.agent_answer_shape import infer_answer_shape
from campus_retrieval_core import build_retrieval_backend
from campus_shared import load_repo_env

from campus_evals.benchmark import RetrievalQrelsCase, load_retrieval_qrels_dataset
from campus_evals.ragas_adapter import build_ragas_scorer
from campus_evals.ragas_adapter_projection import RagasProjection
from campus_evals.retrieval_live_benchmark import _build_retrieval_request
from campus_evals.settings import RagasSettings

RAGAS_DIAGNOSTIC_REPORT_SCHEMA_VERSION = "ragas-diagnostic-report.v1"
RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION = "ragas-diagnostic-combined-report.v1"
RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION = "ragas-diagnostic-sample-manifest.v1"
DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE = 12
DEFAULT_RAGAS_DIAGNOSTIC_TOP_K = 5
DEFAULT_RAGAS_DIAGNOSTIC_LOW_SCORE_THRESHOLD = 0.8
DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES = (
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
)

_SURFACE_QRELS_FIXTURES = {
    "regulations/student_rules": "student_handbook_retrieval_qrels.json",
    "regulations/institutional_rules": "institutional_rules_retrieval_qrels.json",
    "curriculum/curriculum_plan": "curriculum_plan_retrieval_qrels.json",
}

_PREFERRED_CASE_IDS = {
    "regulations/student_rules": (
        "policy-title-scholarship",
        "policy-alias-national-scholarship-article-nine",
        "semantic-scholarship-eligibility",
        "short-fact-attendance-discipline-threshold",
        "semantic-disciplinary-relief",
        "policy-title-recommend-postgraduate-exemption",
        "semantic-study-abroad-management",
        "semantic-innovation-education-credit",
        "policy-title-temporary-hardship-subsidy",
        "policy-title-national-grant",
        "policy-title-student-aid-management",
        "policy-title-funded-student-public-service",
    ),
    "regulations/institutional_rules": (
        "institutional-title-exact-ff711d1185f9",
        "institutional-title-exact-81401d3a02d6",
        "institutional-title-exact-7da72ac3d796",
        "institutional-title-exact-40d4d65809c5",
        "institutional-title-exact-e593d7a51e16",
        "institutional-title-exact-ccd8fad3cd06",
        "institutional-title-exact-580644ffc701",
        "institutional-title-exact-6ad2032144d0",
        "institutional-title-exact-a7716c82cbe1",
        "institutional-title-exact-eb3f2445780f",
        "institutional-title-exact-3c69a0dd5d82",
        "institutional-title-exact-f2860d036974",
    ),
    "curriculum/curriculum_plan": (
        "ethnology-plan-title",
        "history-strong-base-title",
        "digital-economy-plan-paraphrase",
        "ethnology-second-degree-academic-years",
        "ethnology-total-credits",
        "economics-course-settings-table",
        "general-english-total-credits",
        "hanyu-international-students-total-credits",
        "law-ethnic-class-fourth-semester-courses",
        "semantic-philosophy-strong-base-paraphrase",
        "curriculum-title-general-chinese-culture",
        "curriculum-title-social-practice",
    ),
}


def build_ragas_diagnostic_sample_manifest(
    *,
    sample_limit_per_surface: int = DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    metric_names: tuple[str, ...] = DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
    repo_root: str | Path | None = None,
) -> dict[str, object]:
    if sample_limit_per_surface <= 0:
        raise ValueError("sample_limit_per_surface must be greater than zero")
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    cases: list[dict[str, object]] = []
    for surface_key in _SURFACE_QRELS_FIXTURES:
        dataset = load_retrieval_qrels_dataset(_qrels_path(root=root, surface_key=surface_key))
        by_case_id = {case.case_id: case for case in dataset.cases}
        selected = [
            by_case_id[case_id]
            for case_id in _PREFERRED_CASE_IDS[surface_key]
            if case_id in by_case_id
        ][:sample_limit_per_surface]
        cases.extend(_manifest_case(surface_key=surface_key, case=case) for case in selected)
    return {
        "schema_version": RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION,
        "sample_limit_per_surface": sample_limit_per_surface,
        "metric_names": list(metric_names),
        "cases": cases,
    }


def run_ragas_diagnostic(
    *,
    backend: object,
    scorer: Callable[[RagasProjection], Mapping[str, float | None]],
    sample_limit_per_surface: int = DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    top_k: int = DEFAULT_RAGAS_DIAGNOSTIC_TOP_K,
    metric_names: tuple[str, ...] = DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
    case_workers: int = 1,
    repo_root: str | Path | None = None,
) -> dict[str, object]:
    if case_workers <= 0:
        raise ValueError("case_workers must be greater than zero")
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    manifest = build_ragas_diagnostic_sample_manifest(
        sample_limit_per_surface=sample_limit_per_surface,
        metric_names=metric_names,
        repo_root=root,
    )
    case_specs = tuple(dict(item) for item in manifest["cases"] if isinstance(item, dict))

    def _run_case(case_spec: dict[str, object]) -> dict[str, object]:
        surface_key = str(case_spec["surface_key"])
        case = _load_case(root=root, surface_key=surface_key, case_id=str(case_spec["case_id"]))
        started_at = time.perf_counter()
        try:
            projection, projection_breakdown = _build_projection_with_breakdown(
                case=case,
                backend=backend,
                top_k=top_k,
            )
            scorer_started_at = time.perf_counter()
            scores = dict(scorer(projection))
            scorer_ms = _elapsed_ms(scorer_started_at)
            duration_ms = _elapsed_ms(started_at)
            return _passed_case_result(
                case_spec=case_spec,
                projection=projection,
                scores=scores,
                metric_names=metric_names,
                duration_ms=duration_ms,
                performance_breakdown=_case_performance_breakdown(
                    projection_breakdown=projection_breakdown,
                    scorer_ms=scorer_ms,
                    duration_ms=duration_ms,
                ),
            )
        except Exception as exc:
            return _failed_case_result(
                case_spec=case_spec,
                exc=exc,
                duration_ms=_elapsed_ms(started_at),
            )

    if case_workers == 1 or len(case_specs) <= 1:
        results = [_run_case(case_spec) for case_spec in case_specs]
    else:
        results_by_index: list[dict[str, object] | None] = [None] * len(case_specs)
        with ThreadPoolExecutor(max_workers=case_workers) as pool:
            futures = [
                (index, pool.submit(copy_context().run, _run_case, case_spec))
                for index, case_spec in enumerate(case_specs)
            ]
            for index, future in futures:
                results_by_index[index] = future.result()
        results = [result for result in results_by_index if result is not None]

    summary = _summarize_results(results, metric_names=metric_names)
    return {
        "schema_version": RAGAS_DIAGNOSTIC_REPORT_SCHEMA_VERSION,
        "report_id": "ragas_diagnostic",
        "passed": summary["failed_cases"] == 0,
        "mode": "diagnostic_non_blocking",
        "run_config": {
            "sample_limit_per_surface": sample_limit_per_surface,
            "top_k": top_k,
            "metric_names": list(metric_names),
            "case_workers": case_workers,
        },
        "sample_manifest": manifest,
        "summary": summary,
        "cases": results,
    }


def combine_ragas_diagnostic_reports(
    reports: list[Mapping[str, object]],
    *,
    low_score_threshold: float = DEFAULT_RAGAS_DIAGNOSTIC_LOW_SCORE_THRESHOLD,
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
                    if isinstance(score, int | float):
                        target_scores[str(metric_name)] = float(score)
            if source_case.get("status") != "completed":
                metric_failures = target_case.setdefault("metric_failures", [])
                if not isinstance(metric_failures, list):
                    raise ValueError("combined case metric_failures must be a list")
                metric_failures.append(
                    {
                        "metric_names": report_metric_names,
                        "error_type": source_case.get("error_type"),
                        "error_message": source_case.get("error_message"),
                    }
                )

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
        "schema_version": RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION,
        "report_id": "ragas_diagnostic_combined",
        "passed": all(bool(report.get("passed")) for report in reports) and not failed_cases,
        "mode": "diagnostic_non_blocking",
        "summary": summary,
        "cases": cases,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run small-sample RAGAS diagnostics for core RAG.")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--sample-limit-per-surface",
        type=int,
        default=DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    )
    parser.add_argument("--top-k", type=int, default=DEFAULT_RAGAS_DIAGNOSTIC_TOP_K)
    parser.add_argument("--case-workers", type=int, default=1)
    parser.add_argument(
        "--metric-name",
        action="append",
        default=[],
        choices=DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
        help="Metric to run. Defaults to all diagnostic metrics.",
    )
    parser.add_argument(
        "--combine-existing-reports",
        action="store_true",
        help="Merge existing per-metric RAGAS diagnostic JSON reports without running retrieval.",
    )
    parser.add_argument(
        "--fake-scorer",
        action="store_true",
        help="Use deterministic fake scores for tests and dry wiring checks.",
    )
    args = parser.parse_args(argv)

    load_repo_env()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.combine_existing_reports:
        reports = _load_existing_metric_reports(output_dir)
        combined = combine_ragas_diagnostic_reports(reports)
        _write_json(output_dir / "ragas-diagnostic.combined.json", combined)
        _write_json(output_dir / "ragas-diagnostic.summary.json", combined["summary"])
        print(json.dumps(combined["summary"], ensure_ascii=False, indent=2))
        return 0 if combined["passed"] else 1

    metric_names = tuple(args.metric_name or DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES)
    manifest = build_ragas_diagnostic_sample_manifest(
        sample_limit_per_surface=args.sample_limit_per_surface,
        metric_names=metric_names,
    )
    _write_json(output_dir / "sample-manifest.json", manifest)
    backend = build_retrieval_backend()
    scorer = _fake_scorer if args.fake_scorer else _build_live_scorer(metric_names=metric_names)
    report = run_ragas_diagnostic(
        backend=backend,
        scorer=scorer,
        sample_limit_per_surface=args.sample_limit_per_surface,
        top_k=args.top_k,
        metric_names=metric_names,
        case_workers=args.case_workers,
    )
    _write_json(output_dir / "ragas-diagnostic.current.json", report)
    _write_json(output_dir / _metric_report_filename(metric_names), report)
    _write_json(output_dir / "ragas-diagnostic.summary.json", report["summary"])
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


def _build_projection_with_breakdown(
    *,
    case: RetrievalQrelsCase,
    backend: object,
    top_k: int,
) -> tuple[RagasProjection, dict[str, int]]:
    request = _build_retrieval_request(case=case, default_top_k=top_k)
    retrieval_started_at = time.perf_counter()
    bundle = backend.retrieve(request)
    retrieval_ms = _elapsed_ms(retrieval_started_at)
    answer_started_at = time.perf_counter()
    answer_shape = infer_answer_shape(evidence=bundle)
    draft = RagAgent().build_answer(bundle)
    answer_ms = _elapsed_ms(answer_started_at)
    response = AgentResponse(
        target="rag-agent",
        status="completed",
        answer_text=draft.answer_text,
        confidence="medium",
        result=RagResultPayload(evidence=bundle),
    )
    reference = _reference_for_case(case)
    context_ids = tuple(_source_projection_id(source) for source in draft.supporting_sources)
    return (
        RagasProjection(
            case_id=case.case_id,
            user_input=case.query,
            response=response.answer_text,
            retrieved_contexts=draft.supporting_contexts
            or tuple(source.snippet for source in draft.supporting_sources),
            reference=reference,
            retrieved_context_ids=context_ids,
            reference_context_ids=tuple(source.doc_id for source in case.expected_sources),
            reference_contexts=tuple(
                source.rationale for source in case.expected_sources if source.rationale
            ),
            metadata={
                "corpus": case.scope.corpus,
                "collection": case.scope.collection,
                "answer_shape": answer_shape.value,
                "expected_doc_ids": [source.doc_id for source in case.expected_sources],
                "retrieved_doc_ids": [source.doc_id for source in bundle.sources],
                "retrieved_chunk_ids": [source.chunk_id for source in bundle.sources],
                "supporting_doc_ids": [source.doc_id for source in draft.supporting_sources],
                "supporting_chunk_ids": [source.chunk_id for source in draft.supporting_sources],
            },
        ),
        {
            "retrieval_ms": retrieval_ms,
            "answer_ms": answer_ms,
        },
    )


def _build_live_scorer(
    *,
    metric_names: tuple[str, ...],
) -> Callable[[RagasProjection], Mapping[str, float | None]]:
    settings = RagasSettings.from_env()
    scorer = build_ragas_scorer(
        settings,
        metric_names=metric_names,
    )

    def _score(projection: RagasProjection) -> Mapping[str, float | None]:
        return {result.metric_name: result.score for result in scorer(projection)}

    return _score


def _fake_scorer(projection: RagasProjection) -> Mapping[str, float]:
    del projection
    return {
        "faithfulness": 1.0,
        "answer_relevancy": 1.0,
        "context_precision": 1.0,
        "context_recall": 1.0,
    }


def _manifest_case(*, surface_key: str, case: RetrievalQrelsCase) -> dict[str, object]:
    return {
        "surface_key": surface_key,
        "case_id": case.case_id,
        "split": case.split,
        "query": case.query,
        "expected_doc_ids": [source.doc_id for source in case.expected_sources],
        "forbidden_doc_ids": [source.doc_id for source in case.forbidden_sources],
    }


def _passed_case_result(
    *,
    case_spec: dict[str, object],
    projection: RagasProjection,
    scores: Mapping[str, float | None],
    metric_names: tuple[str, ...],
    duration_ms: int,
    performance_breakdown: Mapping[str, int],
) -> dict[str, object]:
    failure_attribution = _attribute_case_failure(
        projection=projection,
        scores=scores,
        metric_names=metric_names,
    )
    return {
        **case_spec,
        "status": "completed",
        "answer_text": projection.response,
        "answer_shape": projection.metadata.get("answer_shape") or "",
        "retrieved_context_count": len(projection.retrieved_contexts),
        "retrieved_context_ids": list(projection.retrieved_context_ids),
        "raw_retrieved_doc_ids": list(projection.metadata.get("retrieved_doc_ids") or ()),
        "raw_retrieved_chunk_ids": list(projection.metadata.get("retrieved_chunk_ids") or ()),
        "selected_support_doc_ids": list(projection.metadata.get("supporting_doc_ids") or ()),
        "selected_support_chunk_ids": list(projection.metadata.get("supporting_chunk_ids") or ()),
        "answer_used_context_ids": list(projection.retrieved_context_ids),
        "duration_ms": duration_ms,
        "performance_breakdown": dict(performance_breakdown),
        "failure_attribution": failure_attribution,
        "scores": {name: scores.get(name) for name in metric_names},
    }


def _failed_case_result(
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


def _elapsed_ms(started_at: float) -> int:
    return max(0, round((time.perf_counter() - started_at) * 1000))


def _case_performance_breakdown(
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


def _attribute_case_failure(
    *,
    projection: RagasProjection,
    scores: Mapping[str, float | None],
    metric_names: tuple[str, ...],
    low_score_threshold: float = DEFAULT_RAGAS_DIAGNOSTIC_LOW_SCORE_THRESHOLD,
) -> dict[str, object]:
    metric_failures: dict[str, str] = {}
    for metric_name in metric_names:
        score = scores.get(metric_name)
        if not isinstance(score, int | float) or float(score) >= low_score_threshold:
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
    if metric_name in {"context_recall", "context_precision"}:
        return "retrieval"
    if metric_name in {"faithfulness", "answer_relevancy"}:
        return "synthesis"
    if not projection.retrieved_context_ids:
        return "retrieval"
    if not set(projection.retrieved_context_ids).intersection(projection.reference_context_ids):
        return "retrieval"
    return "diagnostic"


def _primary_failure_stage(metric_failures: Mapping[str, str]) -> str:
    if not metric_failures:
        return "passed"
    for stage in ("retrieval", "evidence_selection", "synthesis", "diagnostic"):
        if stage in metric_failures.values():
            return stage
    return "diagnostic"


def _summarize_results(
    results: list[dict[str, object]],
    *,
    metric_names: tuple[str, ...],
) -> dict[str, object]:
    metrics: dict[str, dict[str, object]] = {}
    for metric_name in metric_names:
        values = [
            float(scores[metric_name])
            for item in results
            for scores in (item.get("scores"),)
            if isinstance(scores, dict) and isinstance(scores.get(metric_name), int | float)
        ]
        metrics[metric_name] = {
            "count": len(values),
            "mean": (sum(values) / len(values)) if values else None,
            "min": min(values) if values else None,
            "max": max(values) if values else None,
        }
    failed_cases = [item for item in results if item.get("status") != "completed"]
    return {
        "total_cases": len(results),
        "completed_cases": len(results) - len(failed_cases),
        "failed_cases": len(failed_cases),
        "metrics": metrics,
        "failure_attribution": _summarize_failure_attribution(results),
        "performance_breakdown": _summarize_performance_breakdown(results),
    }


def _summarize_failure_attribution(results: list[dict[str, object]]) -> dict[str, int]:
    summary = {
        "passed": 0,
        "retrieval": 0,
        "evidence_selection": 0,
        "synthesis": 0,
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
        "retrieved_context_count",
        "retrieved_context_ids",
    )
    combined = {key: item[key] for key in base_keys if key in item}
    combined["status"] = "completed"
    combined["scores"] = {}
    return combined


def _metric_report_filename(metric_names: tuple[str, ...]) -> str:
    if len(metric_names) == 1:
        return f"ragas-diagnostic.{metric_names[0]}.json"
    return "ragas-diagnostic.all.json"


def _load_existing_metric_reports(output_dir: Path) -> list[dict[str, object]]:
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


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _load_case(*, root: Path, surface_key: str, case_id: str) -> RetrievalQrelsCase:
    dataset = load_retrieval_qrels_dataset(_qrels_path(root=root, surface_key=surface_key))
    for case in dataset.cases:
        if case.case_id == case_id:
            return case
    raise ValueError(f"unknown qrels case {surface_key}:{case_id}")


def _qrels_path(*, root: Path, surface_key: str) -> Path:
    return root / "packages" / "evals" / "fixtures" / _SURFACE_QRELS_FIXTURES[surface_key]


def _reference_for_case(case: RetrievalQrelsCase) -> str:
    rationales = tuple(source.rationale for source in case.expected_sources if source.rationale)
    if rationales:
        return "\n".join(rationales)
    return "\n".join(source.doc_id for source in case.expected_sources)


def _source_projection_id(source) -> str:
    return str(source.canonical_source_id or source.doc_id or source.chunk_id or "").strip()


__all__ = [
    "DEFAULT_RAGAS_DIAGNOSTIC_LOW_SCORE_THRESHOLD",
    "DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES",
    "DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE",
    "DEFAULT_RAGAS_DIAGNOSTIC_TOP_K",
    "RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION",
    "RAGAS_DIAGNOSTIC_REPORT_SCHEMA_VERSION",
    "RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION",
    "build_ragas_diagnostic_sample_manifest",
    "combine_ragas_diagnostic_reports",
    "main",
    "run_ragas_diagnostic",
]


if __name__ == "__main__":
    raise SystemExit(main())
