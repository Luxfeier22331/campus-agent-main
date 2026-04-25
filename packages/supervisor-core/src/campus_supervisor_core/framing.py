from __future__ import annotations

from campus_contracts import SpecialistRequest

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import MissingRoutingInputError
from campus_supervisor_core.routing import RoutingDecision


def frame_specialist_request(
    context: SupervisorRequestContext,
    decision: RoutingDecision,
) -> SpecialistRequest:
    if decision.target is None:
        raise MissingRoutingInputError("specialist target is required for delegated requests")
    if decision.specialist_payload is None:
        raise MissingRoutingInputError(
            f"specialist payload is required for delegated target: {decision.target}"
        )

    return SpecialistRequest(
        target=decision.target,
        user_goal=context.user_goal,
        conversation_id=context.conversation_id,
        request_id=context.request_id,
        safety_identifier=context.request.safety_identifier,
        trace=context.request.trace,
        actor=context.request.actor,
        context=context.context,
        payload=decision.specialist_payload,
        allowed_tools=decision.allowed_tools,
    )
