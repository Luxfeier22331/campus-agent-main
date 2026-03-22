from __future__ import annotations

from campus_contracts import DelegateToRagAgentResponse


def finalize_specialist_response(response: DelegateToRagAgentResponse) -> DelegateToRagAgentResponse:
    if response.status == "completed":
        return response
    if response.status == "needs_clarification":
        return response
    if response.status == "no_answer":
        return response
    if response.status == "error":
        return response
    raise ValueError(f"unsupported delegate status: {response.status}")
