from __future__ import annotations

from campus_contracts import DelegateToRagAgentResponse


def assemble_response(response: DelegateToRagAgentResponse) -> DelegateToRagAgentResponse:
    if response.status == "completed":
        return DelegateToRagAgentResponse(
            status="completed",
            answer_text=response.answer_text,
            confidence=response.confidence,
            evidence=response.evidence,
        )

    if response.status == "needs_clarification":
        return DelegateToRagAgentResponse(
            status="needs_clarification",
            follow_up_question=response.follow_up_question,
            confidence=response.confidence,
            evidence=response.evidence,
        )

    if response.status == "no_answer":
        return DelegateToRagAgentResponse(
            status="no_answer",
            confidence=response.confidence,
            evidence=response.evidence,
        )

    if response.status == "error":
        return DelegateToRagAgentResponse(
            status="error",
            confidence=response.confidence,
            evidence=response.evidence,
            error=response.error,
        )

    raise ValueError(f"unsupported delegate status: {response.status}")


def source_doc_ids_from_response(response: DelegateToRagAgentResponse) -> tuple[str, ...]:
    return tuple(source.doc_id for source in response.evidence.sources)
