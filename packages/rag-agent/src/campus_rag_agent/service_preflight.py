from __future__ import annotations

from campus_contracts import AgentRequest, AgentResponse

from campus_rag_agent.intent import RagIntentFrame
from campus_rag_agent.prompt_execution import RagPromptExecutor
from campus_rag_agent.retrieval_adequacy import (
    ambiguous_retrieval_adequacy,
    insufficient_retrieval_adequacy,
)

from .service_clarification import (
    _build_clarification_question,
)
from .service_common import _build_empty_evidence
from .service_diagnostics_adequacy import _clarification_retrieval_adequacy
from .service_preflight_responses import (
    build_pre_retrieval_clarification_response,
    build_pre_retrieval_no_answer_response,
)
from .service_response_text import _build_curriculum_unsupported_response
from .service_scope_plans import _has_resolved_query_plan


def _maybe_return_pre_retrieval_response(
    *,
    request: AgentRequest,
    effective_scope,
    user_goal: str,
    personalization_hint,
    intent_frame: RagIntentFrame,
    prompt_executor: RagPromptExecutor | None,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
) -> AgentResponse | None:
    if intent_frame.response_mode == "clarify" and not _has_resolved_query_plan(
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
    ):
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        clarification_reason, clarification_candidates = _pre_retrieval_clarification_context(
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
        )
        confirmed_slot_terms = _pre_retrieval_confirmed_slot_terms(
            request=request,
            confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
            clarification_reason=clarification_reason,
            user_goal=user_goal,
        )
        return build_pre_retrieval_clarification_response(
            request=request,
            effective_scope=effective_scope,
            user_goal=user_goal,
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=confirmed_slot_terms,
                clarification_reason=clarification_reason,
                clarification_candidates=clarification_candidates,
            ),
            retrieval_adequacy=_clarification_retrieval_adequacy(
                resolved_scope=effective_scope,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
                intent_frame=intent_frame,
            ),
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
        )
    if handbook_plan is not None and handbook_plan.status == "needs_clarification":
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        return build_pre_retrieval_clarification_response(
            request=request,
            effective_scope=effective_scope,
            user_goal=user_goal,
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
                clarification_reason=handbook_plan.clarification_reason,
            ),
            retrieval_adequacy=ambiguous_retrieval_adequacy(handbook_plan.clarification_reason),
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
        )
    if (
        curriculum_program_family_plan is not None
        and curriculum_program_family_plan.resolution_mode == "needs_clarification"
    ):
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        return build_pre_retrieval_clarification_response(
            request=request,
            effective_scope=effective_scope,
            user_goal=user_goal,
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
                clarification_reason=curriculum_program_family_plan.clarification_reason,
                clarification_candidates=curriculum_program_family_plan.clarification_candidates,
            ),
            retrieval_adequacy=ambiguous_retrieval_adequacy(
                curriculum_program_family_plan.clarification_reason
            ),
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
        )
    if (
        curriculum_program_family_plan is None
        and curriculum_plan is not None
        and curriculum_plan.status == "needs_clarification"
    ):
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        return build_pre_retrieval_clarification_response(
            request=request,
            effective_scope=effective_scope,
            user_goal=user_goal,
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
                clarification_reason=curriculum_plan.clarification_reason,
                clarification_candidates=curriculum_plan.clarification_candidates,
            ),
            retrieval_adequacy=ambiguous_retrieval_adequacy(curriculum_plan.clarification_reason),
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
        )
    if curriculum_plan is not None and curriculum_plan.status == "unsupported":
        return build_pre_retrieval_no_answer_response(
            request=request,
            effective_scope=effective_scope,
            user_goal=user_goal,
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
            no_answer_reason=curriculum_plan.unsupported_reason,
            fallback_answer=_build_curriculum_unsupported_response(curriculum_plan),
            semantic_outcome="unsupported_scope",
            retrieval_adequacy=insufficient_retrieval_adequacy("unsupported_query_type"),
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
        )
    return None


def _pre_retrieval_clarification_context(
    *,
    handbook_plan,
    curriculum_plan,
    curriculum_program_family_plan,
) -> tuple[str, tuple[str, ...]]:
    if handbook_plan is not None and handbook_plan.status == "needs_clarification":
        return handbook_plan.clarification_reason, ()
    if (
        curriculum_program_family_plan is not None
        and curriculum_program_family_plan.resolution_mode == "needs_clarification"
    ):
        return (
            curriculum_program_family_plan.clarification_reason,
            curriculum_program_family_plan.clarification_candidates,
        )
    if curriculum_plan is not None and curriculum_plan.status == "needs_clarification":
        return curriculum_plan.clarification_reason, curriculum_plan.clarification_candidates
    return "", ()


def _pre_retrieval_confirmed_slot_terms(
    *,
    request: AgentRequest,
    confirmed_slot_terms: tuple[str, ...],
    clarification_reason: str,
    user_goal: str,
) -> tuple[str, ...]:
    if clarification_reason != "curriculum_program_family_alias":
        return confirmed_slot_terms
    if "我这个专业" not in user_goal and "本专业" not in user_goal:
        return confirmed_slot_terms
    major = request.context.actor.major.strip()
    if not major or major in confirmed_slot_terms:
        return confirmed_slot_terms
    return (*confirmed_slot_terms, major)
