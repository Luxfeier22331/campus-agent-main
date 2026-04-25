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
        raise MissingRoutingInputError("requested_capability is required from supervisor-api")

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
