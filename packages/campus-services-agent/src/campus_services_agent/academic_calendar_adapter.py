from __future__ import annotations

from campus_contracts import AcademicCalendarLookupResult, AgentObservability, AgentResponse

from campus_services_agent.tool_guardrails import (
    failure_class_for_outcome,
    result_guardrail_outcome,
)


def academic_calendar_response(result: AcademicCalendarLookupResult) -> AgentResponse:
    if result.outcome == "resolved_current":
        return AgentResponse(
            target="campus-services-agent",
            status="completed",
            answer_text=academic_calendar_answer_text(result),
            confidence="high",
            result=result,
            agent_observability=academic_calendar_observability(result),
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要查询的日期、假期名称或学年。"
        return AgentResponse(
            target="campus-services-agent",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
            agent_observability=academic_calendar_observability(result),
        )
    if result.outcome == "temporarily_unverifiable":
        return AgentResponse(
            target="campus-services-agent",
            status="no_answer",
            answer_text="当前还不能稳定确认这项校历安排。",
            confidence="low",
            result=result,
            agent_observability=academic_calendar_observability(result),
        )
    return AgentResponse(
        target="campus-services-agent",
        status="no_answer",
        answer_text="当前没有找到对应的校历安排。",
        confidence="low",
        result=result,
        agent_observability=academic_calendar_observability(result),
    )


def academic_calendar_answer_text(result: AcademicCalendarLookupResult) -> str:
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


def academic_calendar_observability(
    result: AcademicCalendarLookupResult,
) -> AgentObservability:
    outcome = result.outcome
    source_ref_count = len({ref.strip() for ref in result.source_refs if ref.strip()})
    failure_class = failure_class_for_outcome(outcome)
    return AgentObservability(
        selected_tool="academic_calendar_lookup",
        tool_attempted=True,
        tool_outcome=outcome,
        failure_class=failure_class,
        fail_close_reason=result.fail_close_reason,
        result_outcome=outcome,
        source_ref_count=source_ref_count,
        access_decision="allowed",
        safe_details={
            "result_type": result.__class__.__name__,
            "agent_execution_projection": {
                "schema_version": "agent-execution-projection-v1",
                "projection_owner": "campus-services-agent",
                "selected_tool": "academic_calendar_lookup",
                "payload_kind": "academic_calendar_lookup",
                "tool_selection_reason": "typed_payload_allowed_tool",
            },
            "result_guardrail": {
                "schema_version": "agent-result-guardrail-v1",
                "outcome": result_guardrail_outcome(outcome, source_ref_count),
                "source_ref_count": source_ref_count,
                "access_decision": "allowed",
                **({"failure_class": failure_class} if failure_class else {}),
            },
        },
    )
