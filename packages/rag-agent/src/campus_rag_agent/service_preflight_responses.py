from __future__ import annotations

from campus_contracts import AgentRequest, AgentResponse

from campus_rag_agent.intent import RagIntentFrame
from campus_rag_agent.prompt_execution import RagPromptExecutor

from .service_common import _build_empty_evidence
from .service_diagnostics_payload import _build_rag_result_payload
from .service_prompt_runtime import (
    _build_prompt_runtime_error_response,
    _compose_clarification_response,
    _compose_no_answer_response,
    _with_prompt_trace,
)


def build_pre_retrieval_clarification_response(
    *,
    request: AgentRequest,
    effective_scope,
    user_goal: str,
    prompt_executor: RagPromptExecutor | None,
    intent_frame: RagIntentFrame,
    deterministic_question: str,
    retrieval_adequacy,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
) -> AgentResponse:
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
        deterministic_question=deterministic_question,
        prompt_executor=prompt_executor,
        intent_frame=intent_frame,
    )
    if prompt_runtime_state:
        return _build_prompt_runtime_error_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=empty_evidence,
            prompt_runtime_state=prompt_runtime_state,
            prompt_runtime_detail=prompt_runtime_detail,
            build_rag_result_payload=_build_rag_result_payload,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
        )
    return AgentResponse(
        target="rag-agent",
        status="needs_clarification",
        confidence="low",
        answer_text=follow_up_question,
        follow_up_question=follow_up_question,
        result=_with_prompt_trace(
            _build_rag_result_payload(
                evidence=empty_evidence,
                resolved_scope=effective_scope,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
                request_id=request.request_id,
                retrieval_adequacy=retrieval_adequacy,
                prompt_runtime_state=prompt_runtime_state,
                prompt_runtime_detail=prompt_runtime_detail,
            ),
            prompt_trace,
        ),
    )


def build_pre_retrieval_no_answer_response(
    *,
    request: AgentRequest,
    effective_scope,
    user_goal: str,
    prompt_executor: RagPromptExecutor | None,
    intent_frame: RagIntentFrame,
    no_answer_reason: str,
    deterministic_answer_text: str,
    semantic_outcome: str,
    retrieval_adequacy,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
) -> AgentResponse:
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
        no_answer_reason=no_answer_reason,
        deterministic_answer_text=deterministic_answer_text,
        prompt_executor=prompt_executor,
        intent_frame=intent_frame,
    )
    if prompt_runtime_state:
        return _build_prompt_runtime_error_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=empty_evidence,
            prompt_runtime_state=prompt_runtime_state,
            prompt_runtime_detail=prompt_runtime_detail,
            build_rag_result_payload=_build_rag_result_payload,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
        )
    return AgentResponse(
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
                request_id=request.request_id,
                no_answer_reason=no_answer_reason,
                semantic_outcome=semantic_outcome,
                retrieval_adequacy=retrieval_adequacy,
                prompt_runtime_state=prompt_runtime_state,
                prompt_runtime_detail=prompt_runtime_detail,
            ),
            prompt_trace,
        ),
    )
