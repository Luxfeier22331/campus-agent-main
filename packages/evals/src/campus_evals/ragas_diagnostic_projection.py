from __future__ import annotations

import time

from campus_contracts import CapabilityResponse, RagResultPayload
from campus_knowledge_capability import KnowledgeCapability
from campus_knowledge_capability.answer_shape import (
    answer_shape_from_retrieval_intent,
    infer_answer_shape,
)
from campus_knowledge_capability.institutional_rules_query_planning import (
    plan_institutional_rules_query,
)
from campus_knowledge_capability.query_planning import (
    plan_curriculum_query,
    plan_student_handbook_query,
)
from campus_knowledge_capability.retrieval_intent import (
    RetrievalIntent,
    RetrievalIntentExpectation,
    RetrievalIntentTarget,
    retrieval_intent_for_official_web_stable_reference,
)
from campus_knowledge_capability.service_clarification import _build_clarification_question
from campus_retrieval_core import (
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalScope,
    RetrievalSelector,
    RetrievalSemanticHint,
    RetrievalSourceTrustPolicy,
    RetrievalStep,
    RetrievalStepBudget,
    execute_retrieval_plan,
)

from campus_evals.benchmark import RetrievalQrelsCase, RetrievalQrelsSourceRef
from campus_evals.ragas_adapter_projection import RagasProjection
from campus_evals.ragas_diagnostic_constants import (
    RAGAS_DIAGNOSTIC_CATEGORY_MEMBER_TOP_K,
    RAGAS_DIAGNOSTIC_FOCUSED_POLICY_TOP_K,
    RAGAS_DIAGNOSTIC_INDEXED_LOOKUP_TIMEOUT_MS,
)
from campus_evals.retrieval_live_benchmark import _build_retrieval_request


class RagasProjectionContractError(ValueError):
    """Raised when diagnostic projection lacks answer-ready support."""


