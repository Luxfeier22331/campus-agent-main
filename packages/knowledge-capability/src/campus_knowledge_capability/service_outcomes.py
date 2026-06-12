from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import (
    CapabilityRequest,
    CapabilityResponse,
    ErrorInfo,
    EvidenceBundle,
    KnowledgeScope,
    RagPlannerInformationNeed,
    RagProjectionContextSummary,
)
from campus_retrieval_core import RetrievalExecutionResult

from campus_knowledge_capability.intent import PersonalizationHint, RagIntentFrame
from campus_knowledge_capability.prompt_execution import RagPromptExecutor
from campus_knowledge_capability.retrieval_adequacy import (
    ambiguous_retrieval_adequacy,
    insufficient_retrieval_adequacy,
)

from .remote_content_hardening import build_remote_content_suspicion_summary
from .service_clarification import (
    _build_clarification_question,
    _retrieval_ambiguity_reason,
    _should_clarify_with_evidence,
)
from .service_common import _build_empty_evidence
from .service_diagnostics_adequacy import _empty_evidence_retrieval_adequacy
from .service_diagnostics_payload import _build_rag_result_payload
from .service_prompt_runtime import (
    _build_prompt_runtime_error_response,
    _compose_clarification_response,
    _compose_no_answer_response,
    _with_prompt_trace,
)
from .service_response_text import (
    _build_no_answer_response,
    _build_restricted_access_denied_response,
    _resolved_policy_no_answer_reason,
    _resolved_policy_title,
    _should_fail_closed_resolved_policy_clause,
)


@dataclass(frozen=True, slots=True)
class RagOutcomeContext:
    request: CapabilityRequest
    resolved_scope: KnowledgeScope
    user_goal: str
    personalization_hint: PersonalizationHint
    intent_frame: RagIntentFrame
    prompt_executor: RagPromptExecutor | None
    handbook_plan: object | None
    curriculum_plan: object | None
    curriculum_course_plan: object | None
    curriculum_program_family_plan: object | None
    retrieved_evidence: EvidenceBundle
    retrieval_execution_result: RetrievalExecutionResult | None
    planner_information_needs: tuple[RagPlannerInformationNeed, ...] = ()
    projection_context_summaries: tuple[RagProjectionContextSummary, ...] = ()


def build_missing_scope_clarification_response() -> CapabilityResponse:
    return CapabilityResponse(
        capability="knowledge",
        status="needs_clarification",
        confidence="low",
        answer_text="请先说明你想查询的校内知识范围或资料集合。",
        follow_up_question="请先说明你想查询的校内知识范围或资料集合。",
    )


def build_restricted_access_denied_response(context: RagOutcomeContext) -> CapabilityResponse:
    empty_evidence = _build_empty_evidence(context.resolved_scope, context.user_goal)
    return CapabilityResponse(
        capability="knowledge",
        status="no_answer",
        answer_text=_build_restricted_access_denied_response(context.request, empty_evidence),
        confidence="low",
        result=_build_rag_result_payload(
            evidence=empty_evidence,
            resolved_scope=context.resolved_scope,
            handbook_plan=context.handbook_plan,
            curriculum_plan=context.curriculum_plan,
            curriculum_course_plan=context.curriculum_course_plan,
            curriculum_program_family_plan=context.curriculum_program_family_plan,
            request_id=context.request.request_id,
            no_answer_reason="restricted_access_denied",
            semantic_outcome="restricted_access_denied",
            planner_information_needs=context.planner_information_needs,
            projection_context_summaries=context.projection_context_summaries,
        ),
    )


def build_corpus_query_disabled_error_response(
    context: RagOutcomeContext,
    *,
    message: str,
) -> CapabilityResponse:
    return CapabilityResponse(
        capability="knowledge",
        status="error",
        confidence="low",
        result=_build_rag_result_payload(
            evidence=_build_empty_evidence(context.resolved_scope, context.user_goal),
            retrieved_evidence=context.retrieved_evidence,
            retrieval_execution_result=context.retrieval_execution_result,
            resolved_scope=context.resolved_scope,
            handbook_plan=context.handbook_plan,
            curriculum_plan=context.curriculum_plan,
            curriculum_course_plan=context.curriculum_course_plan,
            curriculum_program_family_plan=context.curriculum_program_family_plan,
            request_id=context.request.request_id,
            planner_information_needs=context.planner_information_needs,
            projection_context_summaries=context.projection_context_summaries,
        ),
        error=ErrorInfo(code="corpus_not_query_enabled", message=message, retryable=False),
    )


