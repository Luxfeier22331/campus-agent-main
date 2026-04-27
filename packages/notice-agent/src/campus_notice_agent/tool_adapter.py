from __future__ import annotations

from campus_contracts import (
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
        return _query_service_failed(str(exc))
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
        return _query_service_failed(str(exc))
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
        )
    if result.outcome == "temporarily_unverifiable":
        return AgentResponse(
            target="notice-agent",
            status="no_answer",
            answer_text="当前还不能稳定确认这类通知。",
            confidence="low",
            result=result,
        )
    return AgentResponse(
        target="notice-agent",
        status="no_answer",
        answer_text="当前没有找到对应通知。",
        confidence="low",
        result=result,
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
            )
        return AgentResponse(
            target="notice-agent",
            status="completed",
            answer_text=f"{result.title}\n\n{result.normalized_body}",
            confidence=confidence,
            result=result,
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
        )
    if result.outcome == "temporarily_unverifiable":
        return AgentResponse(
            target="notice-agent",
            status="no_answer",
            answer_text="当前还不能稳定读取这条通知。",
            confidence="low",
            result=result,
        )
    return AgentResponse(
        target="notice-agent",
        status="no_answer",
        answer_text="当前没有找到对应通知。",
        confidence="low",
        result=result,
    )


def _access_context_from_request(request: AgentRequest) -> NoticeAccessContext:
    return NoticeAccessContext(
        actor=request.actor,
        authorization=request.context.authorization,
    )


def _tool_not_allowed(tool_name: str) -> AgentResponse:
    return AgentResponse(
        target="notice-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="disallowed_tool",
            message=f"notice-agent cannot execute tool: {tool_name}",
        ),
    )


def _query_service_failed(message: str) -> AgentResponse:
    return AgentResponse(
        target="notice-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="internal_query_service_failed",
            message=message or "internal query service failed",
        ),
    )
