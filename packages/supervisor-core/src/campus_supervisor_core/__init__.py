from __future__ import annotations

from campus_contracts import DelegateToRagAgentRequest, DelegateToRagAgentResponse
from campus_rag_specialist import delegate_to_rag_agent


def handle_user_goal(user_goal: str) -> DelegateToRagAgentResponse:
    return delegate_to_rag_agent(DelegateToRagAgentRequest(user_goal=user_goal))


__all__ = ["handle_user_goal"]
