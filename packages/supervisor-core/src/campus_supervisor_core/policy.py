from __future__ import annotations

from campus_contracts import ErrorInfo, SpecialistResponse, SupervisorResponse

from campus_supervisor_core.routing import RoutingDecision


def finalize_routing_decision(decision: RoutingDecision) -> SupervisorResponse | None:
    if decision.target is not None:
        return None
    if decision.intent_frame.suggested_next_action == "clarify":
        return SupervisorResponse(
            selected_target=None,
            status="needs_clarification",
            follow_up_question=_clarification_question(decision),
            confidence="low",
        )
    if decision.intent_frame.suggested_next_action == "approval_required":
        return SupervisorResponse(
            selected_target=None,
            status="approval_required",
            answer_text="该请求涉及需要人工确认的操作，必须先经过审批。",
            confidence="low",
        )
    return SupervisorResponse(
        selected_target=None,
        status="rejected",
        confidence="low",
        error=ErrorInfo(code="request_rejected", message="request was rejected by supervisor policy"),
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
        )
    raise ValueError(f"unsupported delegate status: {response.status}")


def _clarification_question(decision: RoutingDecision) -> str:
    if "requested_scope" in decision.intent_frame.missing_slots:
        return "请先说明你想查询的知识范围或资料集合。"
    if "availability_target_id" in decision.intent_frame.missing_slots:
        return "请先说明你想检查的站点或服务目标。"
    return "请补充完成当前请求所需的关键信息。"
