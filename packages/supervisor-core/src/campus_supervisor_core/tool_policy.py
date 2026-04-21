from __future__ import annotations

from campus_contracts import SpecialistRequest, SpecialistTarget, SpecialistToolName

from campus_supervisor_core.errors import InvalidSpecialistToolPolicyError

_ALLOWED_TOOLS_BY_TARGET: dict[SpecialistTarget, tuple[SpecialistToolName, ...]] = {
    "rag-agent": (),
    "navigation-agent": (),
    "campus-services-agent": (
        "service_status_lookup",
        "transport_schedule_lookup",
    ),
    "notice-agent": (
        "campus_notice_discover",
        "campus_notice_get",
    ),
}


def allowed_tools_for_target(target: SpecialistTarget) -> tuple[SpecialistToolName, ...]:
    return _ALLOWED_TOOLS_BY_TARGET[target]


def assert_tool_policy_is_supported(request: SpecialistRequest) -> None:
    allowed_tools = allowed_tools_for_target(request.target)
    if not allowed_tools:
        if request.allowed_tools:
            raise InvalidSpecialistToolPolicyError(
                f"{request.target} does not allow tools: {', '.join(request.allowed_tools)}"
            )
        return

    if not request.allowed_tools:
        raise InvalidSpecialistToolPolicyError(
            f"{request.target} requires code-owned allowed_tools"
        )

    disallowed_tools = tuple(
        tool_name for tool_name in request.allowed_tools if tool_name not in allowed_tools
    )
    if disallowed_tools:
        raise InvalidSpecialistToolPolicyError(
            f"{request.target} does not allow tools: {', '.join(disallowed_tools)}"
        )
