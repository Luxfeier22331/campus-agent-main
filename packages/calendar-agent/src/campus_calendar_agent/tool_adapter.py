from __future__ import annotations

from dataclasses import asdict

from campus_contracts import (
    AcademicCalendarLookupPayload,
    AcademicCalendarLookupResult,
    AgentObservability,
    AgentRequest,
    AgentResponse,
    ErrorInfo,
)

from campus_calendar_agent.query_service import (
    AcademicCalendarQuery,
    CalendarAccessContext,
    CalendarQueryService,
)


def dispatch_tool_request(
    request: AgentRequest,
    *,
    query_service: CalendarQueryService,
) -> AgentResponse:
    if isinstance(request.payload, AcademicCalendarLookupPayload):
        return _handle_academic_calendar_lookup(request, query_service=query_service)
    return AgentResponse(
        target="calendar-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="invalid_payload",
            message="calendar-agent requires academic calendar lookup payload",
        ),
        agent_observability=AgentObservability(
            tool_attempted=False,
            failure_class="invalid_payload",
            access_decision="not_evaluated",
        ),
    )


def _handle_academic_calendar_lookup(
    request: AgentRequest,
    *,
    query_service: CalendarQueryService,
) -> AgentResponse:
    tool_name = "academic_calendar_lookup"
    if tool_name not in request.allowed_tools:
        return _tool_not_allowed(tool_name)
    try:
        result = query_service.lookup_academic_calendar(
            AcademicCalendarQuery(
                payload=request.payload,
                access_context=_access_context_from_request(request),
            )
        )
    except Exception as exc:
        return _query_service_failed(tool_name, str(exc))
    return _academic_calendar_response(result)


def _academic_calendar_response(result: AcademicCalendarLookupResult) -> AgentResponse:
    if result.outcome == "resolved_current":
        return AgentResponse(
            target="calendar-agent",
            status="completed",
            answer_text=_academic_calendar_answer_text(result),
            confidence="high",
            result=result,
            agent_observability=_agent_observability("academic_calendar_lookup", result),
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要查询的日期、假期名称或学年。"
        return AgentResponse(
            target="calendar-agent",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
            agent_observability=_agent_observability("academic_calendar_lookup", result),
        )
    if result.outcome == "temporarily_unverifiable":
        return AgentResponse(
            target="calendar-agent",
            status="no_answer",
            answer_text="当前还不能稳定确认这项校历安排。",
            confidence="low",
            result=result,
            agent_observability=_agent_observability("academic_calendar_lookup", result),
        )
    return AgentResponse(
        target="calendar-agent",
        status="no_answer",
        answer_text="当前没有找到对应的校历安排。",
        confidence="low",
        result=result,
        agent_observability=_agent_observability("academic_calendar_lookup", result),
    )


def _academic_calendar_answer_text(result: AcademicCalendarLookupResult) -> str:
    parts: list[str] = []
    if result.resolved_date and result.week_index is not None:
        parts.append(f"{result.resolved_date}是第{result.week_index}教学周")
    elif result.week_index is not None:
        parts.append(f"当前是第{result.week_index}教学周")
    elif result.resolved_date:
        parts.append(result.resolved_date)
    if result.holiday_name:
        parts.append(f"假期：{result.holiday_name}")
    if result.class_day_pattern:
        parts.append(f"执行课表：{result.class_day_pattern}")
    if result.is_makeup_class is True:
        parts.append("当天属于补课安排")
    if result.term_label:
        parts.append(result.term_label)
    if result.academic_year_label:
        parts.append(result.academic_year_label)
    if not parts:
        parts.append(result.query_text)
    return "；".join(parts) + "。"


def _access_context_from_request(request: AgentRequest) -> CalendarAccessContext:
    return CalendarAccessContext(
        actor=request.actor,
        authorization=request.context.authorization,
    )


def _agent_observability(
    tool_name: str, result: AcademicCalendarLookupResult
) -> AgentObservability:
    outcome = str(getattr(result, "outcome", "") or "")
    source_ref_count = _source_ref_count(result)
    failure_class = _failure_class_for_outcome(outcome)
    return AgentObservability(
        selected_tool=tool_name,
        tool_attempted=True,
        tool_outcome=outcome,
        failure_class=failure_class,
        fail_close_reason=str(getattr(result, "fail_close_reason", "") or ""),
        result_outcome=outcome,
        source_ref_count=source_ref_count,
        access_decision="allowed",
        safe_details={
            "result_type": result.__class__.__name__,
            "agent_execution_projection": {
                "schema_version": "agent-execution-projection-v1",
                "projection_owner": "calendar-agent",
                "selected_tool": tool_name,
                "payload_kind": tool_name,
                "tool_selection_reason": "typed_payload_allowed_tool",
            },
            "result_guardrail": {
                "schema_version": "agent-result-guardrail-v1",
                "outcome": _result_guardrail_outcome(outcome, source_ref_count),
                "source_ref_count": source_ref_count,
                "access_decision": "allowed",
                **({"failure_class": failure_class} if failure_class else {}),
            },
        },
    )


def _source_ref_count(result: AcademicCalendarLookupResult) -> int:
    refs: set[str] = set()

    def collect(value: object) -> None:
        if isinstance(value, str):
            return
        if isinstance(value, dict):
            for key, item in value.items():
                normalized_key = str(key)
                if normalized_key.endswith("source_refs") and isinstance(item, (list, tuple)):
                    refs.update(str(ref).strip() for ref in item if str(ref).strip())
                    continue
                collect(item)
            return
        if isinstance(value, (list, tuple)):
            for item in value:
                collect(item)

    collect(asdict(result))
    return len(refs)


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
    if outcome == "not_found":
        return "not_found"
    return ""


def _tool_not_allowed(tool_name: str) -> AgentResponse:
    return _error_response(
        tool_name=tool_name,
        code="disallowed_tool",
        message=f"calendar-agent cannot execute tool: {tool_name}",
        tool_attempted=False,
        failure_class="tool_policy",
        access_decision="not_evaluated",
    )


def _query_service_failed(tool_name: str, message: str) -> AgentResponse:
    return _error_response(
        tool_name=tool_name,
        code="internal_query_service_failed",
        message=message or "internal query service failed",
        tool_attempted=True,
        failure_class="query_service_failed",
        access_decision="allowed",
    )


def _error_response(
    *,
    tool_name: str,
    code: str,
    message: str,
    tool_attempted: bool,
    failure_class: str,
    access_decision: str,
) -> AgentResponse:
    return AgentResponse(
        target="calendar-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(code=code, message=message),
        agent_observability=AgentObservability(
            selected_tool=tool_name,
            tool_attempted=tool_attempted,
            tool_outcome=code,
            failure_class=failure_class,
            result_outcome=code,
            source_ref_count=0,
            access_decision=access_decision,
            safe_details={
                "result_type": "ErrorInfo",
                "agent_execution_projection": {
                    "schema_version": "agent-execution-projection-v1",
                    "projection_owner": "calendar-agent",
                    "selected_tool": tool_name,
                    "payload_kind": tool_name,
                    "tool_selection_reason": "typed_payload_allowed_tool",
                },
                "result_guardrail": {
                    "schema_version": "agent-result-guardrail-v1",
                    "outcome": "unclassified",
                    "source_ref_count": 0,
                    "access_decision": access_decision,
                    "failure_class": failure_class,
                },
            },
        ),
    )
