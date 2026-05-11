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
from campus_rag_agent.agent_answer_shape import (
    answer_shape_from_retrieval_intent,
    infer_answer_shape,
)
from campus_rag_agent.institutional_rules_query_planning import plan_institutional_rules_query
from campus_rag_agent.query_planning import plan_curriculum_query, plan_student_handbook_query
from campus_rag_agent.retrieval_intent import (
    RetrievalIntent,
    RetrievalIntentExpectation,
    RetrievalIntentTarget,
    retrieval_intent_for_official_web_stable_reference,
)
from campus_rag_agent.service_clarification import _build_clarification_question
from campus_retrieval_core import build_retrieval_backend
from campus_shared import load_repo_env

from campus_evals.benchmark import RetrievalQrelsCase, load_retrieval_qrels_dataset
from campus_evals.ragas_adapter import build_ragas_scorer
from campus_evals.ragas_adapter_projection import RagasProjection
from campus_evals.ragas_diagnostic_fixtures import (
    PREFERRED_RAGAS_DIAGNOSTIC_CASE_IDS,
    RAGAS_DIAGNOSTIC_CASE_METRIC_OVERRIDES,
    SURFACE_QRELS_FIXTURES,
)
from campus_evals.ragas_diagnostic_reports import (
    case_performance_breakdown,
    failed_case_result,
    identity_grounding_score,
    load_existing_metric_reports,
    metric_report_filename,
    passed_case_result,
    summarize_results,
)
from campus_evals.ragas_diagnostic_reports import (
    combine_ragas_diagnostic_reports as _combine_ragas_diagnostic_reports,
)
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
    "identity_grounding",
    "context_precision",
    "context_recall",
)
RAGAS_BACKED_METRIC_NAMES = frozenset(
    {
        "faithfulness",
        "answer_relevancy",
        "context_precision",
        "context_recall",
    }
)


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
    for surface_key in SURFACE_QRELS_FIXTURES:
        dataset = load_retrieval_qrels_dataset(_qrels_path(root=root, surface_key=surface_key))
        by_case_id = {case.case_id: case for case in dataset.cases}
        selected = [
            by_case_id[case_id]
            for case_id in PREFERRED_RAGAS_DIAGNOSTIC_CASE_IDS[surface_key]
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
            scores = _score_projection(
                projection=projection,
                scorer=scorer,
                metric_names=metric_names,
            )
            scorer_ms = _elapsed_ms(scorer_started_at)
            duration_ms = _elapsed_ms(started_at)
            metric_applicability = _metric_applicability_for_case(case_spec)
            return passed_case_result(
                case_spec=case_spec,
                projection=projection,
                scores=scores,
                metric_names=metric_names,
                metric_applicability=metric_applicability,
                duration_ms=duration_ms,
                performance_breakdown=case_performance_breakdown(
                    projection_breakdown=projection_breakdown,
                    scorer_ms=scorer_ms,
                    duration_ms=duration_ms,
                ),
                low_score_threshold=DEFAULT_RAGAS_DIAGNOSTIC_LOW_SCORE_THRESHOLD,
            )
        except Exception as exc:
            return failed_case_result(
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

    summary = summarize_results(results, metric_names=metric_names)
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
    return _combine_ragas_diagnostic_reports(
        reports,
        schema_version=RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION,
        low_score_threshold=low_score_threshold,
    )


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
        reports = load_existing_metric_reports(output_dir)
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
    _write_json(output_dir / metric_report_filename(metric_names), report)
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
    retrieval_intent = _retrieval_intent_for_case(case)
    answer_shape = (
        answer_shape_from_retrieval_intent(retrieval_intent)
        if retrieval_intent is not None
        else infer_answer_shape(evidence=bundle)
    )
    draft = RagAgent().build_answer(bundle, retrieval_intent=retrieval_intent)
    answer_text = draft.answer_text
    presentation_kind = draft.presentation_kind
    if retrieval_intent is not None and retrieval_intent.kind == "clarification_required":
        answer_text = _build_clarification_question(
            case.query,
            bundle,
            clarification_reason=retrieval_intent.clarification_reason,
        )
        presentation_kind = "clarification"
    answer_ms = _elapsed_ms(answer_started_at)
    response = AgentResponse(
        target="rag-agent",
        status="completed",
        answer_text=answer_text,
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
                "presentation_kind": presentation_kind,
                "fallback_path": draft.fallback_path,
                "fallback_reason": draft.fallback_reason,
                "retrieval_intent_kind": (
                    retrieval_intent.kind if retrieval_intent is not None else ""
                ),
                "retrieval_answer_kind": (
                    retrieval_intent.expected.answer_kind if retrieval_intent is not None else ""
                ),
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


def _retrieval_intent_for_case(case: RetrievalQrelsCase) -> RetrievalIntent | None:
    if case.scope.corpus == "regulations" and case.scope.collection == "student_rules":
        plan = plan_student_handbook_query(case.query)
        if getattr(plan, "status", "") != "pass_through":
            return plan.retrieval_intent
    if case.scope.corpus == "regulations" and case.scope.collection == "institutional_rules":
        if _case_asks_for_governing_document(case.query):
            return _policy_object_intent_for_case(case)
        return plan_institutional_rules_query(case.query).retrieval_intent
    if case.scope.corpus == "curriculum" and case.scope.collection == "curriculum_plan":
        return plan_curriculum_query(case.query).retrieval_intent
    if case.scope.corpus == "official_web":
        return retrieval_intent_for_official_web_stable_reference(
            query_text=case.query,
            scope=case.scope,
        )
    return None


def _case_asks_for_governing_document(query_text: str) -> bool:
    return any(
        cue in query_text
        for cue in (
            "哪份管理办法",
            "哪份办法",
            "哪个管理办法",
            "哪个办法",
            "依据哪份",
            "依据哪个",
        )
    )


def _policy_object_intent_for_case(case: RetrievalQrelsCase) -> RetrievalIntent:
    return RetrievalIntent(
        kind="policy_object_lookup",
        normalized_query=case.query,
        expected=RetrievalIntentExpectation(
            answer_kind="policy_object",
            evidence_roles=("primary_content", "policy_object"),
            coverage_policy="single_document_focus",
            selection_policy="answer_role_first",
            replan_policy="focus_gap_replan",
        ),
        target=RetrievalIntentTarget(
            corpus=case.scope.corpus,
            collection=case.scope.collection,
            document_ids=tuple(source.doc_id for source in case.expected_sources if source.doc_id),
        ),
    )


def _build_live_scorer(
    *,
    metric_names: tuple[str, ...],
) -> Callable[[RagasProjection], Mapping[str, float | None]]:
    settings = RagasSettings.from_env()
    ragas_metric_names = _ragas_metric_names(metric_names)
    scorer = build_ragas_scorer(
        settings,
        metric_names=ragas_metric_names,
    )

    def _score(projection: RagasProjection) -> Mapping[str, float | None]:
        if not ragas_metric_names:
            return {}
        return {result.metric_name: result.score for result in scorer(projection)}

    return _score


def _fake_scorer(projection: RagasProjection) -> Mapping[str, float]:
    del projection
    return {
        "faithfulness": 1.0,
        "answer_relevancy": 1.0,
        "identity_grounding": 1.0,
        "context_precision": 1.0,
        "context_recall": 1.0,
    }


def _manifest_case(*, surface_key: str, case: RetrievalQrelsCase) -> dict[str, object]:
    metric_overrides = {
        **case.supplemental_metric_overrides,
        **RAGAS_DIAGNOSTIC_CASE_METRIC_OVERRIDES.get(case.case_id, {}),
    }
    return {
        "surface_key": surface_key,
        "case_id": case.case_id,
        "split": case.split,
        "query": case.query,
        "expected_doc_ids": [source.doc_id for source in case.expected_sources],
        "forbidden_doc_ids": [source.doc_id for source in case.forbidden_sources],
        "supplemental_metric_overrides": dict(metric_overrides),
    }


def _score_projection(
    *,
    projection: RagasProjection,
    scorer: Callable[[RagasProjection], Mapping[str, float | None]],
    metric_names: tuple[str, ...],
) -> dict[str, float | None]:
    scores = dict(scorer(projection))
    if "identity_grounding" in metric_names:
        scores["identity_grounding"] = identity_grounding_score(projection)
    return scores


def _elapsed_ms(started_at: float) -> int:
    return max(0, round((time.perf_counter() - started_at) * 1000))


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _load_case(*, root: Path, surface_key: str, case_id: str) -> RetrievalQrelsCase:
    dataset = load_retrieval_qrels_dataset(_qrels_path(root=root, surface_key=surface_key))
    for case in dataset.cases:
        if case.case_id == case_id:
            return case
    raise ValueError(f"unknown qrels case {surface_key}:{case_id}")


def _qrels_path(*, root: Path, surface_key: str) -> Path:
    return root / "packages" / "evals" / "fixtures" / SURFACE_QRELS_FIXTURES[surface_key]


def _reference_for_case(case: RetrievalQrelsCase) -> str:
    rationales = tuple(source.rationale for source in case.expected_sources if source.rationale)
    if rationales:
        return "\n".join(rationales)
    return "\n".join(source.doc_id for source in case.expected_sources)


def _source_projection_id(source) -> str:
    return str(source.canonical_source_id or source.doc_id or source.chunk_id or "").strip()


def _metric_applicability_for_case(case_spec: Mapping[str, object]) -> dict[str, bool]:
    applicability = {
        metric_name: metric_name != "identity_grounding"
        for metric_name in (
            "faithfulness",
            "answer_relevancy",
            "identity_grounding",
            "context_precision",
            "context_recall",
        )
    }
    overrides = case_spec.get("supplemental_metric_overrides")
    if isinstance(overrides, dict):
        for metric_name, enabled in overrides.items():
            applicability[str(metric_name)] = bool(enabled)
    return applicability


def _ragas_metric_names(metric_names: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(
        metric_name for metric_name in metric_names if metric_name in RAGAS_BACKED_METRIC_NAMES
    )


__all__ = [
    "DEFAULT_RAGAS_DIAGNOSTIC_LOW_SCORE_THRESHOLD",
    "DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES",
    "DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE",
    "DEFAULT_RAGAS_DIAGNOSTIC_TOP_K",
    "RAGAS_BACKED_METRIC_NAMES",
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
