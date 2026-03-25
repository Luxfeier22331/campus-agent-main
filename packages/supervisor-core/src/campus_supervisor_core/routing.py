from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import SpecialistTarget
from campus_contracts.models import AllowedCorpus

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import MissingRoutingInputError
from campus_supervisor_core.query_policy import assert_scope_is_query_enabled
from campus_supervisor_core.validation import resolve_requested_capability


@dataclass(frozen=True, slots=True)
class RoutingDecision:
    target: SpecialistTarget
    primary_corpus: AllowedCorpus | None
    primary_collection: str | None


def route_request(context: SupervisorRequestContext) -> RoutingDecision:
    capability = resolve_requested_capability(context)

    if capability == "availability":
        return RoutingDecision(
            target="availability-specialist",
            primary_corpus=None,
            primary_collection=None,
        )

    if context.requested_scope is None:
        raise MissingRoutingInputError(
            "requested_scope is required for knowledge requests"
        )
    assert_scope_is_query_enabled(context.requested_scope)

    return RoutingDecision(
        target="rag-specialist",
        primary_corpus=context.primary_corpus,
        primary_collection=context.primary_collection,
    )
