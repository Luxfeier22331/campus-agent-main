from __future__ import annotations

from campus_contracts import (
    AgentRequest,
    AgentResponse,
    KnowledgeScope,
    RagRequestPayload,
    RagResultDiagnostics,
    RagResultPayload,
)
from campus_ingestion_core import load_runtime_profile
from campus_rag_agent.agent import RagAgent
from campus_rag_agent.service_pipeline import build_rag_pipeline_context
from campus_rag_agent.typed_answer_drafts import validate_typed_answer_draft
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source


def build_rag_stage_diagnostic_case(
    *,
    case_id: str,
    user_goal: str,
    response: AgentResponse,
) -> dict[str, object]:
    result = response.result
    if not isinstance(result, RagResultPayload):
        raise ValueError("rag stage diagnostics require RagResultPayload")
    diagnostics = result.diagnostics
    if diagnostics is None:
        raise ValueError("rag stage diagnostics require response.result.diagnostics")

    retrieval_intent = _resolve_retrieval_intent_projection(
        user_goal=user_goal,
        response=response,
        diagnostics=diagnostics,
    )
    answer_draft = RagAgent().build_answer(
        result.evidence,
        retrieval_intent=retrieval_intent,
    )
    draft_validation = validate_typed_answer_draft(
        answer_draft.typed_draft,
        expected_answer_kind=retrieval_intent.expected.answer_kind,
    )
    runtime_profile = load_runtime_profile(result.evidence.corpus, result.evidence.collection)
    retrieval_plan_summary = diagnostics.retrieval_plan_summary
    step_activities = (
        tuple(retrieval_plan_summary.step_activities) if retrieval_plan_summary else ()
    )
    stage_by_name = {stage.stage_name: stage for stage in diagnostics.stage_activities}
    rerank_failure_kind = next(
        (
            activity.failure_kind
            for activity in step_activities
            if activity.failure_kind == "reranker_degraded"
        ),
        "",
    )
    rerank_enabled = bool(
        getattr(runtime_profile, "reranker_enabled_by_default", False)
        and retrieval_intent.expected.rerank_policy == "profile_gated_if_eligible"
    )

    return {
        "case_id": case_id,
        "response_status": response.status,
        "stage_order": (
            "intent",
            "plan",
            "retrieval",
            "rerank",
            "selection",
            "typed_answer",
            "synthesis",
            "grounding",
        ),
        "intent": {
            **retrieval_intent.to_dict(),
            "answer_kind": retrieval_intent.expected.answer_kind,
            "condition_subject": retrieval_intent.target.condition_subject,
            "failure_class": "" if retrieval_intent.kind else "intent_mismatch",
        },
        "plan": {
            "plan_id": retrieval_plan_summary.plan_id if retrieval_plan_summary is not None else "",
            "query_mode": (
                retrieval_plan_summary.query_mode if retrieval_plan_summary is not None else ""
            ),
            "step_count": len(step_activities),
            "need_ids": tuple(need.need_id for need in diagnostics.planner_information_needs),
            "failure_class": (
                ""
                if retrieval_plan_summary is not None and diagnostics.planner_information_needs
                else "plan_mismatch"
            ),
        },
        "retrieval": {
            "terminal_state": (
                retrieval_plan_summary.terminal_state
                if retrieval_plan_summary is not None
                else _stage_status(stage_by_name.get("retrieval"))
            ),
            "candidate_count": sum(activity.candidate_count for activity in step_activities),
            "reference_count": sum(activity.reference_count for activity in step_activities),
            "step_ids": tuple(activity.step_id for activity in step_activities),
            "failure_class": _retrieval_failure_class(
                retrieval_plan_summary_terminal_state=(
                    retrieval_plan_summary.terminal_state
                    if retrieval_plan_summary is not None
                    else ""
                ),
                candidate_count=sum(activity.candidate_count for activity in step_activities),
            ),
        },
        "rerank": {
            "enabled": rerank_enabled,
            "degraded": bool(rerank_failure_kind),
            "failure_kind": rerank_failure_kind,
            "failure_class": "rerank_regression" if rerank_failure_kind else "",
        },
        "selection": {
            "supporting_evidence_count": len(result.evidence.sources),
            "selected_doc_ids": tuple(source.doc_id for source in result.evidence.sources),
            "selected_answer_roles": tuple(
                evidence_attributes_for_source(source).answer_role
                for source in result.evidence.sources
            ),
            "failure_class": ("selection_missing_coverage" if not result.evidence.sources else ""),
        },
        "typed_answer": {
            "kind": answer_draft.typed_draft.kind,
            "validation_verdict": draft_validation.verdict,
            "validation_failure_reason": draft_validation.failure_reason,
            "presentation_kind": answer_draft.presentation_kind,
            "fallback_path": answer_draft.fallback_path,
            "fallback_reason": answer_draft.fallback_reason,
            "failure_class": (
                "typed_answer_invalid" if draft_validation.verdict != "valid" else ""
            ),
        },
        "synthesis": {
            "semantic_outcome": diagnostics.semantic_outcome,
            "prompt_runtime_state": diagnostics.prompt_runtime_state,
            "presentation_kind": (
                diagnostics.answer_presentation_kind or answer_draft.presentation_kind
            ),
            "fallback_path": diagnostics.answer_fallback_path or answer_draft.fallback_path,
            "fallback_reason": diagnostics.answer_fallback_reason or answer_draft.fallback_reason,
            "failure_class": (
                "synthesis_contract_failed"
                if diagnostics.prompt_runtime_state
                in {"rag_sdk_guardrail_failed", "rag_sdk_runtime_failed"}
                else ""
            ),
        },
        "grounding": {
            "verdict": diagnostics.grounding_verdict,
            "unsupported_fields": tuple(diagnostics.unsupported_fields),
            "failure_class": (
                "grounding_mismatch" if diagnostics.grounding_verdict != "grounded" else ""
            ),
        },
    }


def _resolve_retrieval_intent_projection(
    *,
    user_goal: str,
    response: AgentResponse,
    diagnostics: RagResultDiagnostics,
):
    scope = _resolve_scope(response=response, diagnostics=diagnostics)
    pipeline = build_rag_pipeline_context(
        AgentRequest(
            target="rag-agent",
            user_goal=user_goal,
            payload=RagRequestPayload(scope=scope),
        ),
        prompt_executor=None,
    )
    if pipeline.retrieval_intent is None:
        raise ValueError("rag stage diagnostics require retrieval intent for covered scope")
    return pipeline.retrieval_intent


def _resolve_scope(
    *,
    response: AgentResponse,
    diagnostics: RagResultDiagnostics,
) -> KnowledgeScope:
    corpus = diagnostics.resolved_scope_corpus or response.result.evidence.corpus
    collection = diagnostics.resolved_scope_collection or response.result.evidence.collection
    if corpus is None or not str(collection).strip():
        raise ValueError("rag stage diagnostics require resolved scope")
    return KnowledgeScope(corpus=corpus, collection=collection)


def _stage_status(stage) -> str:
    return stage.stage_status if stage is not None else ""


def _retrieval_failure_class(
    *,
    retrieval_plan_summary_terminal_state: str,
    candidate_count: int,
) -> str:
    if retrieval_plan_summary_terminal_state in {"blocked", "failed_closed"}:
        return "retrieval_miss"
    if candidate_count <= 0:
        return "retrieval_miss"
    return ""


__all__ = ["build_rag_stage_diagnostic_case"]
