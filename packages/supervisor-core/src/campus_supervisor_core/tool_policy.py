from __future__ import annotations

from campus_contracts import (
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    PlaceLookupPayload,
    RagRequestPayload,
    ServiceStatusLookupPayload,
    SpecialistRequest,
    TransportScheduleLookupPayload,
)

from campus_supervisor_core.errors import InvalidSpecialistToolPolicyError


def assert_tool_policy_is_supported(request: SpecialistRequest) -> None:
    expected_tool = _expected_tool_for_payload(request)
    if expected_tool is None:
        if request.allowed_tools:
            raise InvalidSpecialistToolPolicyError(
                f"payload does not accept tools: {', '.join(request.allowed_tools)}"
            )
        return

    if request.allowed_tools != (expected_tool,):
        raise InvalidSpecialistToolPolicyError(
            f"payload requires code-owned allowed_tool: {expected_tool}"
        )


def _expected_tool_for_payload(request: SpecialistRequest) -> str | None:
    payload = request.payload
    if isinstance(payload, (RagRequestPayload, PlaceLookupPayload)):
        return None
    if isinstance(payload, ServiceStatusLookupPayload):
        return "service_status_lookup"
    if isinstance(payload, TransportScheduleLookupPayload):
        return "transport_schedule_lookup"
    if isinstance(payload, CampusNoticeDiscoverPayload):
        return "campus_notice_discover"
    if isinstance(payload, CampusNoticeGetPayload):
        return "campus_notice_get"
    raise InvalidSpecialistToolPolicyError("unsupported specialist payload type")
