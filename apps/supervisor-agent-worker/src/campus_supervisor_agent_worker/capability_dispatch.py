from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from campus_contracts import (
    CapabilityID,
    CapabilityRequest,
    CapabilityResponse,
    ErrorInfo,
)

from campus_supervisor_agent_worker.capability_spec_registry import (
    CapabilitySpecRegistry,
    default_capability_spec_registry,
)
from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpecAdmission,
    ToolSpecRegistry,
    ToolSpecRegistryError,
    default_tool_spec_registry,
)

CapabilityDelegate = Callable[[CapabilityRequest], CapabilityResponse]
CancellationChecker = Callable[[], bool]


class CapabilityDispatchError(ValueError):
    error_code = "capability_dispatch_error"
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


class ExecutionCancelledError(CapabilityDispatchError):
    error_code = "execution_cancelled"
    http_status_code = 499


class MissingCapabilityDelegateError(CapabilityDispatchError):
    error_code = "missing_capability_delegate"
    http_status_code = 500


class ToolAdmissionError(CapabilityDispatchError):
    error_code = "invalid_tool_admission"
    http_status_code = 400


class CapabilitySpecAdmissionError(CapabilityDispatchError):
    error_code = "invalid_capability_admission"
    http_status_code = 400


@dataclass(frozen=True, slots=True)
class AdmissionAwareCapabilityDelegate:
    handler: Callable[[CapabilityRequest, ToolSpecAdmission], CapabilityResponse]


@dataclass(slots=True)
class CapabilityDispatcher:
    capability_delegates: dict[CapabilityID, CapabilityDelegate | AdmissionAwareCapabilityDelegate] = field(
        default_factory=dict
    )
    cancellation_checker: CancellationChecker | None = None
    agent_registry: CapabilitySpecRegistry | None = None
    tool_registry: ToolSpecRegistry | None = None

    def dispatch(self, request: CapabilityRequest) -> CapabilityResponse:
        tool_registry = self._tool_registry()
        _validate_capability_spec_admission(request, self._agent_registry())
        tool_admission = _validate_tool_admission(request, tool_registry)
        delegate = self.capability_delegates.get(request.capability)
        if delegate is None:
            raise MissingCapabilityDelegateError(
                f"missing delegate for capability: {request.capability}"
            )
        self._raise_if_cancelled()
        if isinstance(delegate, AdmissionAwareCapabilityDelegate):
            response = delegate.handler(request, tool_admission)
        else:
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

    def _agent_registry(self) -> CapabilitySpecRegistry:
        if self.agent_registry is not None:
            return self.agent_registry
        return default_capability_spec_registry()


def _validate_capability_spec_admission(
    request: CapabilityRequest,
    agent_registry: CapabilitySpecRegistry,
) -> None:
    capability = agent_registry.capability_by_id(request.capability)
    if capability is None:
        raise CapabilitySpecAdmissionError(
            f"unknown CapabilitySpec capability: {request.capability}"
        )
    if not capability.active or capability.opening_gate != "open":
        raise CapabilitySpecAdmissionError(
            f"CapabilitySpec capability is not open for dispatch: {request.capability}"
        )


def _validate_tool_admission(
    request: CapabilityRequest,
    registry: ToolSpecRegistry,
) -> ToolSpecAdmission:
    try:
        return registry.validate_allowed_tools_for_request(request)
    except ToolSpecRegistryError as exc:
        raise ToolAdmissionError(str(exc)) from exc


def dispatch_capability_request(
    request: CapabilityRequest,
    *,
    capability_delegates: dict[
        CapabilityID, CapabilityDelegate | AdmissionAwareCapabilityDelegate
    ]
    | None = None,
    cancellation_checker: CancellationChecker | None = None,
    tool_registry: ToolSpecRegistry | None = None,
) -> CapabilityResponse:
    dispatcher = CapabilityDispatcher(
        capability_delegates=dict(capability_delegates or {}),
        cancellation_checker=cancellation_checker,
        tool_registry=tool_registry,
    )
    return dispatcher.dispatch(request)


__all__ = [
    "AdmissionAwareCapabilityDelegate",
    "CapabilityDelegate",
    "CapabilityDispatchError",
    "CapabilityDispatcher",
    "CapabilitySpecAdmissionError",
    "ExecutionCancelledError",
    "MissingCapabilityDelegateError",
    "ToolAdmissionError",
    "dispatch_capability_request",
]
