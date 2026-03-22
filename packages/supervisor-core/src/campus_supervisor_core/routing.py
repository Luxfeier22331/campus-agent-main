from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from campus_supervisor_core.context import SupervisorRequestContext


SpecialistTarget = Literal["rag-specialist"]
QueryEnabledCorpus = Literal["student_handbook"]
QUERY_ENABLED_CORPUS: QueryEnabledCorpus = "student_handbook"


@dataclass(frozen=True, slots=True)
class RoutingDecision:
    target: SpecialistTarget
    primary_corpus: str


def route_request(context: SupervisorRequestContext) -> RoutingDecision:
    if context.primary_corpus != QUERY_ENABLED_CORPUS:
        raise ValueError("phase-1 query-serving only supports student_handbook")

    return RoutingDecision(target="rag-specialist", primary_corpus=context.primary_corpus)