def _build_projection_with_breakdown(
    *,
    case: RetrievalQrelsCase,
    backend: object,
    top_k: int,
    expected_empty_result: bool = False,
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
    if expected_empty_result:
        answer_ms = _elapsed_ms(answer_started_at)
        answer_reference_sources = _answer_reference_sources_for_case(
            case,
            retrieval_intent=retrieval_intent,
        )
        projection = _expected_empty_result_projection(
            case=case,
            bundle=bundle,
            retrieval_intent=retrieval_intent,
            answer_shape=answer_shape,
            reference=_reference_for_sources(answer_reference_sources),
            answer_reference_sources=answer_reference_sources,
        )
        _validate_projection_contract(
            case=case,
            expected_empty_result=expected_empty_result,
            response=projection.response,
            context_ids=projection.retrieved_context_ids,
            retrieval_intent=retrieval_intent,
        )
        return (
            projection,
            {
                "retrieval_ms": retrieval_ms,
                "answer_ms": answer_ms,
            },
        )
    draft = KnowledgeCapability().build_answer(
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
    response = CapabilityResponse(
        capability="knowledge",
        status="completed",
        answer_text=answer_text,
        confidence="medium",
        result=RagResultPayload(evidence=bundle),
    )
    answer_reference_sources = _answer_reference_sources_for_case(
        case,
        retrieval_intent=retrieval_intent,
    )
    reference = _reference_for_sources(answer_reference_sources)
    context_ids = tuple(_source_projection_id(source) for source in draft.supporting_sources)
    _validate_projection_contract(
        case=case,
        expected_empty_result=expected_empty_result,
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
                "answer_reference_doc_ids": [source.doc_id for source in answer_reference_sources],
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


def _expected_empty_result_projection(
    *,
    case: RetrievalQrelsCase,
    bundle,
    retrieval_intent: RetrievalIntent | None,
    answer_shape,
    reference: str,
    answer_reference_sources,
) -> RagasProjection:
    return RagasProjection(
        case_id=case.case_id,
        user_input=case.query,
        response="",
        retrieved_contexts=(),
        reference=reference,
        retrieved_context_ids=(),
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
            "presentation_kind": "expected_empty_result",
            "presentation_path": "expected_empty_result",
            "diagnostic_reason": "expected_empty_result",
            "retrieval_intent_kind": (
                retrieval_intent.kind if retrieval_intent is not None else ""
            ),
            "retrieval_answer_kind": (
                retrieval_intent.expected.answer_kind if retrieval_intent is not None else ""
            ),
            "expected_doc_ids": [source.doc_id for source in case.expected_sources],
            "answer_reference_doc_ids": [source.doc_id for source in answer_reference_sources],
            "retrieved_doc_ids": [source.doc_id for source in bundle.sources],
            "retrieved_chunk_ids": [source.chunk_id for source in bundle.sources],
            "supporting_doc_ids": [],
            "supporting_chunk_ids": [],
        },
    )


def _build_diagnostic_retrieval_plan(
    *,
    case: RetrievalQrelsCase,
    request,
    retrieval_intent: RetrievalIntent | None,
    top_k: int,
) -> RetrievalPlan | None:
    if _should_use_specific_policy_focused_plan(request=request, retrieval_intent=retrieval_intent):
        return _build_specific_policy_focused_diagnostic_plan(
            case=case,
            request=request,
            retrieval_intent=retrieval_intent,
            top_k=top_k,
        )
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


def _should_use_specific_policy_focused_plan(
    *,
    request,
    retrieval_intent: RetrievalIntent | None,
) -> bool:
    if retrieval_intent is None:
        return False
    if request.corpus != "regulations" or request.collection != "student_rules":
        return False
    if not request.target_document_ids:
        return False
    if retrieval_intent.kind not in {
        "procedure_steps",
        "specific_clause_lookup",
        "condition_table",
        "eligibility_judgment",
    }:
        return False
    return bool(
        request.focus_detail_labels
        or request.focus_article_nos
        or request.focus_clause_nos
        or request.focus_terms
        or retrieval_intent.expected.coverage_policy
        in {
            "procedure_step_completeness",
            "condition_subject_alignment",
        }
    )


def _build_specific_policy_focused_diagnostic_plan(
    *,
    case: RetrievalQrelsCase,
    request,
    retrieval_intent: RetrievalIntent,
    top_k: int,
) -> RetrievalPlan:
    scope = RetrievalScope(corpus=request.corpus, collection=request.collection)
    semantic_hint = _semantic_hint_from_retrieval_intent(retrieval_intent)
    selector = RetrievalSelector(
        target_document_ids=request.target_document_ids,
        preferred_document_ids=request.preferred_document_ids,
        focus_detail_labels=request.focus_detail_labels,
        focus_article_nos=request.focus_article_nos,
        focus_clause_nos=request.focus_clause_nos,
        focus_terms=request.focus_terms,
    )
    steps = (
        RetrievalStep(
            step_id="diagnostic-policy-broad-lookup",
            step_type="indexed_lookup",
            scope=scope,
            query_text=retrieval_intent.normalized_query,
            semantic_hint=semantic_hint,
            selector=selector,
            budget=RetrievalStepBudget(
                top_k=max(top_k, request.top_k),
                timeout_ms=RAGAS_DIAGNOSTIC_INDEXED_LOOKUP_TIMEOUT_MS,
            ),
            expected_output="candidate_set",
        ),
        RetrievalStep(
            step_id="diagnostic-policy-focused-lookup",
            step_type="indexed_lookup",
            scope=scope,
            query_text=request.query_text,
            semantic_hint=semantic_hint,
            depends_on_step_ids=("diagnostic-policy-broad-lookup",),
            selector=selector,
            budget=RetrievalStepBudget(
                top_k=max(
                    top_k,
                    request.top_k,
                    RAGAS_DIAGNOSTIC_FOCUSED_POLICY_TOP_K,
                ),
                timeout_ms=RAGAS_DIAGNOSTIC_INDEXED_LOOKUP_TIMEOUT_MS,
            ),
            expected_output="candidate_set",
        ),
    )
    return RetrievalPlan(
        plan_id=f"{case.scope.corpus}:{case.scope.collection}:ragas-diagnostic-specific-policy-focus",
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
            evidence_roles=("document_identity",),
            coverage_policy="single_document_focus",
            selection_policy="document_identity_first",
            replan_policy="focus_gap_replan",
        ),
        target=RetrievalIntentTarget(
            corpus=case.scope.corpus,
            collection=case.scope.collection,
            document_ids=tuple(source.doc_id for source in case.expected_sources if source.doc_id),
        ),
    )


def _answer_reference_sources_for_case(
    case: RetrievalQrelsCase,
    *,
    retrieval_intent: RetrievalIntent | None = None,
):
    if (
        retrieval_intent is not None
        and retrieval_intent.expected.coverage_policy == "category_member_coverage"
        and retrieval_intent.target.category_member_document_ids
    ):
        rationale_by_doc_id = {
            source.doc_id: source.rationale
            for source in case.expected_sources
            if source.doc_id and source.rationale
        }
        return tuple(
            RetrievalQrelsSourceRef(
                doc_id=document_id,
                grade=2,
                rationale=rationale_by_doc_id.get(document_id, document_id),
            )
            for document_id in retrieval_intent.target.category_member_document_ids
        )
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
    expected_empty_result: bool,
    response: str,
    context_ids: tuple[str, ...],
    retrieval_intent: RetrievalIntent | None,
) -> None:
    if retrieval_intent is not None and retrieval_intent.kind == "clarification_required":
        if response.strip():
            return
        raise RagasProjectionContractError("clarification projection has empty response")
    if expected_empty_result:
        if not context_ids and not response.strip():
            return
        raise RagasProjectionContractError(
            f"case {case.case_id} expected empty result but produced supporting evidence or answer text"
        )
    if not context_ids:
        raise RagasProjectionContractError(
            f"case {case.case_id} has no supporting evidence after retrieval and selection"
        )
    if not response.strip():
        raise RagasProjectionContractError(
            f"case {case.case_id} has supporting evidence but empty answer text"
        )


def _elapsed_ms(started_at: float) -> int:
    return max(0, round((time.perf_counter() - started_at) * 1000))


__all__ = [
    "RagasProjectionContractError",
    "_answer_reference_sources_for_case",
    "_build_diagnostic_retrieval_plan",
    "_build_projection_with_breakdown",
    "_case_asks_for_governing_document",
    "_elapsed_ms",
    "_need_kinds_from_retrieval_intent",
    "_policy_object_intent_for_case",
    "_reference_for_sources",
    "_retrieval_intent_for_case",
    "_semantic_hint_from_retrieval_intent",
    "_should_use_category_member_plan",
    "_should_use_specific_policy_focused_plan",
    "_source_projection_id",
    "_validate_projection_contract",
]
