from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from campus_availability_specialist import delegate_to_availability_specialist
from campus_contracts import SpecialistRequest, SpecialistResponse, SpecialistTarget
from campus_rag_specialist import delegate_to_rag_agent

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.policy import finalize_specialist_response
from campus_supervisor_core.response import assemble_response
from campus_supervisor_core.routing import route_request


SpecialistDelegate = Callable[[SpecialistRequest], SpecialistResponse]


def _default_specialist_delegates() -> dict[SpecialistTarget, SpecialistDelegate]:
    return {
        "rag-specialist": delegate_to_rag_agent,
        "availability-specialist": delegate_to_availability_specialist,
    }


@dataclass(slots=True)
class SupervisorAgent:
    specialist_delegates: dict[SpecialistTarget, SpecialistDelegate] = field(
        default_factory=_default_specialist_delegates
    )

    def handle(self, request: SpecialistRequest) -> SpecialistResponse:
        context = SupervisorRequestContext.from_request(request)
        decision = route_request(context)
        delegate = self.specialist_delegates.get(decision.target)
        if delegate is None:
            raise ValueError(f"missing delegate for specialist target: {decision.target}")
        specialist_response = delegate(context.request)
        finalized_response = finalize_specialist_response(specialist_response)
        return assemble_response(finalized_response)
