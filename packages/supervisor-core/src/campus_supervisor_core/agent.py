from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from campus_contracts import DelegateToRagAgentRequest, DelegateToRagAgentResponse
from campus_rag_specialist import delegate_to_rag_agent


SpecialistDelegate = Callable[[DelegateToRagAgentRequest], DelegateToRagAgentResponse]


@dataclass(slots=True)
class SupervisorAgent:
    specialist_delegate: SpecialistDelegate = delegate_to_rag_agent

    def handle(self, request: DelegateToRagAgentRequest) -> DelegateToRagAgentResponse:
        return self.specialist_delegate(request)
