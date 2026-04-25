from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import AgentRequest, AgentResponse, EvidenceBundle, KnowledgeScope
from campus_retrieval_core import RetrievalExecutionResult

from campus_rag_agent.intent import PersonalizationHint, RagIntentFrame
from campus_rag_agent.prompt_execution import RagPromptExecutor
from campus_rag_agent.retrieval_adequacy import (
    ambiguous_retrieval_adequacy,
    insufficient_retrieval_adequacy,
)

from .service_common import _build_empty_evidence
from .service_diagnostics_adequacy import _empty_evidence_retrieval_adequacy
from .service_diagnostics_payload import _build_rag_result_payload
from .service_prompting import (
    _build_clarification_question,
    _compose_clarification_response,
    _compose_no_answer_response,
    _retrieval_ambiguity_reason,
    _should_clarify_with_evidence,
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
    request: AgentRequest
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


def build_restricted_access_denied_response(context: RagOutcomeContext) -> AgentResponse:
    empty_evidence = _build_empty_evidence(context.resolved_scope, context.user_goal)
    return AgentResponse(
        target="rag-agent",
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
            no_answer_reason="restricted_access_denied",
            semantic_outcome="restricted_access_denied",
        ),
    )


def build_empty_retrieval_no_answer_response(
    context: RagOutcomeContext,
    *,
    evidence: EvidenceBundle,
    no_answer_reason: str,
    semantic_outcome: str,
    freshness_fail_closed: bool,
) -> AgentResponse:
    answer_text, prompt_trace, prompt_runtime_state, prompt_runtime_detail = (
        _compose_no_answer_response(
            request=context.request,
            resolved_scope=context.resolved_scope,
            evidence=evidence,
            no_answer_reason=no_answer_reason,
            fallback_answer=_build_no_answer_response(
                evidence,
                resolved_policy_title=_resolved_policy_title(context.handbook_plan),
            ),
            prompt_executor=context.prompt_executor,
            intent_frame=context.intent_frame,
        )
    )
    return AgentResponse(
        target="rag-agent",
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
                no_answer_reason=no_answer_reason,
                semantic_outcome=semantic_outcome,
                retrieval_adequacy=_empty_evidence_retrieval_adequacy(no_answer_reason),
                freshness_fail_closed=freshness_fail_closed,
                prompt_runtime_state=prompt_runtime_state,
                prompt_runtime_detail=prompt_runtime_detail,
                retrieval_execution_result=context.retrieval_execution_result,
            ),
            prompt_trace,
        ),
    )


def maybe_build_evidence_clarification_response(
    context: RagOutcomeContext,
    *,
    effective_user_goal: str,
    evidence: EvidenceBundle,
) -> AgentResponse | None:
    if not _should_clarify_with_evidence(effective_user_goal, evidence):
        return None
    follow_up_question, prompt_trace, prompt_runtime_state, prompt_runtime_detail = (
        _compose_clarification_response(
            request=context.request,
            resolved_scope=context.resolved_scope,
            evidence=evidence,
            fallback_question=_build_clarification_question(
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
    return AgentResponse(
        target="rag-agent",
        status="needs_clarification",
        confidence="low",
        follow_up_question=follow_up_question,
        result=_with_prompt_trace(
            _build_rag_result_payload(
                evidence=evidence,
                resolved_scope=context.resolved_scope,
                handbook_plan=context.handbook_plan,
                curriculum_plan=context.curriculum_plan,
                curriculum_course_plan=context.curriculum_course_plan,
                retrieval_adequacy=ambiguous_retrieval_adequacy(
                    _retrieval_ambiguity_reason(effective_user_goal, evidence)
                ),
                prompt_runtime_state=prompt_runtime_state,
                prompt_runtime_detail=prompt_runtime_detail,
                retrieval_execution_result=context.retrieval_execution_result,
            ),
            prompt_trace,
        ),
    )


def build_no_supporting_evidence_response(
    context: RagOutcomeContext,
    *,
    supporting_evidence: EvidenceBundle,
) -> AgentResponse:
    return _build_unsupported_by_evidence_response(
        context,
        evidence=supporting_evidence,
        no_answer_reason=_resolved_policy_no_answer_reason(context.handbook_plan),
        retrieval_adequacy_reason="no_supporting_sources",
    )


def build_low_confidence_no_answer_response(
    context: RagOutcomeContext,
    *,
    supporting_evidence: EvidenceBundle,
) -> AgentResponse:
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
) -> AgentResponse | None:
    if not _should_fail_closed_resolved_policy_clause(
        user_goal=context.user_goal,
        evidence=supporting_evidence,
        handbook_plan=context.handbook_plan,
    ):
        return None
    empty_evidence = _build_empty_evidence(context.resolved_scope, context.user_goal)
    return AgentResponse(
        target="rag-agent",
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
            no_answer_reason=_resolved_policy_no_answer_reason(context.handbook_plan),
            semantic_outcome="unsupported_by_evidence",
            retrieval_adequacy=insufficient_retrieval_adequacy("resolved_policy_clause_not_found"),
        ),
    )


def _build_unsupported_by_evidence_response(
    context: RagOutcomeContext,
    *,
    evidence: EvidenceBundle,
    no_answer_reason: str,
    retrieval_adequacy_reason: str,
) -> AgentResponse:
    answer_text, prompt_trace, prompt_runtime_state, prompt_runtime_detail = (
        _compose_no_answer_response(
            request=context.request,
            resolved_scope=context.resolved_scope,
            evidence=evidence,
            no_answer_reason=no_answer_reason,
            fallback_answer=_build_no_answer_response(
                evidence,
                resolved_policy_title=_resolved_policy_title(context.handbook_plan),
            ),
            prompt_executor=context.prompt_executor,
            intent_frame=context.intent_frame,
        )
    )
    return AgentResponse(
        target="rag-agent",
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
                no_answer_reason=no_answer_reason,
                semantic_outcome="unsupported_by_evidence",
                retrieval_adequacy=insufficient_retrieval_adequacy(retrieval_adequacy_reason),
                prompt_runtime_state=prompt_runtime_state,
                prompt_runtime_detail=prompt_runtime_detail,
            ),
            prompt_trace,
        ),
    )
