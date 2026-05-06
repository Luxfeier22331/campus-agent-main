from __future__ import annotations

from collections.abc import Callable

from campus_contracts import (
    AgentObservability,
    AgentRequest,
    AgentResponse,
    EvidenceBundle,
    KnowledgeScope,
)
from campus_retrieval_core import RetrievalExecutionResult, RetrievalPlan

from campus_rag_agent.intent import RagIntentFrame
from campus_rag_agent.rag_sdk_models import (
    RagQueryIntent,
    RagSdkEvidenceProjection,
    RagSdkRolloutMode,
    RagSdkRunRequest,
    RagSdkRunResult,
    RagTaskKind,
)
from campus_rag_agent.rag_sdk_output import RagSdkAnswerOutput, validate_rag_sdk_answer_output
from campus_rag_agent.rag_sdk_trace import reject_unsafe_rag_sdk_projection
from campus_rag_agent.retrieval_adequacy import sufficient_retrieval_adequacy

from .service_diagnostics_payload import _build_rag_result_payload
from .service_prompt_runtime import _with_prompt_trace
from .service_response_text import _build_no_answer_response, _resolved_policy_title

RagSdkRunner = Callable[[RagSdkRunRequest], RagSdkRunResult]


def should_attempt_rag_sdk(
    *,
    runner: RagSdkRunner | None,
    rollout_mode: str | RagSdkRolloutMode,
) -> bool:
    if runner is None:
        return False
    mode = _coerce_rollout_mode(rollout_mode)
    return mode in {
        RagSdkRolloutMode.CANDIDATE,
        RagSdkRolloutMode.SHADOW,
        RagSdkRolloutMode.DEFAULT_ON,
    }


def should_return_rag_sdk_response(*, rollout_mode: str | RagSdkRolloutMode) -> bool:
    return _coerce_rollout_mode(rollout_mode) in {
        RagSdkRolloutMode.CANDIDATE,
        RagSdkRolloutMode.DEFAULT_ON,
    }


def maybe_build_rag_sdk_response(
    *,
    request: AgentRequest,
    resolved_scope: KnowledgeScope,
    user_goal: str,
    supporting_evidence: EvidenceBundle,
    retrieved_evidence: EvidenceBundle,
    retrieval_plan: RetrievalPlan,
    retrieval_execution_result: RetrievalExecutionResult | None,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    confidence: str,
    intent_frame: RagIntentFrame,
    runner: RagSdkRunner | None,
    rollout_mode: str | RagSdkRolloutMode,
    planner_information_needs=(),
    projection_context_summaries=(),
) -> AgentResponse | None:
    if not should_attempt_rag_sdk(runner=runner, rollout_mode=rollout_mode):
        return None
    assert runner is not None
    request_projection = RagSdkRunRequest(
        user_goal=user_goal,
        rollout_mode=_coerce_rollout_mode(rollout_mode),
        query_intent=_build_query_intent(
            user_goal=user_goal,
            retrieval_plan=retrieval_plan,
            intent_frame=intent_frame,
        ),
        evidence=RagSdkEvidenceProjection.from_evidence_bundle(supporting_evidence),
        request_id=request.request_id,
    )
    shadow_mode = _coerce_rollout_mode(rollout_mode) == RagSdkRolloutMode.SHADOW
    try:
        result = runner(request_projection)
    except TimeoutError as exc:
        if shadow_mode:
            return None
        return _sdk_fail_closed_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            no_answer_reason="rag_sdk_timeout",
            detail=str(exc) or "RAG SDK runner timed out",
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    except Exception as exc:
        if shadow_mode:
            return None
        return _sdk_fail_closed_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            no_answer_reason="rag_sdk_runtime_failed",
            detail=str(exc) or "RAG SDK runner failed",
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    if not isinstance(result, RagSdkRunResult) or not isinstance(result.output, RagSdkAnswerOutput):
        if shadow_mode:
            return None
        return _sdk_fail_closed_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            no_answer_reason="rag_sdk_malformed_output",
            detail="RAG SDK runner returned malformed output",
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    validation = validate_rag_sdk_answer_output(
        result.output,
        evidence=RagSdkEvidenceProjection.from_evidence_bundle(supporting_evidence),
    )
    if shadow_mode:
        return None
    if not validation.accepted:
        return _sdk_fail_closed_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            no_answer_reason="rag_sdk_guardrail_failed",
            detail=validation.failure_reason,
            claim_supports=validation.claim_supports,
            unsupported_fields=(validation.failure_reason,),
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    try:
        safe_trace_details = _safe_trace_details(result)
    except ValueError:
        return _sdk_fail_closed_response(
            request=request,
            resolved_scope=resolved_scope,
            evidence=supporting_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            no_answer_reason="rag_sdk_runtime_failed",
            detail="rag_sdk_trace_projection_unsafe",
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    return AgentResponse(
        target="rag-agent",
        status="completed",
        answer_text=result.output.answer_text,
        confidence=result.output.confidence or confidence,
        result=_with_prompt_trace(
            _build_rag_result_payload(
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
                claim_supports=validation.claim_supports,
                grounding_verdict="grounded",
                prompt_runtime_state="rag_sdk_completed",
                prompt_runtime_detail=_safe_runtime_detail(result),
                planner_information_needs=planner_information_needs,
                projection_context_summaries=projection_context_summaries,
            ),
            None,
        ),
        agent_observability=AgentObservability(
            safe_details=safe_trace_details,
        ),
    )


def _sdk_fail_closed_response(
    *,
    request: AgentRequest,
    resolved_scope: KnowledgeScope,
    evidence: EvidenceBundle,
    retrieved_evidence: EvidenceBundle,
    retrieval_execution_result: RetrievalExecutionResult | None,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    no_answer_reason: str,
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
            no_answer_reason=no_answer_reason,
            semantic_outcome="unsupported_by_evidence",
            retrieval_adequacy=sufficient_retrieval_adequacy(),
            claim_supports=claim_supports,
            unsupported_fields=unsupported_fields,
            grounding_verdict="unsupported",
            grounding_downgraded=True,
            prompt_runtime_state=no_answer_reason,
            prompt_runtime_detail=detail,
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        ),
    )