def build_retrieval_backend_error_response(
    context: RagOutcomeContext,
    *,
    message: str,
) -> CapabilityResponse:
    return CapabilityResponse(
        capability="knowledge",
        status="error",
        confidence="low",
        result=_build_rag_result_payload(
            evidence=_build_empty_evidence(context.resolved_scope, context.user_goal),
            retrieved_evidence=context.retrieved_evidence,
            retrieval_execution_result=context.retrieval_execution_result,
            resolved_scope=context.resolved_scope,
            handbook_plan=context.handbook_plan,
            curriculum_plan=context.curriculum_plan,
            curriculum_course_plan=context.curriculum_course_plan,
            curriculum_program_family_plan=context.curriculum_program_family_plan,
            request_id=context.request.request_id,
            planner_information_needs=context.planner_information_needs,
            projection_context_summaries=context.projection_context_summaries,
        ),
        error=ErrorInfo(code="retrieval_failed", message=message, retryable=False),
    )


def build_empty_retrieval_no_answer_response(
    context: RagOutcomeContext,
    *,
    evidence: EvidenceBundle,
    no_answer_reason: str,
    semantic_outcome: str,
    freshness_fail_closed: bool,
) -> CapabilityResponse:
    retrieval_adequacy_reason = (
        "weak_supporting_evidence"
        if _retrieval_reference_count(context.retrieval_execution_result)
        else no_answer_reason
    )
    answer_text, prompt_trace, prompt_runtime_state, prompt_runtime_detail = (
        _compose_no_answer_response(
            request=context.request,
            resolved_scope=context.resolved_scope,
            evidence=evidence,
            no_answer_reason=no_answer_reason,
            deterministic_answer_text=_build_no_answer_response(
                evidence,
                resolved_policy_title=_resolved_policy_title(context.handbook_plan),
            ),
            prompt_executor=context.prompt_executor,
            intent_frame=context.intent_frame,
        )
    )
    if prompt_runtime_state:
        return _prompt_runtime_error_response(
            context,
            evidence=evidence,
            prompt_runtime_state=prompt_runtime_state,
            prompt_runtime_detail=prompt_runtime_detail,
        )
    return CapabilityResponse(
        capability="knowledge",
        status="no_answer",
        answer_text=answer_text,
        confidence="low",
        result=_with_prompt_trace(
            _build_rag_result_payload(
                evidence=evidence,
                resolved_scope=context.resolved_scope,
                handbook_plan=context.handbook_plan,
                curriculum_plan=context.curriculum_plan,
                curriculum_course_plan=context.curriculum_course_plan,
                curriculum_program_family_plan=context.curriculum_program_family_plan,
                request_id=context.request.request_id,
                no_answer_reason=no_answer_reason,
                semantic_outcome=semantic_outcome,
                retrieval_adequacy=_empty_evidence_retrieval_adequacy(retrieval_adequacy_reason),
                freshness_fail_closed=freshness_fail_closed,
                prompt_runtime_state=prompt_runtime_state,
                prompt_runtime_detail=prompt_runtime_detail,
                retrieval_execution_result=context.retrieval_execution_result,
                planner_information_needs=context.planner_information_needs,
                projection_context_summaries=context.projection_context_summaries,
            ),
            prompt_trace,
        ),
    )


