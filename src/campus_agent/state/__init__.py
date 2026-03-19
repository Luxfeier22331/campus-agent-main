from __future__ import annotations

from typing import TYPE_CHECKING

from campus_agent.state.models import (
    ToolExecutionRecord,
    WorkflowActorContext,
    WorkflowState,
    WorkflowTraceContext,
)
from campus_agent.state.postgres_store import PostgresWorkflowStateStore
from campus_agent.state.store import InMemoryWorkflowStateStore, WorkflowStateStore

if TYPE_CHECKING:
    from campus_agent.config import CampusAgentSettings


def create_state_store(settings: CampusAgentSettings) -> WorkflowStateStore:
    """Factory that returns the appropriate state store based on settings."""
    if settings.workflow_state_backend == "postgres":
        if not settings.postgres_conninfo:
            raise ValueError(
                "CAMPUS_AGENT_POSTGRES_CONNINFO is required when "
                "workflow_state_backend is 'postgres'"
            )
        return PostgresWorkflowStateStore(conninfo=settings.postgres_conninfo)
    return InMemoryWorkflowStateStore()


__all__ = [
    "InMemoryWorkflowStateStore",
    "PostgresWorkflowStateStore",
    "ToolExecutionRecord",
    "WorkflowActorContext",
    "WorkflowState",
    "WorkflowStateStore",
    "WorkflowTraceContext",
    "create_state_store",
]
