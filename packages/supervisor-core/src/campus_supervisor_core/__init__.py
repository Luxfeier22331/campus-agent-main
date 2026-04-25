from __future__ import annotations

from collections.abc import Callable

from campus_contracts import (
    SpecialistRequest,
    SpecialistResponse,
    SpecialistTarget,
)

from campus_supervisor_core.dispatcher import AgentDelegate, AgentDispatcher
from campus_supervisor_core.errors import (
    AgentDispatchError,
    ExecutionCancelledError,
    MissingAgentDelegateError,
)

CancellationChecker = Callable[[], bool]


def dispatch_agent_request(
    request: SpecialistRequest,
    *,
    agent_delegates: dict[SpecialistTarget, AgentDelegate] | None = None,
    cancellation_checker: CancellationChecker | None = None,
) -> SpecialistResponse:
    dispatcher = AgentDispatcher(
        agent_delegates=dict(agent_delegates or {}),
        cancellation_checker=cancellation_checker,
    )
    return dispatcher.dispatch(request)


__all__ = [
    "AgentDelegate",
    "AgentDispatchError",
    "AgentDispatcher",
    "ExecutionCancelledError",
    "MissingAgentDelegateError",
    "dispatch_agent_request",
]
