from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from campus_availability_specialist import delegate_to_availability_specialist
from campus_notice_agent import delegate_to_notice_agent
from campus_navigation_specialist import delegate_to_navigation_specialist
from campus_services_agent import delegate_to_campus_services_agent
from campus_contracts import (
    SpecialistRequest,
    SpecialistResponse,
    SpecialistTarget,
    SupervisorRequest,
    SupervisorResponse,
)
from campus_rag_specialist.prompt_execution import RagPromptExecutor

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import MissingSpecialistDelegateError
from campus_supervisor_core.framing import frame_specialist_request
from campus_supervisor_core.prompt_execution import SupervisorPromptExecutor
from campus_supervisor_core.policy import finalize_routing_decision, finalize_specialist_response
from campus_supervisor_core.response import assemble_response
from campus_supervisor_core.routing import route_request
from campus_supervisor_core.tool_policy import assert_tool_policy_is_supported


SpecialistDelegate = Callable[[SpecialistRequest], SpecialistResponse]


def _delegate_to_rag_specialist(
    request: SpecialistRequest,
    *,
    prompt_executor: RagPromptExecutor | None = None,
) -> SpecialistResponse:
    from campus_rag_specialist.service import delegate_to_rag_agent

    return delegate_to_rag_agent(request, prompt_executor=prompt_executor)


@dataclass(slots=True)
class SupervisorAgent:
    specialist_delegates: dict[SpecialistTarget, SpecialistDelegate] | None = None
    supervisor_prompt_executor: SupervisorPromptExecutor | None = None
    rag_prompt_executor: RagPromptExecutor | None = None

    def __post_init__(self) -> None:
        if self.specialist_delegates is None:
            self.specialist_delegates = {
                "rag-specialist": self._delegate_to_rag_specialist,
                "availability-specialist": delegate_to_availability_specialist,
                "navigation-specialist": delegate_to_navigation_specialist,
                "campus-services-agent": delegate_to_campus_services_agent,
                "notice-agent": delegate_to_notice_agent,
            }

    def _delegate_to_rag_specialist(self, request: SpecialistRequest) -> SpecialistResponse:
        return _delegate_to_rag_specialist(request, prompt_executor=self.rag_prompt_executor)

    def handle(self, request: SupervisorRequest) -> SupervisorResponse:
        context = SupervisorRequestContext.from_request(request)
        decision = route_request(context)
        terminal_response = finalize_routing_decision(
            context,
            decision,
            prompt_executor=self.supervisor_prompt_executor,
        )
        if terminal_response is not None:
            return assemble_response(terminal_response)
        delegate = self.specialist_delegates.get(decision.target)
        if delegate is None:
            raise MissingSpecialistDelegateError(
                f"missing delegate for specialist target: {decision.target}"
            )
        specialist_request = frame_specialist_request(context, decision)
        assert_tool_policy_is_supported(specialist_request)
        specialist_response = delegate(specialist_request)
        finalized_response = finalize_specialist_response(specialist_response)
        return assemble_response(finalized_response)

    def handle_specialist_request(self, request: SpecialistRequest) -> SpecialistResponse:
        assert_tool_policy_is_supported(request)
        delegate = self.specialist_delegates.get(request.target)
        if delegate is None:
            raise MissingSpecialistDelegateError(
                f"missing delegate for specialist target: {request.target}"
            )
        return delegate(request)
