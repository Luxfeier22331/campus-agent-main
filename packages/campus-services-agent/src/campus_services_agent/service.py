from __future__ import annotations

from campus_contracts import ErrorInfo, SpecialistRequest, SpecialistResponse

from campus_services_agent.query_service import CampusServicesQueryService
from campus_services_agent.tool_adapter import dispatch_tool_request


def delegate_to_campus_services_agent(
    request: SpecialistRequest,
    *,
    query_service: CampusServicesQueryService | None = None,
) -> SpecialistResponse:
    if request.target != "campus-services-agent":
        return SpecialistResponse(
            target="campus-services-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="invalid_specialist_target",
                message="campus-services-agent requires target='campus-services-agent'",
            ),
        )
    if query_service is None:
        return SpecialistResponse(
            target="campus-services-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="internal_query_service_unavailable",
                message="campus-services-agent requires an internal query service",
            ),
        )
    return dispatch_tool_request(request, query_service=query_service)
