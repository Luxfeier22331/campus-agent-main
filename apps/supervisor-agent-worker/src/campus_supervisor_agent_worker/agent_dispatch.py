from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from campus_contracts import (
    AgentRequest,
    AgentResponse,
    AgentTarget,
    ErrorInfo,
)

AgentDelegate = Callable[[AgentRequest], AgentResponse]
CancellationChecker = Callable[[], bool]


class AgentDispatchError(ValueError):
    error_code = "agent_dispatch_error"
    http_status_code = 500
    retryable = False

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message

    def to_error_info(self) -> ErrorInfo:
        return ErrorInfo(
            code=self.error_code,
            message=self.message,
            retryable=self.retryable,
        )


class ExecutionCancelledError(AgentDispatchError):
    error_code = "execution_cancelled"
    http_status_code = 499


class MissingAgentDelegateError(AgentDispatchError):
    error_code = "missing_agent_delegate"
    http_status_code = 500


@dataclass(slots=True)
class AgentDispatcher:
    agent_delegates: dict[AgentTarget, AgentDelegate] = field(default_factory=dict)
    cancellation_checker: CancellationChecker | None = None

    def dispatch(self, request: AgentRequest) -> AgentResponse:
        delegate = self.agent_delegates.get(request.target)
        if delegate is None:
            raise MissingAgentDelegateError(f"missing delegate for agent target: {request.target}")
        self._raise_if_cancelled()
        response = delegate(request)
        self._raise_if_cancelled()
        return response

    def _raise_if_cancelled(self) -> None:
        if self.cancellation_checker is not None and self.cancellation_checker():
            raise ExecutionCancelledError("Execution was cancelled.")


def dispatch_agent_request(
    request: AgentRequest,
    *,
    agent_delegates: dict[AgentTarget, AgentDelegate] | None = None,
    cancellation_checker: CancellationChecker | None = None,
) -> AgentResponse:
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
