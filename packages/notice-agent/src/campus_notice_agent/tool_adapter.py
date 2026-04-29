from __future__ import annotations

from dataclasses import asdict

from campus_contracts import (
    AgentObservability,
    AgentRequest,
    AgentResponse,
    CampusNoticeDiscoverPayload,
    CampusNoticeDiscoverResult,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
    ErrorInfo,
)

from campus_notice_agent.query_service import (
    NoticeAccessContext,
    NoticeDiscoverQuery,
    NoticeGetQuery,
    NoticeQueryService,
)


def dispatch_tool_request(
    request: AgentRequest,
    *,
    query_service: NoticeQueryService,
) -> AgentResponse:
    if isinstance(request.payload, CampusNoticeDiscoverPayload):
        return _handle_notice_discover(request, query_service=query_service)
    if isinstance(request.payload, CampusNoticeGetPayload):
        return _handle_notice_get(request, query_service=query_service)
    return AgentResponse(
        target="notice-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="invalid_payload",
            message="notice-agent requires notice discover or notice get payload",
        ),
        agent_observability=AgentObservability(
            tool_attempted=False,
            failure_class="invalid_payload",
            access_decision="not_evaluated",
        ),
    )


def _handle_notice_discover(
    request: AgentRequest,
    *,
    query_service: NoticeQueryService,
) -> AgentResponse:
    tool_name = "campus_notice_discover"
    if tool_name not in request.allowed_tools:
        return _tool_not_allowed(tool_name)
    try:
        result = query_service.discover_notice(
            NoticeDiscoverQuery(
                payload=request.payload,
                access_context=_access_context_from_request(request),
            )
        )
    except Exception as exc:
        return _query_service_failed(tool_name, str(exc))
    return _discover_response(result)


def _handle_notice_get(
    request: AgentRequest,
    *,
    query_service: NoticeQueryService,
) -> AgentResponse:
    tool_name = "campus_notice_get"
    if tool_name not in request.allowed_tools:
        return _tool_not_allowed(tool_name)
    try:
        result = query_service.get_notice(
            NoticeGetQuery(
                payload=request.payload,
                access_context=_access_context_from_request(request),
            )
        )
    except Exception as exc:
        return _query_service_failed(tool_name, str(exc))
    return _get_response(result)


def _discover_response(result: CampusNoticeDiscoverResult) -> AgentResponse:
    if result.outcome in {"resolved_current", "resolved_historical_reference"}:
        titles = "；".join(card.title for card in result.notice_cards)
        confidence = "high" if result.outcome == "resolved_current" else "medium"
        return AgentResponse(
            target="notice-agent",
            status="completed",
            answer_text=f"找到以下通知：{titles}。",
            confidence=confidence,
            result=result,
            agent_observability=_agent_observability("campus_notice_discover", result),
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要找的通知主题或年份。"
        return AgentResponse(
            target="notice-agent",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
            agent_observability=_agent_observability("campus_notice_discover", result),
        )
    if result.outcome == "temporarily_unverifiable":
        return AgentResponse(
            target="notice-agent",
            status="no_answer",
            answer_text="当前还不能稳定确认这类通知。",
            confidence="low",
            result=result,
            agent_observability=_agent_observability("campus_notice_discover", result),
        )
    return AgentResponse(
        target="notice-agent",
        status="no_answer",
        answer_text="当前没有找到对应通知。",
        confidence="low",
        result=result,
        agent_observability=_agent_observability("campus_notice_discover", result),
    )


def _get_response(result: CampusNoticeGetResult) -> AgentResponse:
    if result.outcome in {"resolved_current", "resolved_historical_reference"}:
        confidence = "high" if result.outcome == "resolved_current" else "medium"
        if result.reference_only:
            source_url = result.source_url or result.canonical_url
            answer_text = result.title
            if source_url:
                answer_text = f"{result.title}\n\n该通知当前仅提供原文链接：{source_url}"
            return AgentResponse(
                target="notice-agent",
                status="completed",
                answer_text=answer_text,
                confidence=confidence,
                result=result,
                agent_observability=_agent_observability("campus_notice_get", result),
            )
        return AgentResponse(
            target="notice-agent",
            status="completed",
            answer_text=f"{result.title}\n\n{result.normalized_body}",
            confidence=confidence,
            result=result,
            agent_observability=_agent_observability("campus_notice_get", result),
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
            agent_observability=_agent_observability("campus_notice_get", result),
        )
    if result.outcome == "temporarily_unverifiable":
        return AgentResponse(
            target="notice-agent",
            status="no_answer",
            answer_text="当前还不能稳定读取这条通知。",
            confidence="low",
            result=result,
            agent_observability=_agent_observability("campus_notice_get", result),
        )
    return AgentResponse(
        target="notice-agent",
        status="no_answer",
        answer_text="当前没有找到对应通知。",
        confidence="low",
        result=result,
        agent_observability=_agent_observability("campus_notice_get", result),
    )


def _access_context_from_request(request: AgentRequest) -> NoticeAccessContext:
    return NoticeAccessContext(
        actor=request.actor,
        authorization=request.context.authorization,
    )


def _agent_observability(tool_name: str, result) -> AgentObservability:
    outcome = str(getattr(result, "outcome", "") or "")
    return AgentObservability(
        selected_tool=tool_name,
        tool_attempted=True,
        tool_outcome=outcome,
        failure_class=_failure_class_for_outcome(outcome),
        fail_close_reason=str(getattr(result, "fail_close_reason", "") or ""),
        result_outcome=outcome,
        source_ref_count=_source_ref_count(result),
        access_decision="allowed",
        safe_details={"result_type": result.__class__.__name__},
    )


def _failure_class_for_outcome(outcome: str) -> str:
    if outcome == "temporarily_unverifiable":
        return "fail_close"
    if outcome == "clarification_required":
        return "clarification"
    if outcome == "not_found":
        return "not_found"
    return ""


def _source_ref_count(result) -> int:
    refs: set[str] = set()

    def collect(value) -> None:
        if isinstance(value, str):
            return
        if isinstance(value, dict):
            for key, item in value.items():
                normalized_key = str(key)
                if normalized_key in {"source_url", "canonical_url"} and isinstance(item, str):
                    if item.strip():
                        refs.add(item.strip())
                    continue
                if normalized_key.endswith("refs") and isinstance(item, (list, tuple)):
                    refs.update(str(ref).strip() for ref in item if str(ref).strip())
                    continue
                collect(item)
            return
        if isinstance(value, (list, tuple)):
            for item in value:
                collect(item)

    collect(asdict(result))
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
            failure_class="tool_policy",
            access_decision="not_evaluated",
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
            failure_class="query_service_failed",
            access_decision="allowed",
        ),
    )
