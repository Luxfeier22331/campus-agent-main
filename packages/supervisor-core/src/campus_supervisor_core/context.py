from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import DelegateToRagAgentRequest
from campus_contracts.models import AllowedCorpus


@dataclass(frozen=True, slots=True)
class SupervisorRequestContext:
    request: DelegateToRagAgentRequest
    request_id: str
    trace_id: str
    user_id: str
    conversation_id: str
    primary_corpus: AllowedCorpus
    user_goal: str

    @classmethod
    def from_request(cls, request: DelegateToRagAgentRequest) -> "SupervisorRequestContext":
        return cls(
            request=request,
            request_id=request.request_id,
            trace_id=request.trace.trace_id,
            user_id=request.actor.user_id,
            conversation_id=request.conversation_id,
            primary_corpus=request.corpora[0],
            user_goal=request.user_goal,
        )
