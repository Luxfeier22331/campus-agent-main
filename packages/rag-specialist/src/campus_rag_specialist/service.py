from __future__ import annotations

from campus_contracts import DelegateToRagAgentRequest, DelegateToRagAgentResponse, ErrorInfo
from campus_retrieval_core import RetrievalBackendError, retrieve_sources


def delegate_to_rag_agent(
    request: DelegateToRagAgentRequest,
) -> DelegateToRagAgentResponse:
    user_goal = request.user_goal.strip()
    if not user_goal:
        return DelegateToRagAgentResponse(
            status="needs_clarification",
            follow_up_question="Please clarify what you want to know from the student handbook.",
        )

    try:
        evidence = retrieve_sources(user_goal)
    except RetrievalBackendError as exc:
        return DelegateToRagAgentResponse(
            status="error",
            confidence="low",
            error=ErrorInfo(code="retrieval_failed", message=str(exc), retryable=False),
        )
    if not evidence.sources:
        return DelegateToRagAgentResponse(
            status="no_answer",
            confidence="low",
            evidence=evidence,
        )
    return DelegateToRagAgentResponse(
        status="completed",
        answer_text=f"Bootstrap answer for: {user_goal}",
        confidence="medium",
        evidence=evidence,
    )
