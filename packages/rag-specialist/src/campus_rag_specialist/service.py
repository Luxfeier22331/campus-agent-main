from __future__ import annotations

from typing import Callable

from campus_contracts import DelegateToRagAgentRequest, DelegateToRagAgentResponse, ErrorInfo
from campus_retrieval_core import RetrievalBackendError, retrieve_sources

from campus_rag_specialist.agent import RagSpecialistAgent
from campus_rag_specialist.confidence import derive_confidence


Retriever = Callable[..., object]


def delegate_to_rag_agent(
    request: DelegateToRagAgentRequest,
    *,
    retriever: Callable[..., object] = retrieve_sources,
) -> DelegateToRagAgentResponse:
    user_goal = request.user_goal.strip()
    if not user_goal:
        return DelegateToRagAgentResponse(
            status="needs_clarification",
            follow_up_question="Please clarify what you want to know from the student handbook.",
        )

    try:
        evidence = retriever(
            user_goal,
            corpus=request.corpora[0],
            campus_scope=request.actor.campus_scope,
            acl_groups=request.actor.groups,
        )
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
    agent = RagSpecialistAgent()
    return DelegateToRagAgentResponse(
        status="completed",
        answer_text=agent.compose_answer(evidence),
        confidence=derive_confidence(evidence),
        evidence=evidence,
    )
