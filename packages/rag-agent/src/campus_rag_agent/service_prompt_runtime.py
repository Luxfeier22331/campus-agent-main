from __future__ import annotations

from dataclasses import replace

from campus_contracts import (
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
    fallback_question: str,
    prompt_executor: RagPromptExecutor | None,
    intent_frame: RagIntentFrame,
) -> tuple[str, object | None, str, str]:
    if prompt_executor is None or intent_frame.response_mode != "clarify":
        return fallback_question, None, "", ""
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
        return fallback_question, None, prompt_runtime_state, prompt_runtime_detail
    return execution.output.follow_up_question, execution.prompt_trace, "", ""


def _compose_no_answer_response(
    *,
    request: AgentRequest,
    resolved_scope: KnowledgeScope,
    evidence: EvidenceBundle,
    no_answer_reason: str,
    fallback_answer: str,
    prompt_executor: RagPromptExecutor | None,
    intent_frame: RagIntentFrame,
) -> tuple[str, object | None, str, str]:
    if prompt_executor is None:
        return fallback_answer, None, "", ""
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
        return fallback_answer, None, prompt_runtime_state, prompt_runtime_detail
    return execution.output.answer_text, execution.prompt_trace, "", ""


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
