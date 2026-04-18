from __future__ import annotations

from campus_contracts import (
    AvailabilityCheckPayload,
    KnowledgeScope,
    PlaceLookupPayload,
    RagRequestPayload,
    SpecialistRequest,
)

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import MissingRoutingInputError
from campus_supervisor_core.routing import RoutingDecision


def frame_specialist_request(
    context: SupervisorRequestContext,
    decision: RoutingDecision,
) -> SpecialistRequest:
    if decision.target is None:
        raise MissingRoutingInputError("specialist target is required for delegated requests")
    if decision.target == "availability-specialist":
        if context.availability_target_id is None:
            raise MissingRoutingInputError(
                "availability_target_id is required for availability requests"
            )
        payload = AvailabilityCheckPayload(
            target_id=context.availability_target_id,
            follow_redirects=context.follow_redirects,
        )
    elif decision.target == "navigation-specialist":
        payload = PlaceLookupPayload(query_text=context.user_goal)
    else:
        payload = (
            RagRequestPayload(scope=_copy_scope(context.requested_scope))
            if context.requested_scope is not None
            else RagRequestPayload(scope=None)
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
        payload=payload,
    )


def _copy_scope(scope: KnowledgeScope) -> KnowledgeScope:
    return KnowledgeScope(corpus=scope.corpus, collection=scope.collection)