def _build_query_intent(
    *,
    user_goal: str,
    retrieval_plan: RetrievalPlan,
    intent_frame: RagIntentFrame,
) -> RagQueryIntent:
    _ = intent_frame
    normalized_goal = user_goal.strip()
    task_kind = RagTaskKind.FACT_LOOKUP
    if "哪些" in normalized_goal or "有哪些" in normalized_goal:
        task_kind = RagTaskKind.CATEGORY_DISCOVERY
    elif "怎么" in normalized_goal or "怎么办" in normalized_goal:
        task_kind = RagTaskKind.AMBIGUOUS_PROCEDURE
    elif "比较" in normalized_goal or "区别" in normalized_goal:
        task_kind = RagTaskKind.COMPARISON
    return RagQueryIntent(
        task_kind=task_kind,
        normalized_query=normalized_goal,
        admitted_query_slot_ids=tuple(step.step_id for step in retrieval_plan.steps),
    )


def _coerce_rollout_mode(value: str | RagSdkRolloutMode) -> RagSdkRolloutMode:
    if isinstance(value, RagSdkRolloutMode):
        return value
    try:
        return RagSdkRolloutMode(str(value or "closed"))
    except ValueError:
        return RagSdkRolloutMode.CLOSED


def _safe_runtime_detail(result: RagSdkRunResult) -> str:
    if result.failure_class:
        return result.failure_class
    if isinstance(result.trace_projection, dict):
        schema = str(result.trace_projection.get("schema_version") or "").strip()
        if schema:
            return schema
    return ""


def _safe_trace_details(result: RagSdkRunResult) -> dict[str, object]:
    projection = result.trace_projection
    if not isinstance(projection, dict):
        return {}
    reject_unsafe_rag_sdk_projection(projection)
    return {"rag_sdk_trace_projection": dict(projection)}


__all__ = [
    "RagSdkRunner",
    "maybe_build_rag_sdk_response",
    "should_attempt_rag_sdk",
    "should_return_rag_sdk_response",
]
