from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from campus_contracts import (
    AvailabilityCheckPayload,
    RagRequestPayload,
    SpecialistTarget,
)
from campus_contracts.models import AllowedCorpus

from campus_supervisor_core.context import SupervisorRequestContext


QueryEnabledCorpus = Literal["regulations"]
QueryEnabledCollection = Literal["student_handbook"]
QUERY_ENABLED_CORPUS: QueryEnabledCorpus = "regulations"
QUERY_ENABLED_COLLECTION: QueryEnabledCollection = "student_handbook"


@dataclass(frozen=True, slots=True)
class RoutingDecision:
    target: SpecialistTarget
    primary_corpus: AllowedCorpus | None
    primary_collection: str | None


def route_request(context: SupervisorRequestContext) -> RoutingDecision:
    if context.request.target == "availability-specialist":
        if not isinstance(context.request.payload, AvailabilityCheckPayload):
            raise TypeError("availability-specialist requests require AvailabilityCheckPayload")
        return RoutingDecision(
            target="availability-specialist",
            primary_corpus=None,
            primary_collection=None,
        )

    if context.request.target == "rag-specialist":
        if not isinstance(context.request.payload, RagRequestPayload):
            raise TypeError("rag-specialist requests require RagRequestPayload")
        if (
            context.primary_corpus != QUERY_ENABLED_CORPUS
            or context.primary_collection != QUERY_ENABLED_COLLECTION
        ):
            raise ValueError("phase-1 query-serving only supports regulations/student_handbook")
        return RoutingDecision(
            target="rag-specialist",
            primary_corpus=context.primary_corpus,
            primary_collection=context.primary_collection,
        )

    raise ValueError(f"unsupported specialist target: {context.request.target}")
