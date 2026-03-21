from __future__ import annotations

from copy import deepcopy
from typing import Protocol

from campus_agent.state.models import WorkflowState


class WorkflowStateStore(Protocol):
    def save(self, state: WorkflowState) -> None:
        """Persist the workflow state for later resume."""

    def load(self, workflow_run_id: str) -> WorkflowState:
        """Load a previously saved workflow state."""


class InMemoryWorkflowStateStore:
    """Bootstrap persistence adapter used until Postgres wiring lands."""

    def __init__(self) -> None:
        self._records: dict[str, dict[str, object]] = {}

    def save(self, state: WorkflowState) -> None:
        self._records[state.workflow_run_id] = deepcopy(state.to_dict())

    def load(self, workflow_run_id: str) -> WorkflowState:
        payload = self._records[workflow_run_id]
        return WorkflowState.from_dict(deepcopy(payload))

