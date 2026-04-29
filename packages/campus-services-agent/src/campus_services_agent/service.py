from __future__ import annotations

from campus_contracts import AgentObservability, AgentRequest, AgentResponse, ErrorInfo

from campus_services_agent.query_service import CampusServicesQueryService
from campus_services_agent.tool_adapter import dispatch_tool_request


def delegate_to_campus_services_agent(
    request: AgentRequest,
    *,
    query_service: CampusServicesQueryService | None = None,
) -> AgentResponse:
    if request.target != "campus-services-agent":
        return AgentResponse(
            target="campus-services-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="invalid_agent_target",
                message="campus-services-agent requires target='campus-services-agent'",
            ),
            agent_observability=AgentObservability(
                tool_attempted=False,
                failure_class="invalid_agent_target",
                access_decision="not_evaluated",
            ),
        )
    if query_service is None:
        return AgentResponse(
            target="campus-services-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="internal_query_service_unavailable",
                message="campus-services-agent requires an internal query service",
            ),
            agent_observability=AgentObservability(
                tool_attempted=False,
                failure_class="query_service_unavailable",
                access_decision="not_evaluated",
            ),
        )
    return dispatch_tool_request(request, query_service=query_service)
