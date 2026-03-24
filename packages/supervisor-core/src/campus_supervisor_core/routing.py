from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from campus_supervisor_core.context import SupervisorRequestContext


SpecialistTarget = Literal["rag-specialist"]
QueryEnabledCorpus = Literal["regulations"]
QueryEnabledCollection = Literal["student_handbook"]
QUERY_ENABLED_CORPUS: QueryEnabledCorpus = "regulations"
QUERY_ENABLED_COLLECTION: QueryEnabledCollection = "student_handbook"


@dataclass(frozen=True, slots=True)
class RoutingDecision:
    target: SpecialistTarget
    primary_corpus: QueryEnabledCorpus
    primary_collection: QueryEnabledCollection


def route_request(context: SupervisorRequestContext) -> RoutingDecision:
    if context.primary_corpus != QUERY_ENABLED_CORPUS or context.primary_collection != QUERY_ENABLED_COLLECTION:
        raise ValueError("phase-1 query-serving only supports regulations/student_handbook")

    return RoutingDecision(
        target="rag-specialist",
        primary_corpus=context.primary_corpus,
        primary_collection=context.primary_collection,
    )
