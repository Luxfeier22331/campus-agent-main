from __future__ import annotations

from campus_contracts import (
    AgentObservability,
    AgentRequest,
    AgentResponse,
    CampusNoticeGetPayload,
    ErrorInfo,
)

from campus_notice_agent.query_service import (
    NoticeAccessContext,
    NoticeGetQuery,
    NoticeQueryService,
)


def run_notice_get_internal_request(
    request: AgentRequest,
    *,
    query_service: NoticeQueryService | None = None,
) -> AgentResponse:
    if request.target != "notice-agent":
        return AgentResponse(
            target="notice-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="invalid_agent_target",
                message="notice-agent requires target='notice-agent'",
            ),
            agent_observability=AgentObservability(
                tool_attempted=False,
                failure_class="invalid_agent_target",
                access_decision="not_evaluated",
            ),
        )
    if query_service is None:
        return AgentResponse(
            target="notice-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="internal_query_service_unavailable",
                message="notice-agent requires an internal query service",
            ),
            agent_observability=AgentObservability(
                tool_attempted=False,
                failure_class="query_service_unavailable",
                access_decision="not_evaluated",
            ),
        )
    if not isinstance(request.payload, CampusNoticeGetPayload):
        return AgentResponse(
            target="notice-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="invalid_payload",
                message="notice-agent internal resolve requires notice get payload",
            ),
            agent_observability=AgentObservability(
                tool_attempted=False,
                failure_class="invalid_payload",
                access_decision="not_evaluated",
            ),
        )
    if request.allowed_tools:
        return _tool_not_allowed("campus_notice_get")
    try:
        result = query_service.get_notice(
            NoticeGetQuery(
                payload=request.payload,
                access_context=NoticeAccessContext(
                    actor=request.actor,
                    authorization=request.context.authorization,
                ),
            )
        )
    except Exception as exc:
        return _query_service_failed("", str(exc))
    return _get_response(result)


def _get_response(result) -> AgentResponse:
    if result.outcome in {"resolved_current", "resolved_historical_reference"}:
        confidence = "high" if result.outcome == "resolved_current" else "medium"
        return AgentResponse(
            target="notice-agent",
            status="completed",
            answer_text=_notice_card_answer_text(result),
            confidence=confidence,
            result=result,
            agent_observability=_agent_observability("", result),
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要读取的通知。"
        return AgentResponse(
            target="notice-agent",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
            agent_observability=_agent_observability("", result),
        )
    if result.outcome == "temporarily_unverifiable":
        return AgentResponse(
            target="notice-agent",
            status="no_answer",
            answer_text="当前还不能稳定读取这条通知。",
            confidence="low",
            result=result,
            agent_observability=_agent_observability("", result),
        )
    return AgentResponse(
        target="notice-agent",
        status="no_answer",
        answer_text="当前没有找到对应通知。",
        confidence="low",
        result=result,
        agent_observability=_agent_observability("", result),
    )


def _notice_card_answer_text(result) -> str:
    parts = [result.title.strip()]
    summary = result.bounded_summary.strip() or result.body_excerpt.strip()
    if summary:
        parts.append(f"摘要：{summary}")
    source_url = (result.source_url or result.canonical_url).strip()
    if source_url:
        parts.append(f"原文链接：{source_url}")
    return "\n\n".join(part for part in parts if part)


def _agent_observability(tool_name: str, result) -> AgentObservability:
    outcome = str(getattr(result, "outcome", "") or "")
    failure_class = _failure_class_for_outcome(outcome)
    source_ref_count = _source_ref_count(result)
    return AgentObservability(
        selected_tool=tool_name,
        tool_attempted=True,
        tool_outcome=outcome,
        failure_class=failure_class,
        fail_close_reason=str(getattr(result, "fail_close_reason", "") or ""),
        result_outcome=outcome,
        source_ref_count=source_ref_count,
        access_decision="allowed",
        safe_details=_agent_safe_details(
            tool_name=tool_name,
            result_type=result.__class__.__name__,
            outcome=outcome,
            source_ref_count=source_ref_count,
            access_decision="allowed",
            failure_class=failure_class,
        ),
    )


def _agent_safe_details(
    *,
    tool_name: str,
    result_type: str,
    outcome: str,
    source_ref_count: int,
    access_decision: str,
    failure_class: str,
) -> dict[str, object]:
    result_guardrail: dict[str, object] = {
        "schema_version": "agent-result-guardrail-v1",
        "outcome": _result_guardrail_outcome(outcome, source_ref_count),
        "source_ref_count": source_ref_count,
        "access_decision": access_decision,
    }
    if failure_class:
        result_guardrail["failure_class"] = failure_class
    return {
        "result_type": result_type,
        "agent_execution_projection": {
            "schema_version": "agent-execution-projection-v1",
            "projection_owner": "notice-agent",
            "selected_tool": tool_name,
            "payload_kind": tool_name,
            "tool_selection_reason": "typed_payload_allowed_tool",
        },
        "result_guardrail": result_guardrail,
    }


def _result_guardrail_outcome(outcome: str, source_ref_count: int) -> str:
    if outcome in {"resolved_current", "resolved_historical_reference"}:
        return "source_backed" if source_ref_count > 0 else "source_gap"
    if outcome == "clarification_required":
        return "clarification"
    if outcome == "temporarily_unverifiable":
        return "fail_close"
    if outcome == "not_found":
        return "not_found"
    return "unclassified"


def _failure_class_for_outcome(outcome: str) -> str:
    if outcome == "temporarily_unverifiable":
        return "fail_close"
    if outcome == "clarification_required":
        return "clarification"
    return ""


def _source_ref_count(result) -> int:
    refs = set()
    for key in ("source_url", "canonical_url"):
        value = str(getattr(result, key, "") or "").strip()
        if value:
            refs.add(value)
    return len(refs)


def _tool_not_allowed(tool_name: str) -> AgentResponse:
    return AgentResponse(
        target="notice-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="disallowed_tool",
            message=f"notice-agent cannot execute tool: {tool_name}",
        ),
        agent_observability=AgentObservability(
            selected_tool=tool_name,
            tool_attempted=False,
            tool_outcome="disallowed_tool",
            failure_class="tool_policy",
            result_outcome="disallowed_tool",
            source_ref_count=0,
            access_decision="not_evaluated",
            safe_details=_agent_safe_details(
                tool_name=tool_name,
                result_type="ErrorInfo",
                outcome="disallowed_tool",
                source_ref_count=0,
                access_decision="not_evaluated",
                failure_class="tool_policy",
            ),
        ),
    )


def _query_service_failed(tool_name: str, message: str) -> AgentResponse:
    return AgentResponse(
        target="notice-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="internal_query_service_failed",
            message=message or "internal query service failed",
        ),
        agent_observability=AgentObservability(
            selected_tool=tool_name,
            tool_attempted=True,
            tool_outcome="internal_query_service_failed",
            failure_class="query_service_failed",
            result_outcome="internal_query_service_failed",
            source_ref_count=0,
            access_decision="allowed",
            safe_details=_agent_safe_details(
                tool_name=tool_name,
                result_type="ErrorInfo",
                outcome="internal_query_service_failed",
                source_ref_count=0,
                access_decision="allowed",
                failure_class="query_service_failed",
            ),
        ),
    )


__all__ = ["run_notice_get_internal_request"]
