from __future__ import annotations

from collections.abc import Mapping

from campus_contracts import ErrorInfo, SpecialistRequest, SpecialistResponse

from campus_notice_agent.query_service import NoticeQueryService
from campus_notice_agent.runtime_query_service import build_notice_read_model_query_service_from_env
from campus_notice_agent.tool_adapter import dispatch_tool_request


def delegate_to_notice_agent(
    request: SpecialistRequest,
    *,
    query_service: NoticeQueryService | None = None,
    env: Mapping[str, str] | None = None,
) -> SpecialistResponse:
    if request.target != "notice-agent":
        return SpecialistResponse(
            target="notice-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="invalid_specialist_target",
                message="notice-agent requires target='notice-agent'",
            ),
        )
    runtime_query_service = query_service or build_notice_read_model_query_service_from_env(env=env)
    if runtime_query_service is None:
        return SpecialistResponse(
            target="notice-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="internal_query_service_unavailable",
                message="notice-agent requires an internal query service",
            ),
        )
    return dispatch_tool_request(request, query_service=runtime_query_service)
