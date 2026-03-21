from __future__ import annotations

from campus_contracts import DelegateToRagAgentRequest


def high_frequency_scenarios() -> tuple[DelegateToRagAgentRequest, ...]:
    return (
        DelegateToRagAgentRequest(user_goal="library hours"),
        DelegateToRagAgentRequest(user_goal="scholarship eligibility"),
    )
