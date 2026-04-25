from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from campus_contracts import (
    SpecialistRequest,
    SpecialistResponse,
    SpecialistTarget,
)

from campus_supervisor_core.errors import (
    ExecutionCancelledError,
    MissingAgentDelegateError,
)

AgentDelegate = Callable[[SpecialistRequest], SpecialistResponse]
CancellationChecker = Callable[[], bool]


@dataclass(slots=True)
class AgentDispatcher:
    agent_delegates: dict[SpecialistTarget, AgentDelegate] = field(default_factory=dict)
    cancellation_checker: CancellationChecker | None = None

    def dispatch(self, request: SpecialistRequest) -> SpecialistResponse:
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
