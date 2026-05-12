from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager
from contextvars import copy_context
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import campus_retrieval_core.backend_qdrant as backend_qdrant_module
import campus_retrieval_core.backend_qdrant_release_guard as release_guard_module
import campus_retrieval_core.service as retrieval_service_module
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
from campus_retrieval_core import (
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalScope,
    RetrievalSelector,
    RetrievalSemanticHint,
    RetrievalSourceTrustPolicy,
    RetrievalStep,
    RetrievalStepBudget,
    build_retrieval_backend,
    execute_retrieval_plan,
)
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
RAGAS_DIAGNOSTIC_INDEXED_LOOKUP_TIMEOUT_MS = 4000
RAGAS_DIAGNOSTIC_CATEGORY_MEMBER_TOP_K = 3
RAGAS_BACKED_METRIC_NAMES = frozenset(
    {
        "faithfulness",
        "answer_relevancy",
        "context_precision",
        "context_recall",
    }
)


class RagasProjectionContractError(ValueError):
    """Raised when diagnostic projection lacks answer-ready support."""


def build_ragas_diagnostic_sample_manifest(
    *,
    sample_limit_per_surface: int = DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    metric_names: tuple[str, ...] = DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
    case_ids: tuple[str, ...] = (),
    repo_root: str | Path | None = None,
) -> dict[str, object]:
    if sample_limit_per_surface <= 0:
        raise ValueError("sample_limit_per_surface must be greater than zero")
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    cases: list[dict[str, object]] = []
    requested_case_ids = tuple(dict.fromkeys(case_id for case_id in case_ids if case_id))
    missing_case_ids = set(requested_case_ids)
    for surface_key in SURFACE_QRELS_FIXTURES:
        dataset = load_retrieval_qrels_dataset(_qrels_path(root=root, surface_key=surface_key))
        by_case_id = {case.case_id: case for case in dataset.cases}
        if requested_case_ids:
            selected = [
                by_case_id[case_id]
                for case_id in requested_case_ids
                if case_id in by_case_id
            ]
            missing_case_ids.difference_update(case.case_id for case in selected)
        else:
            selected = [
                by_case_id[case_id]
                for case_id in PREFERRED_RAGAS_DIAGNOSTIC_CASE_IDS[surface_key]
                if case_id in by_case_id
            ][:sample_limit_per_surface]
        cases.extend(_manifest_case(surface_key=surface_key, case=case) for case in selected)
    if missing_case_ids:
        raise ValueError(f"unknown RAGAS diagnostic case_id: {sorted(missing_case_ids)[0]}")
    return {
        "schema_version": RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION,
        "sample_limit_per_surface": sample_limit_per_surface,
        "metric_names": list(metric_names),
        "case_ids": list(requested_case_ids),
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
    qdrant_collection_overrides: Mapping[str, str] | None = None,
    case_ids: tuple[str, ...] = (),
) -> dict[str, object]:
    if case_workers <= 0:
        raise ValueError("case_workers must be greater than zero")
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    manifest = build_ragas_diagnostic_sample_manifest(
        sample_limit_per_surface=sample_limit_per_surface,
        metric_names=metric_names,
        case_ids=case_ids,
        repo_root=root,
    )
    case_specs = tuple(dict(item) for item in manifest["cases"] if isinstance(item, dict))
    normalized_overrides = _normalize_qdrant_collection_overrides(
        qdrant_collection_overrides or {}
    )

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

    with _override_ragas_diagnostic_runtime_profiles(normalized_overrides):
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
            "qdrant_collection_overrides": dict(normalized_overrides),
            "case_ids": list(dict.fromkeys(case_ids)),
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
        "--case-id",
        action="append",
        default=[],
        help="Run only the named qrels case. May be passed more than once.",
    )
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
    parser.add_argument(
        "--qdrant-collection-name",
        action="append",
        default=[],
        metavar="SURFACE=COLLECTION",
        help=(
            "Override a diagnostic surface physical Qdrant collection, for example "
            "regulations/student_rules=student_rules__r20260512_preview."
        ),
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
    qdrant_collection_overrides = _parse_qdrant_collection_overrides(
        args.qdrant_collection_name
    )
    manifest = build_ragas_diagnostic_sample_manifest(
        sample_limit_per_surface=args.sample_limit_per_surface,
        metric_names=metric_names,
        case_ids=tuple(args.case_id),
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
        qdrant_collection_overrides=qdrant_collection_overrides,
        case_ids=tuple(args.case_id),
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
    retrieval_intent = _retrieval_intent_for_case(case)
    retrieval_started_at = time.perf_counter()
    plan = _build_diagnostic_retrieval_plan(
        case=case,
        request=request,
        retrieval_intent=retrieval_intent,
        top_k=top_k,
    )
    if plan is None:
        bundle = backend.retrieve(request)
    else:
        execution = execute_retrieval_plan(plan, backend=backend)
        bundle = execution.merged_evidence
    retrieval_ms = _elapsed_ms(retrieval_started_at)
    answer_started_at = time.perf_counter()
    answer_shape = (
        answer_shape_from_retrieval_intent(retrieval_intent)
        if retrieval_intent is not None
        else infer_answer_shape(evidence=bundle)
    )
    draft = RagAgent().build_answer(
        bundle,
        query_text=case.query,
        retrieval_intent=retrieval_intent,
    )
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
    answer_reference_sources = _answer_reference_sources_for_case(case)
    reference = _reference_for_sources(answer_reference_sources)
    context_ids = tuple(_source_projection_id(source) for source in draft.supporting_sources)
    _validate_projection_contract(
        case=case,
        response=answer_text,
        context_ids=context_ids,
        retrieval_intent=retrieval_intent,
    )
    return (
        RagasProjection(
            case_id=case.case_id,
            user_input=case.query,
            response=response.answer_text,
            retrieved_contexts=draft.supporting_contexts
            or tuple(source.snippet for source in draft.supporting_sources),
            reference=reference,
            retrieved_context_ids=context_ids,
            reference_context_ids=tuple(source.doc_id for source in answer_reference_sources),
            reference_contexts=tuple(
                source.rationale for source in answer_reference_sources if source.rationale
            ),
            metadata={
                "corpus": case.scope.corpus,
                "collection": case.scope.collection,
                "answer_query_text": case.query,
                "retrieval_query_text": bundle.query_text,
                "answer_shape": answer_shape.value,
                "presentation_kind": presentation_kind,
                "presentation_path": draft.presentation_path,
                "diagnostic_reason": draft.diagnostic_reason,
                "retrieval_intent_kind": (
                    retrieval_intent.kind if retrieval_intent is not None else ""
                ),
                "retrieval_answer_kind": (
                    retrieval_intent.expected.answer_kind if retrieval_intent is not None else ""
                ),
                "expected_doc_ids": [source.doc_id for source in case.expected_sources],
                "answer_reference_doc_ids": [
                    source.doc_id for source in answer_reference_sources
                ],
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


def _build_diagnostic_retrieval_plan(
    *,
    case: RetrievalQrelsCase,
    request,
    retrieval_intent: RetrievalIntent | None,
    top_k: int,
) -> RetrievalPlan | None:
    if not _should_use_category_member_plan(retrieval_intent):
        return None
    scope = RetrievalScope(corpus=request.corpus, collection=request.collection)
    semantic_hint = _semantic_hint_from_retrieval_intent(retrieval_intent)
    member_document_ids = retrieval_intent.target.category_member_document_ids
    member_top_k = max(top_k, RAGAS_DIAGNOSTIC_CATEGORY_MEMBER_TOP_K)
    steps = tuple(
        RetrievalStep(
            step_id=f"diagnostic-category-member-lookup-{index}",
            step_type="indexed_lookup",
            scope=scope,
            query_text=request.query_text,
            semantic_hint=semantic_hint,
            selector=RetrievalSelector(
                target_document_ids=(document_id,),
                focus_detail_labels=request.focus_detail_labels,
                focus_article_nos=request.focus_article_nos,
                focus_clause_nos=request.focus_clause_nos,
                focus_terms=request.focus_terms,
            ),
            budget=RetrievalStepBudget(
                top_k=member_top_k,
                timeout_ms=RAGAS_DIAGNOSTIC_INDEXED_LOOKUP_TIMEOUT_MS,
            ),
            expected_output="candidate_set",
        )
        for index, document_id in enumerate(member_document_ids, start=1)
    )
    return RetrievalPlan(
        plan_id=f"{case.scope.corpus}:{case.scope.collection}:ragas-diagnostic-category-members",
        query_mode="current",
        admitted_scopes=(scope,),
        source_trust_policy=RetrievalSourceTrustPolicy(minimum_tier="T1"),
        budget=RetrievalPlanBudget(max_steps=len(steps), max_replans=0),
        steps=steps,
    )


def _should_use_category_member_plan(retrieval_intent: RetrievalIntent | None) -> bool:
    if retrieval_intent is None:
        return False
    if not retrieval_intent.target.category_member_document_ids:
        return False
    return not retrieval_intent.target.document_ids


def _semantic_hint_from_retrieval_intent(
    retrieval_intent: RetrievalIntent | None,
) -> RetrievalSemanticHint | None:
    if retrieval_intent is None:
        return None
    return RetrievalSemanticHint(
        intent_kind=retrieval_intent.kind,
        answer_kind=retrieval_intent.expected.answer_kind,
        need_kinds=_need_kinds_from_retrieval_intent(retrieval_intent),
        coverage_policy=retrieval_intent.expected.coverage_policy,
        selection_policy=retrieval_intent.expected.selection_policy,
        rerank_policy=retrieval_intent.expected.rerank_policy,
        replan_policy=retrieval_intent.expected.replan_policy,
        expected_answer_roles=retrieval_intent.expected.evidence_roles,
        condition_subject=retrieval_intent.target.condition_subject,
        category_id=retrieval_intent.target.category_id,
        critical_terms=retrieval_intent.critical_terms,
    )


def _need_kinds_from_retrieval_intent(retrieval_intent: RetrievalIntent) -> tuple[str, ...]:
    if retrieval_intent.kind == "policy_list":
        return ("policy_list",)
    if retrieval_intent.kind == "condition_table":
        return ("condition_table",)
    if retrieval_intent.kind == "eligibility_judgment":
        return ("eligibility_judgment",)
    if retrieval_intent.kind == "procedure_steps":
        return ("procedure_steps",)
    if retrieval_intent.kind == "specific_clause_lookup":
        return ("specific_clause",)
    if retrieval_intent.kind == "policy_object_lookup":
        return ("policy_object",)
    if retrieval_intent.kind == "curriculum_document_lookup":
        return ("curriculum_document",)
    if retrieval_intent.kind == "curriculum_fact_lookup":
        return ("curriculum_fact",)
    if retrieval_intent.kind == "official_reference_lookup":
        return ("official_reference",)
    if retrieval_intent.kind == "clarification_required":
        return ("clarification",)
    if retrieval_intent.kind == "unsupported":
        return ("unsupported",)
    return ("general_fact",)


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
        scores: dict[str, float | None] = {}
        metric_diagnostics: dict[str, dict[str, object]] = {}
        for result in scorer(projection):
            scores[result.metric_name] = result.score
            if result.score is not None:
                continue
            metric_diagnostics[result.metric_name] = {
                "verdict": result.verdict or "",
                "rationale": result.rationale,
                "metadata": dict(result.metadata),
            }
        projection.metadata["metric_diagnostics"] = metric_diagnostics
        return scores

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


def _answer_reference_sources_for_case(case: RetrievalQrelsCase):
    primary_sources = tuple(source for source in case.expected_sources if source.grade >= 2)
    if primary_sources:
        return primary_sources
    return case.expected_sources


def _reference_for_sources(sources) -> str:
    rationales = tuple(source.rationale for source in sources if source.rationale)
    if rationales:
        return "\n".join(rationales)
    return "\n".join(source.doc_id for source in sources)


def _source_projection_id(source) -> str:
    return str(source.canonical_source_id or source.doc_id or source.chunk_id or "").strip()


def _validate_projection_contract(
    *,
    case: RetrievalQrelsCase,
    response: str,
    context_ids: tuple[str, ...],
    retrieval_intent: RetrievalIntent | None,
) -> None:
    if retrieval_intent is not None and retrieval_intent.kind == "clarification_required":
        if response.strip():
            return
        raise RagasProjectionContractError("clarification projection has empty response")
    if not context_ids:
        raise RagasProjectionContractError(
            f"case {case.case_id} has no supporting evidence after retrieval and selection"
        )
    if not response.strip():
        raise RagasProjectionContractError(
            f"case {case.case_id} has supporting evidence but empty answer text"
        )


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


def _parse_qdrant_collection_overrides(values: list[str]) -> dict[str, str]:
    overrides: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(
                "--qdrant-collection-name must use SURFACE=COLLECTION, "
                f"got {value!r}"
            )
        surface_key, collection_name = (part.strip() for part in value.split("=", 1))
        if not surface_key or not collection_name:
            raise ValueError(
                "--qdrant-collection-name must use non-empty SURFACE=COLLECTION"
            )
        if surface_key not in SURFACE_QRELS_FIXTURES:
            raise ValueError(f"unknown RAGAS diagnostic surface override: {surface_key}")
        overrides[surface_key] = collection_name
    return overrides


def _normalize_qdrant_collection_overrides(
    overrides: Mapping[str, str],
) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for surface_key, collection_name in overrides.items():
        normalized_surface_key = str(surface_key).strip()
        normalized_collection_name = str(collection_name).strip()
        if not normalized_surface_key or not normalized_collection_name:
            raise ValueError("qdrant collection overrides must be non-empty")
        if normalized_surface_key not in SURFACE_QRELS_FIXTURES:
            raise ValueError(f"unknown RAGAS diagnostic surface override: {surface_key}")
        normalized[normalized_surface_key] = normalized_collection_name
    return normalized


@contextmanager
def _override_ragas_diagnostic_runtime_profiles(
    qdrant_collection_overrides: Mapping[str, str],
):
    normalized_overrides = _normalize_qdrant_collection_overrides(qdrant_collection_overrides)
    if not normalized_overrides:
        yield
        return

    original_backend = backend_qdrant_module.load_runtime_profile
    original_service = retrieval_service_module.load_runtime_profile

    def _build_override(loader):
        def _load_runtime_profile(corpus: str, collection: str, *, config_root=None):
            profile = loader(corpus, collection, config_root=config_root)
            override = normalized_overrides.get(f"{corpus}/{collection}")
            if override is None:
                return profile
            return replace(
                profile,
                retrieval_enabled=True,
                qdrant_index_binding=replace(
                    profile.qdrant_index_binding,
                    alias_name=override,
                ),
            )

        return _load_runtime_profile

    stack = ExitStack()
    try:
        stack.enter_context(
            patch.object(
                backend_qdrant_module,
                "load_runtime_profile",
                side_effect=_build_override(original_backend),
            )
        )
        stack.enter_context(
            patch.object(
                retrieval_service_module,
                "load_runtime_profile",
                side_effect=_build_override(original_service),
            )
        )
        stack.enter_context(
            patch.object(
                release_guard_module,
                "_requires_regulation_target_release_proof",
                side_effect=_build_preview_release_guard_override(
                    original=release_guard_module._requires_regulation_target_release_proof,
                    overrides=normalized_overrides,
                ),
            )
        )
        stack.enter_context(
            patch.object(
                backend_qdrant_module,
                "validate_alias_release_metadata",
                side_effect=_build_preview_release_metadata_validation_override(
                    original=backend_qdrant_module.validate_alias_release_metadata,
                    overrides=normalized_overrides,
                    default_alias_names=_default_alias_names(
                        overrides=normalized_overrides,
                        loader=original_backend,
                    ),
                ),
            )
        )
        yield
    finally:
        stack.close()


def _build_preview_release_guard_override(*, original, overrides: Mapping[str, str]):
    def _requires_regulation_target_release_proof(profile) -> bool:
        surface_key = f"{profile.corpus}/{profile.collection}"
        override = overrides.get(surface_key)
        if override and profile.qdrant_index_binding.alias_name == override:
            return False
        return original(profile)

    return _requires_regulation_target_release_proof


def _build_preview_release_metadata_validation_override(
    *,
    original,
    overrides: Mapping[str, str],
    default_alias_names: Mapping[str, str],
):
    def _validate_alias_release_metadata(
        backend,
        *,
        collection_name: str,
        profile,
        settings,
        timeout_seconds: int | None,
    ) -> None:
        surface_key = f"{profile.corpus}/{profile.collection}"
        override = overrides.get(surface_key)
        if (
            override
            and collection_name == override
            and profile.qdrant_index_binding.alias_name == override
            and override != default_alias_names.get(surface_key)
        ):
            return None
        return original(
            backend,
            collection_name=collection_name,
            profile=profile,
            settings=settings,
            timeout_seconds=timeout_seconds,
        )

    return _validate_alias_release_metadata


def _default_alias_names(*, overrides: Mapping[str, str], loader) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for surface_key in overrides:
        corpus, collection = surface_key.split("/", 1)
        aliases[surface_key] = loader(corpus, collection).qdrant_index_binding.alias_name
    return aliases


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
    "RagasProjectionContractError",
    "build_ragas_diagnostic_sample_manifest",
    "combine_ragas_diagnostic_reports",
    "main",
    "run_ragas_diagnostic",
]


if __name__ == "__main__":
    raise SystemExit(main())
