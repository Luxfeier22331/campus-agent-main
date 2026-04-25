from __future__ import annotations

from collections.abc import Callable

from campus_contracts import (
    SpecialistRequest,
    SpecialistResponse,
    SpecialistTarget,
    SupervisorRequest,
    SupervisorResponse,
)
from campus_rag_agent.prompt_execution import RagPromptExecutor

from campus_supervisor_core.agent import SpecialistDelegate, SupervisorAgent
from campus_supervisor_core.errors import (
    DisallowedKnowledgeScopeError,
    ExecutionCancelledError,
    InvalidSupervisorRequestError,
    MissingRoutingInputError,
    MissingSpecialistDelegateError,
    SupervisorError,
)

CancellationChecker = Callable[[], bool]


def handle_request(
    request: SupervisorRequest,
    *,
    specialist_delegates: dict[SpecialistTarget, SpecialistDelegate] | None = None,
    rag_prompt_executor: RagPromptExecutor | None = None,
    cancellation_checker: CancellationChecker | None = None,
    preplanned_specialist_request: SpecialistRequest | None = None,
) -> SupervisorResponse:
    agent = SupervisorAgent(
        rag_prompt_executor=rag_prompt_executor,
        cancellation_checker=cancellation_checker,
        preplanned_specialist_request=preplanned_specialist_request,
    )
    if specialist_delegates is not None:
        agent.specialist_delegates = dict(specialist_delegates)
    return agent.handle(request)


def handle_specialist_request(
    request: SpecialistRequest,
    *,
    specialist_delegates: dict[SpecialistTarget, SpecialistDelegate] | None = None,
    rag_prompt_executor: RagPromptExecutor | None = None,
) -> SpecialistResponse:
    agent = SupervisorAgent(rag_prompt_executor=rag_prompt_executor)
    if specialist_delegates is not None:
        agent.specialist_delegates = dict(specialist_delegates)
    return agent.handle_specialist_request(request)


__all__ = [
    "DisallowedKnowledgeScopeError",
    "ExecutionCancelledError",
    "InvalidSupervisorRequestError",
    "MissingRoutingInputError",
    "MissingSpecialistDelegateError",
    "SupervisorAgent",
    "SupervisorError",
    "handle_request",
    "handle_specialist_request",
]
