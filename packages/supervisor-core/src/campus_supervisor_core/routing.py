from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import (
    AvailabilityCheckPayload,
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    PlaceLookupPayload,
    RagRequestPayload,
    ServiceStatusLookupPayload,
    SpecialistTarget,
    SpecialistToolName,
    TransportScheduleLookupPayload,
)
from campus_contracts.models import AllowedCorpus

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.intent import IntentFrame, frame_intent
from campus_supervisor_core.query_policy import assert_scope_is_query_enabled
from campus_supervisor_core.validation import resolve_requested_capability


@dataclass(frozen=True, slots=True)
class RoutingDecision:
    target: SpecialistTarget | None
    primary_corpus: AllowedCorpus | None
    primary_collection: str | None
    intent_frame: IntentFrame
    specialist_payload: (
        RagRequestPayload
        | AvailabilityCheckPayload
        | PlaceLookupPayload
        | ServiceStatusLookupPayload
        | TransportScheduleLookupPayload
        | CampusNoticeDiscoverPayload
        | CampusNoticeGetPayload
        | None
    ) = None
    allowed_tools: tuple[SpecialistToolName, ...] = ()


def route_request(context: SupervisorRequestContext) -> RoutingDecision:
    capability = resolve_requested_capability(context)
    intent_frame = frame_intent(context, capability=capability)

    if intent_frame.suggested_next_action != "delegate":
        return RoutingDecision(
            target=None,
            primary_corpus=None,
            primary_collection=None,
            intent_frame=intent_frame,
        )

    if capability == "availability":
        return RoutingDecision(
            target="availability-specialist",
            primary_corpus=None,
            primary_collection=None,
            intent_frame=intent_frame,
        )

    if capability == "place_lookup":
        return RoutingDecision(
            target="navigation-specialist",
            primary_corpus=None,
            primary_collection=None,
            intent_frame=intent_frame,
        )

    if context.requested_scope is not None:
        assert_scope_is_query_enabled(context.requested_scope)

    return RoutingDecision(
        target="rag-specialist",
        primary_corpus=context.primary_corpus,
        primary_collection=context.primary_collection,
        intent_frame=intent_frame,
    )
