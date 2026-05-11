from __future__ import annotations

from collections.abc import Callable

from campus_contracts import (
    AgentObservability,
    AgentRequest,
    AgentResponse,
    ErrorInfo,
    KnowledgeScope,
)

from campus_rag_agent.agent import RagAgent
from campus_rag_agent.grounding_validation import validate_prompt_answer_grounding
from campus_rag_agent.rag_sdk_output import validate_rag_sdk_answer_output
from campus_rag_agent.rag_sdk_trace import reject_unsafe_rag_sdk_projection
from campus_rag_agent.retrieval_adequacy import sufficient_retrieval_adequacy

from .rag_sdk_models import (
    RagQueryIntent,
    RagSdkEvidenceProjection,
    RagSdkRunRequest,
    RagSdkRunResult,
    RagTaskKind,
)
from .retrieval_intent import RetrievalIntent
from .service_diagnostics_payload import _build_rag_result_payload
from .service_response_text import _build_no_answer_response, _resolved_policy_title

RagSdkRunner = Callable[[RagSdkRunRequest], RagSdkRunResult]
_RAG_SDK_RUNNER_NOT_PROVIDED = object()


def build_required_rag_sdk_response(
    *,
    request: AgentRequest,
    resolved_scope: KnowledgeScope,
    user_goal: str,
    supporting_evidence,
    retrieved_evidence,
    retrieval_plan,
    retrieval_execution_result,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    confidence: str,
    intent_frame,
    runner: RagSdkRunner | None | object,
    planner_information_needs=(),
    projection_context_summaries=(),
    retrieval_intent: RetrievalIntent | None = None,
) -> AgentResponse:
    answer_draft = RagAgent().build_answer(
        supporting_evidence,
        retrieval_intent=retrieval_intent,
    )
    if runner is _RAG_SDK_RUNNER_NOT_PROVIDED or runner is None:
        return _rag_sdk_runtime_error_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            error_code="rag_sdk_runtime_unavailable",
            detail="explicit rag_sdk_runner is required for query-enabled RAG synthesis",
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    request_projection = RagSdkRunRequest(
        user_goal=user_goal,
        query_intent=build_rag_query_intent(
            user_goal=user_goal,
            retrieval_plan=retrieval_plan,
            intent_frame=intent_frame,
            retrieval_intent=retrieval_intent,
        ),
        evidence=RagSdkEvidenceProjection.from_evidence_bundle(supporting_evidence),
        typed_answer=answer_draft.typed_draft,
        request_id=request.request_id,
        selector_blocked_query_slot_ids=selector_blocked_query_slot_ids(retrieval_plan),
    )
    try:
        result = runner(request_projection)
    except TimeoutError as exc:
        return _rag_sdk_runtime_error_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            error_code="rag_sdk_timeout",
            detail=str(exc) or "RAG SDK runner timed out",
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    except Exception as exc:
        return _rag_sdk_runtime_error_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            error_code="rag_sdk_runtime_failed",
            detail=str(exc) or "RAG SDK runner failed",
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    if result.failure_class.strip():
        return _rag_sdk_runtime_error_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            error_code=result.failure_class.strip(),
            detail=result.failure_detail.strip() or result.failure_class.strip(),
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    validation = validate_rag_sdk_answer_output(
        result.output,
        evidence=RagSdkEvidenceProjection.from_evidence_bundle(supporting_evidence),
    )
    if not validation.accepted:
        return _rag_sdk_generation_fail_closed_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            fail_close_reason="rag_sdk_guardrail_failed",
            detail=validation.failure_reason,
            claim_supports=validation.claim_supports,
            unsupported_fields=(validation.failure_reason,),
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    grounding = validate_prompt_answer_grounding(
        answer_text=result.output.answer_text,
        evidence=supporting_evidence,
        provider_grounding_supports=result.provider_grounding_supports,
    )
    if grounding.verdict != "grounded":
        return _rag_sdk_generation_fail_closed_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            fail_close_reason="insufficient_grounding",
            detail="rag_sdk_answer_text_unsupported",
            claim_supports=grounding.claim_supports,
            unsupported_fields=grounding.unsupported_fields,
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    try:
        safe_trace_details = safe_rag_sdk_trace_details(result)
    except ValueError:
        return _rag_sdk_runtime_error_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            error_code="rag_sdk_runtime_failed",
            detail="rag_sdk_trace_projection_unsafe",
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    return AgentResponse(
        target="rag-agent",
        status="completed",
        answer_text=result.output.answer_text,
        confidence=result.output.confidence or confidence,
        result=_build_rag_result_payload(
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            resolved_scope=resolved_scope,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            request_id=request.request_id,
            allow_session_follow_up=True,
            semantic_outcome=result.output.semantic_outcome or "grounded_answer",
            retrieval_adequacy=sufficient_retrieval_adequacy(),
            claim_supports=_completed_claim_supports(
                validation_claim_supports=validation.claim_supports,
                grounding_claim_supports=grounding.claim_supports,
            ),
            grounding_verdict="grounded",
            prompt_runtime_state="rag_sdk_completed",
            prompt_runtime_detail=safe_rag_sdk_runtime_detail(result),
            answer_presentation_kind=answer_draft.presentation_kind,
            answer_fallback_path=answer_draft.fallback_path,
            answer_fallback_reason=answer_draft.fallback_reason,
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        ),
        agent_observability=AgentObservability(
            safe_details=safe_trace_details,
        ),
    )


