from __future__ import annotations

from campus_contracts import DelegateToRagAgentRequest, DelegateToRagAgentResponse
from campus_retrieval_core import retrieve_sources


def delegate_to_rag_agent(
    request: DelegateToRagAgentRequest,
) -> DelegateToRagAgentResponse:
    user_goal = request.user_goal.strip()
    if not user_goal:
        return DelegateToRagAgentResponse(status="needs_clarification")

    sources = retrieve_sources(user_goal)
    return DelegateToRagAgentResponse(
        status="completed",
        answer_text=f"Bootstrap answer for: {user_goal}",
        sources=sources,
    )
