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
    has_target = context.availability_target_id is not None

    if capability is None:
        if has_scope and not has_target:
            return "knowledge"
        if has_target and not has_scope:
            return "availability"
        if has_scope and has_target:
            raise InvalidSupervisorRequestError(
                "requested_scope and availability_target_id cannot be combined without an explicit capability"
            )
        raise MissingRoutingInputError(
            "requested_scope or availability_target_id is required"
        )

    if capability not in ALLOWED_REQUESTED_CAPABILITIES:
        raise UnsupportedCapabilityError(
            f"unsupported requested_capability: {capability}"
        )

    if capability == "knowledge":
        if not has_scope:
            raise MissingRoutingInputError(
                "requested_scope is required for knowledge requests"
            )
        if has_target:
            raise InvalidSupervisorRequestError(
                "availability_target_id is not allowed for knowledge requests"
            )
        return capability

    if not has_target:
        raise MissingRoutingInputError(
            "availability_target_id is required for availability requests"
        )
    if has_scope:
        raise InvalidSupervisorRequestError(
            "requested_scope is not allowed for availability requests"
        )
    return capability
