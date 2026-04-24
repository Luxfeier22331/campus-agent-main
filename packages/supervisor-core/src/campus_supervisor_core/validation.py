from __future__ import annotations

from campus_contracts import ALLOWED_REQUESTED_CAPABILITIES, RequestedCapability

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import (
    InvalidSupervisorRequestError,
    MissingRoutingInputError,
    UnsupportedCapabilityError,
)


def resolve_requested_capability(context: SupervisorRequestContext) -> RequestedCapability:
    capability = context.requested_capability
    has_scope = context.requested_scope is not None
    has_non_current_version_query = context.version_query.mode != "current"

    if capability is None:
        if has_scope:
            return "knowledge"
        inferred_capability = infer_requested_capability_from_goal(context.user_goal)
        if inferred_capability == "place_lookup" and has_non_current_version_query:
            raise InvalidSupervisorRequestError(
                "version_query is not allowed for place_lookup requests"
            )
        return inferred_capability

    if capability not in ALLOWED_REQUESTED_CAPABILITIES:
        raise UnsupportedCapabilityError(f"unsupported requested_capability: {capability}")

    if capability == "knowledge":
        return capability

    if capability == "place_lookup":
        if has_scope:
            raise InvalidSupervisorRequestError(
                "requested_scope is not allowed for place_lookup requests"
            )
        if has_non_current_version_query:
            raise InvalidSupervisorRequestError(
                "version_query is not allowed for place_lookup requests"
            )
        return capability
    if capability in {"campus_services", "notice"}:
        if has_scope:
            raise InvalidSupervisorRequestError(
                "requested_scope is only allowed for knowledge requests"
            )
        if has_non_current_version_query:
            raise InvalidSupervisorRequestError(
                "version_query is only allowed for knowledge requests"
            )
        return capability
    raise MissingRoutingInputError(f"unsupported requested capability: {capability}")


_PLACE_LOOKUP_SIGNALS = (
    "在哪里",
    "在哪",
    "在哪儿",
    "怎么去",
    "怎么走",
    "位于哪里",
    "在什么地方",
    "在哪个门",
    "从哪个门进",
    "位置在哪",
)


def infer_requested_capability_from_goal(user_goal: str) -> RequestedCapability:
    normalized_goal = "".join(user_goal.split())
    if any(signal in normalized_goal for signal in _PLACE_LOOKUP_SIGNALS):
        return "place_lookup"
    return "knowledge"
