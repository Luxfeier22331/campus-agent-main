from __future__ import annotations

from campus_contracts import ErrorInfo, AgentRequest, AgentResponse

from campus_notice_agent.query_service import NoticeQueryService
from campus_notice_agent.tool_adapter import dispatch_tool_request


def delegate_to_notice_agent(
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
        )
    return dispatch_tool_request(request, query_service=query_service)
