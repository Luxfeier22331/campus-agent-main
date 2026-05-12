from __future__ import annotations

from dataclasses import replace

from campus_contracts import (
    AgentResponse,
    ErrorInfo,
    AgentRequest,
    EvidenceBundle,
    KnowledgeScope,
    RagResultDiagnostics,
    RagResultPayload,
)
from campus_shared import PromptRuntimeValidationError, classify_prompt_runtime_failure

from campus_rag_agent.intent import RagIntentFrame
from campus_rag_agent.prompt_execution import RagPromptExecutor
from campus_rag_agent.prompt_packets import (
    build_rag_clarify_prompt_packet,
    build_rag_no_answer_prompt_packet,
)


def _compose_clarification_response(
    *,
    request: AgentRequest,
    resolved_scope: KnowledgeScope,
    evidence: EvidenceBundle,
    deterministic_question: str,
    prompt_executor: RagPromptExecutor | None,
    intent_frame: RagIntentFrame,
) -> tuple[str, object | None, str, str]:
    if prompt_executor is None or intent_frame.response_mode != "clarify":
        return deterministic_question, None, "", ""
    try:
        execution = prompt_executor.compose_clarify(
            build_rag_clarify_prompt_packet(
                request,
                intent_frame=intent_frame,
                resolved_scope=resolved_scope,
            )
        )
    except PromptRuntimeValidationError as exc:
        prompt_runtime_state, prompt_runtime_detail = classify_prompt_runtime_failure(exc)
        return deterministic_question, None, prompt_runtime_state, prompt_runtime_detail
    return execution.output.follow_up_question, execution.prompt_trace, "", ""


def _compose_no_answer_response(
    *,
    request: AgentRequest,
    resolved_scope: KnowledgeScope,
    evidence: EvidenceBundle,
    no_answer_reason: str,
    deterministic_answer_text: str,
    prompt_executor: RagPromptExecutor | None,
    intent_frame: RagIntentFrame,
) -> tuple[str, object | None, str, str]:
    if prompt_executor is None:
        return deterministic_answer_text, None, "", ""
    try:
        execution = prompt_executor.compose_no_answer(
            build_rag_no_answer_prompt_packet(
                request,
                resolved_scope=resolved_scope,
                evidence=evidence,
                no_answer_reason=no_answer_reason,
                intent_frame=intent_frame,
            )
        )
    except PromptRuntimeValidationError as exc:
        prompt_runtime_state, prompt_runtime_detail = classify_prompt_runtime_failure(exc)
        return deterministic_answer_text, None, prompt_runtime_state, prompt_runtime_detail
    return execution.output.answer_text, execution.prompt_trace, "", ""


def _build_prompt_runtime_error_response(
    *,
    request: AgentRequest,
    resolved_scope: KnowledgeScope,
    evidence: EvidenceBundle,
    prompt_runtime_state: str,
    prompt_runtime_detail: str,
    build_rag_result_payload,
    handbook_plan=None,
    curriculum_plan=None,
    curriculum_course_plan=None,
    curriculum_program_family_plan=None,
    retrieved_evidence: EvidenceBundle | None = None,
    retrieval_execution_result=None,
    planner_information_needs=(),
    projection_context_summaries=(),
) -> AgentResponse:
    error_code = prompt_runtime_state or "prompt_runtime_failed"
    error_message = prompt_runtime_detail or error_code
    return AgentResponse(
        target="rag-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code=error_code,
            message=error_message,
            retryable=error_code
            in {
                "provider_request_failed",
                "provider_incomplete",
                "provider_runtime_state",
            },
        ),
        result=build_rag_result_payload(
            evidence=evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            resolved_scope=resolved_scope,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            request_id=request.request_id,
            fail_close_reason=error_code,
            semantic_outcome="prompt_runtime_failed",
            grounding_verdict="unsupported",
            grounding_downgraded=True,
            prompt_runtime_state=error_code,
            prompt_runtime_detail=prompt_runtime_detail,
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        ),
    )


def _with_prompt_trace(
    payload: RagResultPayload,
    prompt_trace: object | None,
) -> RagResultPayload:
    if prompt_trace is None:
        return payload
    diagnostics = payload.diagnostics
    if diagnostics is None:
        diagnostics = RagResultDiagnostics(prompt_trace=prompt_trace)
    else:
        diagnostics = replace(diagnostics, prompt_trace=prompt_trace)
    return RagResultPayload(
        evidence=payload.evidence,
        diagnostics=diagnostics,
    )