def maybe_build_evidence_clarification_response(
    context: RagOutcomeContext,
    *,
    effective_user_goal: str,
    evidence: EvidenceBundle,
) -> CapabilityResponse | None:
    if (
        context.handbook_plan is not None
        and getattr(context.handbook_plan, "task_kind", "") == "category_discovery"
    ):
        return None
    if not _should_clarify_with_evidence(effective_user_goal, evidence):
        return None
    follow_up_question, prompt_trace, prompt_runtime_state, prompt_runtime_detail = (
        _compose_clarification_response(
            request=context.request,
            resolved_scope=context.resolved_scope,
            evidence=evidence,
            deterministic_question=_build_clarification_question(
                context.user_goal,
                evidence,
                recent_goal=context.personalization_hint.recent_goal,
                confirmed_slot_terms=context.personalization_hint.confirmed_slot_terms,
                clarification_candidates=context.curriculum_plan.clarification_candidates
                if context.curriculum_plan is not None
                else (),
            ),
            prompt_executor=context.prompt_executor,
            intent_frame=context.intent_frame,
        )
    )
    if prompt_runtime_state:
        return _prompt_runtime_error_response(
            context,
            evidence=evidence,
            prompt_runtime_state=prompt_runtime_state,
            prompt_runtime_detail=prompt_runtime_detail,
        )
    return CapabilityResponse(
        capability="knowledge",
        status="needs_clarification",
        confidence="low",
        answer_text=follow_up_question,
        follow_up_question=follow_up_question,
        result=_with_prompt_trace(
            _build_rag_result_payload(
                evidence=evidence,
                resolved_scope=context.resolved_scope,
                handbook_plan=context.handbook_plan,
                curriculum_plan=context.curriculum_plan,
                curriculum_course_plan=context.curriculum_course_plan,
                request_id=context.request.request_id,
                retrieval_adequacy=ambiguous_retrieval_adequacy(
                    _retrieval_ambiguity_reason(effective_user_goal, evidence)
                ),
                prompt_runtime_state=prompt_runtime_state,
                prompt_runtime_detail=prompt_runtime_detail,
                retrieval_execution_result=context.retrieval_execution_result,
                planner_information_needs=context.planner_information_needs,
                projection_context_summaries=context.projection_context_summaries,
            ),
            prompt_trace,
        ),
    )


def build_no_supporting_evidence_response(
    context: RagOutcomeContext,
    *,
    supporting_evidence: EvidenceBundle,
) -> CapabilityResponse:
    retrieved_source_count = _retrieval_reference_count(context.retrieval_execution_result)
    if not retrieved_source_count and context.retrieved_evidence is not None:
        retrieved_source_count = len(context.retrieved_evidence.sources)
    return _build_unsupported_by_evidence_response(
        context,
        evidence=supporting_evidence,
        no_answer_reason=_resolved_policy_no_answer_reason(context.handbook_plan),
        retrieval_adequacy_reason=(
            "weak_supporting_evidence" if retrieved_source_count else "no_supporting_sources"
        ),
    )


def build_remote_content_suspicion_no_answer_response(
    context: RagOutcomeContext,
    *,
    supporting_evidence: EvidenceBundle,
) -> CapabilityResponse:
    return _build_unsupported_by_evidence_response(
        context,
        evidence=supporting_evidence,
        no_answer_reason="remote_content_suspicion_blocked",
        retrieval_adequacy_reason="remote_content_suspicion_blocked",
        remote_content_suspicion_summary=build_remote_content_suspicion_summary(
            supporting_evidence,
            generation_blocked=True,
        ),
    )


def _retrieval_reference_count(retrieval_execution_result: RetrievalExecutionResult | None) -> int:
    if retrieval_execution_result is None:
        return 0
    return sum(
        len(step_result.references) for step_result in retrieval_execution_result.step_results
    )


def build_low_confidence_no_answer_response(
    context: RagOutcomeContext,
    *,
    supporting_evidence: EvidenceBundle,
) -> CapabilityResponse:
    return _build_unsupported_by_evidence_response(
        context,
        evidence=supporting_evidence,
        no_answer_reason=_resolved_policy_no_answer_reason(context.handbook_plan),
        retrieval_adequacy_reason="weak_supporting_evidence",
    )


