from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import DelegateToRagAgentRequest, KnowledgeScope
from campus_contracts.models import AllowedCorpus


@dataclass(frozen=True, slots=True)
class SupervisorRequestContext:
    request: DelegateToRagAgentRequest
    request_id: str
    trace_id: str
    user_id: str
    conversation_id: str
    scope: KnowledgeScope
    user_goal: str

    @property
    def primary_corpus(self) -> AllowedCorpus:
        return self.scope.corpus

    @property
    def primary_collection(self) -> str:
        return self.scope.collection

    @classmethod
    def from_request(cls, request: DelegateToRagAgentRequest) -> "SupervisorRequestContext":
        return cls(
            request=request,
            request_id=request.request_id,
            trace_id=request.trace.trace_id,
            user_id=request.actor.user_id,
            conversation_id=request.conversation_id,
            scope=request.scope,
            user_goal=request.user_goal,
        )
