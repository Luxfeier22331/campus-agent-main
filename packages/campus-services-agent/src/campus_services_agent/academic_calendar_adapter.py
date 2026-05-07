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
    answer_focus = _effective_answer_focus(result)
    if answer_focus == "holiday_duration":
        return _holiday_duration_text(result)
    if answer_focus == "campus_break_window":
        return _campus_break_window_text(result)
    if answer_focus == "day_status":
        return _day_status_text(result)
    parts: list[str] = []
    if result.event_name and result.display_start_date and result.display_end_date:
        parts.append(f"{result.event_name}：{result.display_start_date}至{result.display_end_date}")
    elif result.event_name and result.display_start_date:
        parts.append(f"{result.event_name}：{result.display_start_date}")
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


def _holiday_duration_text(result: AcademicCalendarLookupResult) -> str:
    start_date = _display_date(result.display_start_date)
    end_date = _display_date(result.display_end_date)
    parts: list[str] = []
    if start_date and end_date and result.duration_days:
        parts.append(
            f"{_event_label(result)}是{start_date}到 {end_date}，共 {result.duration_days} 天"
        )
    elif start_date and end_date:
        parts.append(f"{_event_label(result)}是{start_date}到 {end_date}")
    else:
        parts.append(f"{_event_label(result)}安排已在校历中确认")
    related = _first_related_context(result, "overlapping_campus_course_adjustment")
    if related is not None:
        related_text = _campus_break_window_clause(related)
        if related_text:
            parts.append(related_text)
    return "；".join(parts) + "。"


def _effective_answer_focus(result: AcademicCalendarLookupResult) -> str:
    if result.answer_focus:
        return result.answer_focus
    if result.query_kind == "day_status":
        return "day_status"
    if result.event_type == "course_suspension" and "春假" in result.event_aliases:
        return "campus_break_window"
    if result.holiday_name and result.duration_days:
        return "holiday_duration"
    return ""


def _campus_break_window_text(result: AcademicCalendarLookupResult) -> str:
    parts = [_campus_break_window_clause(result)]
    related = _first_related_context(result, "overlapping_holiday_window")
    if related is not None:
        holiday_text = _related_holiday_clause(related)
        if holiday_text:
            parts.append(holiday_text)
    return "；".join(part for part in parts if part) + "。"


def _day_status_text(result: AcademicCalendarLookupResult) -> str:
    target_date = _display_date(result.resolved_date or result.requested_date)
    parts: list[str] = []
    if target_date and result.day_kind == "holiday":
        if result.event_name:
            parts.append(f"{target_date}不上课，属于{result.event_name}")
        else:
            parts.append(f"{target_date}不上课")
    elif target_date and result.day_kind == "normal_rest_day":
        parts.append(f"{target_date}不上课，当天按休息日安排")
    elif target_date and result.day_kind == "course_suspension":
        if result.event_name:
            parts.append(f"{target_date}不上课，属于{result.event_name}")
        else:
            parts.append(f"{target_date}不上课")
    elif target_date and result.is_makeup_class:
        if result.class_day_pattern:
            parts.append(f"{target_date}需要上课，执行{result.class_day_pattern}")
        else:
            parts.append(f"{target_date}需要上课")
    elif target_date and result.class_day_pattern:
        parts.append(f"{target_date}执行{result.class_day_pattern}")
    elif target_date:
        parts.append(f"{target_date}按正常教学安排执行")
    else:
        parts.append(result.query_text)
    return "；".join(parts) + "。"


def _campus_break_window_clause(result: AcademicCalendarLookupResult) -> str:
    start_date = _display_date(result.display_start_date)
    end_date = _display_date(result.display_end_date)
    range_text = f"{start_date}到 {end_date}" if start_date and end_date else ""
    parts: list[str] = []
    if range_text:
        parts.append(f"如果你说的“春假”是指这段校内连续不上课时间，对应的是{range_text}")
    else:
        parts.append("这段校内连续不上课时间已在校历安排中确认")
    if {"undergraduate", "preparatory", "graduate"}.intersection(result.applies_to):
        parts.append("本（预）科生、研究生课程停课")
    return "；".join(parts)


def _related_holiday_clause(result: AcademicCalendarLookupResult) -> str:
    start_date = _display_date(result.display_start_date)
    end_date = _display_date(result.display_end_date)
    if start_date and end_date and result.event_name and result.duration_days:
        return f"其中 {result.event_name}是{start_date}到 {end_date}，共 {result.duration_days} 天"
    if start_date and end_date and result.event_name:
        return f"其中 {result.event_name}是{start_date}到 {end_date}"
    return ""


def _event_label(result: AcademicCalendarLookupResult) -> str:
    return result.holiday_name or result.event_name or "相关校历安排"


def _first_related_context(result: AcademicCalendarLookupResult, relation: str):
    for context in result.related_calendar_contexts:
        if context.relation == relation:
            return context
    return None


def _display_date(value: str) -> str:
    parts = value.strip().split("-")
    if len(parts) != 3:
        return value.strip()
    month = parts[1].lstrip("0") or parts[1]
    day = parts[2].lstrip("0") or parts[2]
    return f"{month} 月 {day} 日"


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