def build_rag_query_intent(
    *,
    user_goal: str,
    retrieval_plan,
    intent_frame,
    retrieval_intent: RetrievalIntent | None = None,
) -> RagQueryIntent:
    _ = intent_frame
    normalized_goal = user_goal.strip()
    task_kind = _rag_task_kind_from_retrieval_intent(retrieval_intent)
    return RagQueryIntent(
        task_kind=task_kind,
        normalized_query=normalized_goal,
        category_id=(
            retrieval_intent.target.category_id
            if retrieval_intent is not None and retrieval_intent.target.category_id
            else ""
        ),
        admitted_query_slot_ids=tuple(step.step_id for step in retrieval_plan.steps),
        needs_clarification=(
            retrieval_intent.kind == "clarification_required"
            if retrieval_intent is not None
            else False
        ),
        unsupported_reason=(
            retrieval_intent.unsupported_reason if retrieval_intent is not None else ""
        ),
    )


def _rag_task_kind_from_retrieval_intent(
    retrieval_intent: RetrievalIntent | None,
) -> RagTaskKind:
    if retrieval_intent is None:
        return RagTaskKind.FACT_LOOKUP
    if retrieval_intent.kind == "policy_list":
        return RagTaskKind.CATEGORY_DISCOVERY
    if retrieval_intent.kind in {
        "policy_object_lookup",
        "specific_clause_lookup",
        "eligibility_judgment",
        "procedure_steps",
        "condition_table",
        "general_fact_lookup",
        "official_reference_lookup",
        "curriculum_document_lookup",
        "curriculum_fact_lookup",
    }:
        return RagTaskKind.SPECIFIC_POLICY_LOOKUP
    if retrieval_intent.kind == "clarification_required":
        return RagTaskKind.AMBIGUOUS_PROCEDURE
    if retrieval_intent.kind == "version_compare":
        return RagTaskKind.COMPARISON
    if retrieval_intent.kind == "unsupported":
        return RagTaskKind.UNSUPPORTED_SCOPE
    return RagTaskKind.FACT_LOOKUP


def _completed_claim_supports(
    *,
    validation_claim_supports,
    grounding_claim_supports,
):
    return validation_claim_supports or grounding_claim_supports


def selector_blocked_query_slot_ids(retrieval_plan) -> tuple[str, ...]:
    blocked: list[str] = []
    for step in retrieval_plan.steps:
        selector = step.selector
        if not selector.target_document_ids:
            continue
        if step.step_id in {
            "indexed-lookup",
            "entity-resolution",
            "historical-version-lookup",
            "compare-current-lookup",
            "compare-other-lookup",
        }:
            continue
        blocked.append(step.step_id)
    return tuple(blocked)


def safe_rag_sdk_runtime_detail(result: RagSdkRunResult) -> str:
    if result.failure_class:
        return result.failure_class
    if isinstance(result.trace_projection, dict):
        schema = str(result.trace_projection.get("schema_version") or "").strip()
        if schema:
            return schema
    return ""


def safe_rag_sdk_trace_details(result: RagSdkRunResult) -> dict[str, object]:
    projection = result.trace_projection
    if not isinstance(projection, dict):
        return {}
    reject_unsafe_rag_sdk_projection(projection)
    return {"rag_sdk_trace_projection": dict(projection)}


def _rag_sdk_generation_fail_closed_response(
    *,
    request: AgentRequest,
    resolved_scope: KnowledgeScope,
    evidence,
    retrieved_evidence,
    retrieval_execution_result,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    fail_close_reason: str,
    detail: str,
    claim_supports=(),
    unsupported_fields=(),
    planner_information_needs=(),
    projection_context_summaries=(),
) -> AgentResponse:
    return AgentResponse(
        target="rag-agent",
        status="no_answer",
        answer_text=_build_no_answer_response(
            evidence,
            resolved_policy_title=_resolved_policy_title(handbook_plan),
        ),
        confidence="low",
        result=_build_rag_result_payload(
            evidence=evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            resolved_scope=resolved_scope,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            request_id=request.request_id,
            no_answer_reason="",
            fail_close_reason=fail_close_reason,
            semantic_outcome="fail_closed_generation",
            retrieval_adequacy=sufficient_retrieval_adequacy(),
            claim_supports=claim_supports,
            unsupported_fields=unsupported_fields,
            grounding_verdict="unsupported",
            grounding_downgraded=True,
            prompt_runtime_state=fail_close_reason,
            prompt_runtime_detail=detail,
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        ),
    )


def _rag_sdk_runtime_error_response(
    *,
    request: AgentRequest,
    resolved_scope: KnowledgeScope,
    evidence,
    retrieved_evidence,
    retrieval_execution_result,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    error_code: str,
    detail: str,
    planner_information_needs=(),
    projection_context_summaries=(),
) -> AgentResponse:
    return AgentResponse(
        target="rag-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code=error_code,
            message=detail,
            retryable=error_code in {"rag_sdk_timeout", "rag_sdk_runtime_failed"},
        ),
        result=_build_rag_result_payload(
            evidence=evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            resolved_scope=resolved_scope,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            request_id=request.request_id,
            no_answer_reason="",
            fail_close_reason=error_code,
            semantic_outcome="runtime_error",
            retrieval_adequacy=sufficient_retrieval_adequacy(),
            grounding_verdict="unsupported",
            grounding_downgraded=True,
            prompt_runtime_state=error_code,
            prompt_runtime_detail=detail,
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        ),
    )


__all__ = [
    "_RAG_SDK_RUNNER_NOT_PROVIDED",
    "RagSdkRunner",
    "build_rag_query_intent",
    "build_required_rag_sdk_response",
    "safe_rag_sdk_runtime_detail",
    "safe_rag_sdk_trace_details",
    "selector_blocked_query_slot_ids",
]
