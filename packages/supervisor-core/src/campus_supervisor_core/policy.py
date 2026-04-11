from __future__ import annotations

from campus_contracts import ErrorInfo, SpecialistResponse, SupervisorObservability, SupervisorResponse
from campus_shared import PromptRuntimeValidationError

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.prompt_execution import (
    SupervisorPromptExecutor,
    wrap_supervisor_prompt_executor,
)
from campus_supervisor_core.prompt_packets import (
    build_supervisor_approval_required_prompt_packet,
    build_supervisor_clarify_prompt_packet,
    build_supervisor_out_of_scope_prompt_packet,
    build_supervisor_reject_prompt_packet,
)
from campus_supervisor_core.routing import RoutingDecision
from campus_supervisor_core.response import build_supervisor_observability_from_specialist_response


def finalize_routing_decision(
    context: SupervisorRequestContext,
    decision: RoutingDecision,
    *,
    prompt_executor: SupervisorPromptExecutor | None = None,
) -> SupervisorResponse | None:
    prompt_executor = wrap_supervisor_prompt_executor(prompt_executor)
    if decision.target is not None:
        return None
    if decision.intent_frame.suggested_next_action == "clarify":
        follow_up_question = _clarification_question(decision)
        prompt_trace = None
        if prompt_executor is not None:
            try:
                execution = prompt_executor.compose_clarify(
                    build_supervisor_clarify_prompt_packet(context, decision)
                )
            except PromptRuntimeValidationError:
                execution = None
            if execution is not None:
                follow_up_question = execution.output.follow_up_question
                prompt_trace = execution.prompt_trace
        return SupervisorResponse(
            selected_target=None,
            status="needs_clarification",
            follow_up_question=follow_up_question,
            confidence="low",
            observability=(
                SupervisorObservability(
                    retrieval_attempted=False,
                    candidate_count=0,
                    retrieved_source_count=0,
                    citation_expected=False,
                    citation_count=0,
                    citation_missing=False,
                    refusal_class="needs_clarification",
                    semantic_outcome="needs_clarification",
                    acl_decision="allowed",
                    fail_closed=False,
                    prompt_trace=prompt_trace,
                )
                if prompt_trace is not None
                else None
            ),
        )
    if decision.intent_frame.suggested_next_action == "approval_required":
        answer_text = "该请求涉及需要人工确认的操作，必须先经过审批。"
        prompt_trace = None
        if prompt_executor is not None:
            try:
                execution = prompt_executor.compose_approval_required(
                    build_supervisor_approval_required_prompt_packet(context, decision)
                )
            except PromptRuntimeValidationError:
                execution = None
            if execution is not None:
                answer_text = execution.output.answer_text
                prompt_trace = execution.prompt_trace
        return SupervisorResponse(
            selected_target=None,
            status="approval_required",
            answer_text=answer_text,
            confidence="low",
            observability=SupervisorObservability(
                retrieval_attempted=False,
                candidate_count=0,
                retrieved_source_count=0,
                citation_expected=False,
                citation_count=0,
                citation_missing=False,
                refusal_class="approval_required",
                semantic_outcome="approval_required",
                policy_reason="approval_required",
                acl_decision="approval_required",
                fail_closed=True,
                prompt_trace=prompt_trace,
            ),
        )
    if decision.intent_frame.suggested_next_action == "out_of_scope":
        answer_text = "当前仅支持中央民族大学校园范围内且已开放能力面的问答，这个问题不在当前支持范围内。"
        prompt_trace = None
        if prompt_executor is not None:
            try:
                execution = prompt_executor.compose_out_of_scope(
                    build_supervisor_out_of_scope_prompt_packet(context, decision)
                )
            except PromptRuntimeValidationError:
                execution = None
            if execution is not None:
                answer_text = execution.output.answer_text
                prompt_trace = execution.prompt_trace
        return SupervisorResponse(
            selected_target=None,
            status="no_answer",
            answer_text=answer_text,
            confidence="low",
            observability=SupervisorObservability(
                retrieval_attempted=False,
                candidate_count=0,
                retrieved_source_count=0,
                citation_expected=False,
                citation_count=0,
                citation_missing=False,
                refusal_class="out_of_scope",
                semantic_outcome="out_of_scope",
                scope_class="out_of_scope",
                policy_reason=decision.intent_frame.policy_reason or "product_scope_boundary",
                acl_decision="allowed",
                fail_closed=True,
                prompt_trace=prompt_trace,
            ),
        )
    answer_text = "这个请求不在当前可执行范围内。"
    prompt_trace = None
    if prompt_executor is not None:
        try:
            execution = prompt_executor.compose_reject(
                build_supervisor_reject_prompt_packet(context, decision)
            )
        except PromptRuntimeValidationError:
            execution = None
        if execution is not None:
            answer_text = execution.output.answer_text
            prompt_trace = execution.prompt_trace
    return SupervisorResponse(
        selected_target=None,
        status="rejected",
        answer_text=answer_text,
        confidence="low",
        error=ErrorInfo(code="request_rejected", message="request was rejected by supervisor policy"),
        observability=SupervisorObservability(
            retrieval_attempted=False,
            candidate_count=0,
            retrieved_source_count=0,
            citation_expected=False,
            citation_count=0,
            citation_missing=False,
            refusal_class="rejected",
            semantic_outcome="policy_refusal",
            policy_reason=decision.intent_frame.policy_reason or "request_rejected",
            acl_decision="denied",
            fail_closed=True,
            prompt_trace=prompt_trace,
        ),
    )


def finalize_specialist_response(response: SpecialistResponse) -> SupervisorResponse:
    if response.status == "completed":
        return SupervisorResponse(
            selected_target=response.target,
            status="completed",
            answer_text=response.answer_text,
            follow_up_question=response.follow_up_question,
            confidence=response.confidence,
            result=response.result,
            error=response.error,
            observability=build_supervisor_observability_from_specialist_response(response),
        )
    if response.status == "needs_clarification":
        return SupervisorResponse(
            selected_target=response.target,
            status="needs_clarification",
            answer_text=response.answer_text,
            follow_up_question=response.follow_up_question,
            confidence=response.confidence,
            result=response.result,
            error=response.error,
            observability=build_supervisor_observability_from_specialist_response(response),
        )
    if response.status == "no_answer":
        return SupervisorResponse(
            selected_target=response.target,
            status="no_answer",
            answer_text=response.answer_text,
            follow_up_question=response.follow_up_question,
            confidence=response.confidence,
            result=response.result,
            error=response.error,
            observability=build_supervisor_observability_from_specialist_response(response),
        )
    if response.status == "error":
        return SupervisorResponse(
            selected_target=response.target,
            status="error",
            answer_text=response.answer_text,
            follow_up_question=response.follow_up_question,
            confidence=response.confidence,
            result=response.result,
            error=response.error,
            observability=build_supervisor_observability_from_specialist_response(response),
        )
    raise ValueError(f"unsupported delegate status: {response.status}")


def _clarification_question(decision: RoutingDecision) -> str:
    if "requested_scope" in decision.intent_frame.missing_slots:
        if decision.intent_frame.clarification_subject:
            return (
                f"按当前对话上下文理解，你现在想继续问{decision.intent_frame.clarification_subject}相关事项；"
                "请先说明你想查询的知识范围或资料集合。"
            )
        return "请先说明你想查询的知识范围或资料集合。"
    if "availability_target_id" in decision.intent_frame.missing_slots:
        return "请先说明你想检查的站点或服务目标。"
    return "请补充完成当前请求所需的关键信息。"