def maybe_build_resolved_policy_clause_fail_closed_response(
    context: RagOutcomeContext,
    *,
    supporting_evidence: EvidenceBundle,
) -> CapabilityResponse | None:
    if not _should_fail_closed_resolved_policy_clause(
        user_goal=context.user_goal,
        evidence=supporting_evidence,
        handbook_plan=context.handbook_plan,
    ):
        return None
    empty_evidence = _build_empty_evidence(context.resolved_scope, context.user_goal)
    return CapabilityResponse(
        capability="knowledge",
        status="no_answer",
        answer_text=_build_no_answer_response(
            empty_evidence,
            resolved_policy_title=_resolved_policy_title(context.handbook_plan),
        ),
        confidence="low",
        result=_build_rag_result_payload(
            evidence=empty_evidence,
            retrieved_evidence=context.retrieved_evidence,
            retrieval_execution_result=context.retrieval_execution_result,
            resolved_scope=context.resolved_scope,
            handbook_plan=context.handbook_plan,
            curriculum_plan=context.curriculum_plan,
            curriculum_course_plan=context.curriculum_course_plan,
            curriculum_program_family_plan=context.curriculum_program_family_plan,
            request_id=context.request.request_id,
            no_answer_reason=_resolved_policy_no_answer_reason(context.handbook_plan),
            semantic_outcome="unsupported_by_evidence",
            retrieval_adequacy=insufficient_retrieval_adequacy("resolved_policy_clause_not_found"),
            planner_information_needs=context.planner_information_needs,
            projection_context_summaries=context.projection_context_summaries,
        ),
    )


def _build_unsupported_by_evidence_response(
    context: RagOutcomeContext,
    *,
    evidence: EvidenceBundle,
    no_answer_reason: str,
    retrieval_adequacy_reason: str,
    remote_content_suspicion_summary=None,
) -> CapabilityResponse:
    answer_text, prompt_trace, prompt_runtime_state, prompt_runtime_detail = (
        _compose_no_answer_response(
            request=context.request,
            resolved_scope=context.resolved_scope,
            evidence=evidence,
            no_answer_reason=no_answer_reason,
            deterministic_answer_text=_build_no_answer_response(
                evidence,
                resolved_policy_title=_resolved_policy_title(context.handbook_plan),
            ),
            prompt_executor=context.prompt_executor,
            intent_frame=context.intent_frame,
        )
    )
    if prompt_runtime_state:
        return _prompt_runtime_error_response(
            context,
            evidence=evidence,
            prompt_runtime_state=prompt_runtime_state,
            prompt_runtime_detail=prompt_runtime_detail,
        )
    return CapabilityResponse(
        capability="knowledge",
        status="no_answer",
        answer_text=answer_text,
        confidence="low",
        result=_with_prompt_trace(
            _build_rag_result_payload(
                evidence=evidence,
                retrieved_evidence=context.retrieved_evidence,
                retrieval_execution_result=context.retrieval_execution_result,
                resolved_scope=context.resolved_scope,
                handbook_plan=context.handbook_plan,
                curriculum_plan=context.curriculum_plan,
                curriculum_course_plan=context.curriculum_course_plan,
                curriculum_program_family_plan=context.curriculum_program_family_plan,
                request_id=context.request.request_id,
                no_answer_reason=no_answer_reason,
                semantic_outcome="unsupported_by_evidence",
                retrieval_adequacy=insufficient_retrieval_adequacy(retrieval_adequacy_reason),
                remote_content_suspicion_summary=remote_content_suspicion_summary,
                prompt_runtime_state=prompt_runtime_state,
                prompt_runtime_detail=prompt_runtime_detail,
                planner_information_needs=context.planner_information_needs,
                projection_context_summaries=context.projection_context_summaries,
            ),
            prompt_trace,
        ),
    )


def _prompt_runtime_error_response(
    context: RagOutcomeContext,
    *,
    evidence: EvidenceBundle,
    prompt_runtime_state: str,
    prompt_runtime_detail: str,
) -> CapabilityResponse:
    return _build_prompt_runtime_error_response(
        request=context.request,
        resolved_scope=context.resolved_scope,
        evidence=evidence,
        retrieved_evidence=context.retrieved_evidence,
        retrieval_execution_result=context.retrieval_execution_result,
        prompt_runtime_state=prompt_runtime_state,
        prompt_runtime_detail=prompt_runtime_detail,
        build_rag_result_payload=_build_rag_result_payload,
        handbook_plan=context.handbook_plan,
        curriculum_plan=context.curriculum_plan,
        curriculum_course_plan=context.curriculum_course_plan,
        curriculum_program_family_plan=context.curriculum_program_family_plan,
        planner_information_needs=context.planner_information_needs,
        projection_context_summaries=context.projection_context_summaries,
    )
