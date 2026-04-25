from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from campus_contracts import (
    SpecialistRequest,
    SpecialistResponse,
    SpecialistTarget,
    SupervisorRequest,
    SupervisorResponse,
)
from campus_navigation_agent import delegate_to_navigation_agent
from campus_notice_agent import delegate_to_notice_agent
from campus_rag_agent.prompt_execution import RagPromptExecutor
from campus_services_agent import delegate_to_campus_services_agent

from campus_supervisor_core.errors import (
    ExecutionCancelledError,
    MissingRoutingInputError,
    MissingSpecialistDelegateError,
)
from campus_supervisor_core.policy import finalize_specialist_response
from campus_supervisor_core.response import assemble_response
from campus_supervisor_core.tool_policy import assert_tool_policy_is_supported

SpecialistDelegate = Callable[[SpecialistRequest], SpecialistResponse]
CancellationChecker = Callable[[], bool]


def _delegate_to_rag_agent(
    request: SpecialistRequest,
    *,
    prompt_executor: RagPromptExecutor | None = None,
) -> SpecialistResponse:
    from campus_rag_agent.service import delegate_to_rag_agent

    return delegate_to_rag_agent(request, prompt_executor=prompt_executor)


@dataclass(slots=True)
class SupervisorAgent:
    specialist_delegates: dict[SpecialistTarget, SpecialistDelegate] | None = None
    rag_prompt_executor: RagPromptExecutor | None = None
    cancellation_checker: CancellationChecker | None = None
    preplanned_specialist_request: SpecialistRequest | None = None

    def __post_init__(self) -> None:
        if self.specialist_delegates is None:
            self.specialist_delegates = {
                "rag-agent": self._delegate_to_rag_agent,
                "navigation-agent": delegate_to_navigation_agent,
                "campus-services-agent": delegate_to_campus_services_agent,
                "notice-agent": delegate_to_notice_agent,
            }

    def _delegate_to_rag_agent(self, request: SpecialistRequest) -> SpecialistResponse:
        return _delegate_to_rag_agent(request, prompt_executor=self.rag_prompt_executor)

    def handle(self, request: SupervisorRequest) -> SupervisorResponse:
        self._raise_if_cancelled()
        specialist_request = self.preplanned_specialist_request
        if specialist_request is None:
            raise MissingRoutingInputError(
                "preplanned specialist request is required from supervisor-api"
            )
        delegate = self.specialist_delegates.get(specialist_request.target)
        if delegate is None:
            raise MissingSpecialistDelegateError(
                f"missing delegate for specialist target: {specialist_request.target}"
            )
        assert_tool_policy_is_supported(specialist_request)
        self._raise_if_cancelled()
        specialist_response = delegate(specialist_request)
        self._raise_if_cancelled()
        finalized_response = finalize_specialist_response(specialist_response)
        self._raise_if_cancelled()
        return assemble_response(finalized_response)

    def handle_specialist_request(self, request: SpecialistRequest) -> SpecialistResponse:
        assert_tool_policy_is_supported(request)
        delegate = self.specialist_delegates.get(request.target)
        if delegate is None:
            raise MissingSpecialistDelegateError(
                f"missing delegate for specialist target: {request.target}"
            )
        self._raise_if_cancelled()
        response = delegate(request)
        self._raise_if_cancelled()
        return response

    def _raise_if_cancelled(self) -> None:
        if self.cancellation_checker is not None and self.cancellation_checker():
            raise ExecutionCancelledError("Supervisor execution was cancelled.")
