from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from campus_contracts import (
    AgentRequest,
    AgentResponse,
    AgentTarget,
    ErrorInfo,
)

from campus_supervisor_agent_worker.agent_spec_registry import (
    AgentSpecRegistry,
    default_agent_spec_registry,
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


class AgentSpecAdmissionError(AgentDispatchError):
    error_code = "invalid_agent_admission"
    http_status_code = 400


@dataclass(slots=True)
class AgentDispatcher:
    agent_delegates: dict[AgentTarget, AgentDelegate] = field(default_factory=dict)
    cancellation_checker: CancellationChecker | None = None
    agent_registry: AgentSpecRegistry | None = None
    tool_registry: ToolSpecRegistry | None = None

    def dispatch(self, request: AgentRequest) -> AgentResponse:
        tool_registry = self._tool_registry()
        _validate_agent_spec_admission(request, self._agent_registry(), tool_registry)
        _validate_tool_admission(request, tool_registry)
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

    def _agent_registry(self) -> AgentSpecRegistry:
        if self.agent_registry is not None:
            return self.agent_registry
        return default_agent_spec_registry()


def _validate_agent_spec_admission(
    request: AgentRequest,
    agent_registry: AgentSpecRegistry,
    tool_registry: ToolSpecRegistry,
) -> None:
    agent = agent_registry.agent_by_id(request.target)
    if agent is None:
        raise AgentSpecAdmissionError(f"unknown AgentSpec target: {request.target}")
    if not agent.active or agent.opening_gate != "open":
        raise AgentSpecAdmissionError(
            f"AgentSpec target is not open for dispatch: {request.target}"
        )
    try:
        tool_registry.payload_kind_for_request(request.target, request.payload)
    except ToolSpecRegistryError as exc:
        raise AgentSpecAdmissionError(str(exc)) from exc


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
    "AgentSpecAdmissionError",
    "ExecutionCancelledError",
    "MissingAgentDelegateError",
    "ToolAdmissionError",
    "dispatch_agent_request",
]
