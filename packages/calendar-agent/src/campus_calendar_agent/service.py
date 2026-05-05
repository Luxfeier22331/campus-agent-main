from __future__ import annotations

from campus_contracts import AgentObservability, AgentRequest, AgentResponse, ErrorInfo

from campus_calendar_agent.query_service import CalendarQueryService
from campus_calendar_agent.tool_adapter import dispatch_tool_request


def delegate_to_calendar_agent(
    request: AgentRequest,
    *,
    query_service: CalendarQueryService | None = None,
) -> AgentResponse:
    if request.target != "calendar-agent":
        return AgentResponse(
            target="calendar-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="invalid_agent_target",
                message="calendar-agent requires target='calendar-agent'",
            ),
            agent_observability=AgentObservability(
                tool_attempted=False,
                failure_class="invalid_agent_target",
                access_decision="not_evaluated",
            ),
        )
    if query_service is None:
        return AgentResponse(
            target="calendar-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="internal_query_service_unavailable",
                message="calendar-agent requires an internal query service",
            ),
            agent_observability=AgentObservability(
                tool_attempted=False,
                failure_class="query_service_unavailable",
                access_decision="not_evaluated",
            ),
        )
    return dispatch_tool_request(request, query_service=query_service)
