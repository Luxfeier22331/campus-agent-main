from __future__ import annotations

from campus_contracts import (
    KnowledgeScope,
    PlaceLookupPayload,
    RagRequestPayload,
    SpecialistRequest,
    VersionQuery,
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
    if decision.specialist_payload is not None:
        payload = decision.specialist_payload
    elif decision.target == "navigation-agent":
        payload = PlaceLookupPayload(query_text=context.user_goal)
    elif decision.target in ("campus-services-agent", "notice-agent"):
        raise MissingRoutingInputError(
            f"specialist payload is required for structured runtime target: {decision.target}"
        )
    else:
        payload = (
            RagRequestPayload(
                scope=_copy_scope(context.requested_scope),
                version_query=_copy_version_query(context.version_query),
            )
            if context.requested_scope is not None
            else RagRequestPayload(
                scope=None,
                version_query=_copy_version_query(context.version_query),
            )
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
        allowed_tools=decision.allowed_tools,
    )


def _copy_scope(scope: KnowledgeScope) -> KnowledgeScope:
    return KnowledgeScope(corpus=scope.corpus, collection=scope.collection)


def _copy_version_query(version_query: VersionQuery) -> VersionQuery:
    return VersionQuery(
        mode=version_query.mode,
        as_of=version_query.as_of,
        version_id=version_query.version_id,
        compare_to_version_id=version_query.compare_to_version_id,
    )
