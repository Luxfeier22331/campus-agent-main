from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from campus_contracts import DelegateToRagAgentRequest, DelegateToRagAgentResponse
from campus_rag_specialist import delegate_to_rag_agent

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.policy import finalize_specialist_response
from campus_supervisor_core.response import assemble_response
from campus_supervisor_core.routing import route_request


SpecialistDelegate = Callable[[DelegateToRagAgentRequest], DelegateToRagAgentResponse]


@dataclass(slots=True)
class SupervisorAgent:
    specialist_delegate: SpecialistDelegate = delegate_to_rag_agent

    def handle(self, request: DelegateToRagAgentRequest) -> DelegateToRagAgentResponse:
        context = SupervisorRequestContext.from_request(request)
        decision = route_request(context)
        if decision.target != "rag-specialist":
            raise ValueError(f"unsupported specialist target: {decision.target}")
        specialist_response = self.specialist_delegate(context.request)
        finalized_response = finalize_specialist_response(specialist_response)
        return assemble_response(finalized_response)
