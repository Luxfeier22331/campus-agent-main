from __future__ import annotations

from campus_contracts import SpecialistRequest, SpecialistResponse

from campus_rag_agent.intent import RagIntentFrame
from campus_rag_agent.prompt_execution import RagPromptExecutor
from campus_rag_agent.retrieval_adequacy import (
    ambiguous_retrieval_adequacy,
    insufficient_retrieval_adequacy,
)

from .service_common import _build_empty_evidence
from .service_diagnostics import (
    _build_rag_result_payload,
    _clarification_retrieval_adequacy,
)
from .service_prompting import (
    _build_clarification_question,
    _compose_clarification_response,
    _compose_no_answer_response,
    _with_prompt_trace,
)
from .service_response_text import _build_curriculum_unsupported_response
from .service_scope import _has_resolved_query_plan


def _maybe_return_pre_retrieval_response(
    *,
    request: SpecialistRequest,
    effective_scope,
    user_goal: str,
    personalization_hint,
    intent_frame: RagIntentFrame,
    prompt_executor: RagPromptExecutor | None,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
) -> SpecialistResponse | None:
    if intent_frame.response_mode == "clarify" and not _has_resolved_query_plan(
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
    ):
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        (
            follow_up_question,
            prompt_trace,
            prompt_runtime_state,
            prompt_runtime_detail,
        ) = _compose_clarification_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=empty_evidence,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return SpecialistResponse(
            target="rag-agent",
            status="needs_clarification",
            confidence="low",
            follow_up_question=follow_up_question,
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=empty_evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                    retrieval_adequacy=_clarification_retrieval_adequacy(
                        resolved_scope=effective_scope,
                        handbook_plan=handbook_plan,
                        curriculum_plan=curriculum_plan,
                        curriculum_program_family_plan=curriculum_program_family_plan,
                        intent_frame=intent_frame,
                    ),
                    prompt_runtime_state=prompt_runtime_state,
                    prompt_runtime_detail=prompt_runtime_detail,
                ),
                prompt_trace,
            ),
        )
    if handbook_plan is not None and handbook_plan.status == "needs_clarification":
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        (
            follow_up_question,
            prompt_trace,
            prompt_runtime_state,
            prompt_runtime_detail,
        ) = _compose_clarification_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=empty_evidence,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
                clarification_reason=handbook_plan.clarification_reason,
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return SpecialistResponse(
            target="rag-agent",
            status="needs_clarification",
            confidence="low",
            follow_up_question=follow_up_question,
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=empty_evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                    retrieval_adequacy=ambiguous_retrieval_adequacy(
                        handbook_plan.clarification_reason
                    ),
                    prompt_runtime_state=prompt_runtime_state,
                    prompt_runtime_detail=prompt_runtime_detail,
                ),
                prompt_trace,
            ),
        )
    if (
        curriculum_program_family_plan is not None
        and curriculum_program_family_plan.resolution_mode == "needs_clarification"
    ):
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        (
            follow_up_question,
            prompt_trace,
            prompt_runtime_state,
            prompt_runtime_detail,
        ) = _compose_clarification_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=empty_evidence,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
                clarification_reason=curriculum_program_family_plan.clarification_reason,
                clarification_candidates=curriculum_program_family_plan.clarification_candidates,
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return SpecialistResponse(
            target="rag-agent",
            status="needs_clarification",
            confidence="low",
            follow_up_question=follow_up_question,
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=empty_evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                    retrieval_adequacy=ambiguous_retrieval_adequacy(
                        curriculum_program_family_plan.clarification_reason
                    ),
                    prompt_runtime_state=prompt_runtime_state,
                    prompt_runtime_detail=prompt_runtime_detail,
                ),
                prompt_trace,
            ),
        )
    if (
        curriculum_program_family_plan is None
        and curriculum_plan is not None
        and curriculum_plan.status == "needs_clarification"
    ):
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        (
            follow_up_question,
            prompt_trace,
            prompt_runtime_state,
            prompt_runtime_detail,
        ) = _compose_clarification_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=empty_evidence,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
                clarification_reason=curriculum_plan.clarification_reason,
                clarification_candidates=curriculum_plan.clarification_candidates,
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return SpecialistResponse(
            target="rag-agent",
            status="needs_clarification",
            confidence="low",
            follow_up_question=follow_up_question,
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=empty_evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                    retrieval_adequacy=ambiguous_retrieval_adequacy(
                        curriculum_plan.clarification_reason
                    ),
                    prompt_runtime_state=prompt_runtime_state,
                    prompt_runtime_detail=prompt_runtime_detail,
                ),
                prompt_trace,
            ),
        )
    if curriculum_plan is not None and curriculum_plan.status == "unsupported":
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        (
            answer_text,
            prompt_trace,
            prompt_runtime_state,
            prompt_runtime_detail,
        ) = _compose_no_answer_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=empty_evidence,
            no_answer_reason=curriculum_plan.unsupported_reason,
            fallback_answer=_build_curriculum_unsupported_response(curriculum_plan),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return SpecialistResponse(
            target="rag-agent",
            status="no_answer",
            answer_text=answer_text,
            confidence="low",
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=empty_evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                    no_answer_reason=curriculum_plan.unsupported_reason,
                    semantic_outcome="unsupported_scope",
                    retrieval_adequacy=insufficient_retrieval_adequacy("unsupported_query_type"),
                    prompt_runtime_state=prompt_runtime_state,
                    prompt_runtime_detail=prompt_runtime_detail,
                ),
                prompt_trace,
            ),
        )
    return None
