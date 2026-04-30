from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from campus_contracts import (
    AgentRequest,
    AgentResponse,
    AgentTarget,
    ErrorInfo,
)

from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpecRegistry,
    ToolSpecRegistryError,
    default_tool_spec_registry,
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


class ToolAdmissionError(AgentDispatchError):
    error_code = "invalid_tool_admission"
    http_status_code = 400


@dataclass(slots=True)
class AgentDispatcher:
    agent_delegates: dict[AgentTarget, AgentDelegate] = field(default_factory=dict)
    cancellation_checker: CancellationChecker | None = None
    tool_registry: ToolSpecRegistry | None = None

    def dispatch(self, request: AgentRequest) -> AgentResponse:
        _validate_tool_admission(request, self._tool_registry())
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

    def _tool_registry(self) -> ToolSpecRegistry:
        if self.tool_registry is not None:
            return self.tool_registry
        return default_tool_spec_registry()


def _validate_tool_admission(request: AgentRequest, registry: ToolSpecRegistry) -> None:
    try:
        expected_tools = registry.expected_allowed_tools_for_request(request)
    except ToolSpecRegistryError as exc:
        raise ToolAdmissionError(str(exc)) from exc
    if request.allowed_tools != expected_tools:
        raise ToolAdmissionError(
            "AgentRequest.allowed_tools must exactly match Go-admitted ToolSpec boundary "
            f"for target={request.target} payload={request.payload.__class__.__name__}: "
            f"got {request.allowed_tools!r}, want {expected_tools!r}"
        )


def dispatch_agent_request(
    request: AgentRequest,
    *,
    agent_delegates: dict[AgentTarget, AgentDelegate] | None = None,
    cancellation_checker: CancellationChecker | None = None,
    tool_registry: ToolSpecRegistry | None = None,
) -> AgentResponse:
    dispatcher = AgentDispatcher(
        agent_delegates=dict(agent_delegates or {}),
        cancellation_checker=cancellation_checker,
        tool_registry=tool_registry,
    )
    return dispatcher.dispatch(request)


__all__ = [
    "AgentDelegate",
    "AgentDispatchError",
    "AgentDispatcher",
    "ExecutionCancelledError",
    "MissingAgentDelegateError",
    "ToolAdmissionError",
    "dispatch_agent_request",
]
