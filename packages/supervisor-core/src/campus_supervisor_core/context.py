from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import KnowledgeScope, RagRequestPayload, SpecialistRequest
from campus_contracts.models import AllowedCorpus


@dataclass(frozen=True, slots=True)
class SupervisorRequestContext:
    request: SpecialistRequest
    request_id: str
    trace_id: str
    user_id: str
    conversation_id: str
    scope: KnowledgeScope | None
    user_goal: str

    @property
    def primary_corpus(self) -> AllowedCorpus | None:
        if self.scope is None:
            return None
        return self.scope.corpus

    @property
    def primary_collection(self) -> str | None:
        if self.scope is None:
            return None
        return self.scope.collection

    @classmethod
    def from_request(cls, request: SpecialistRequest) -> "SupervisorRequestContext":
        scope = request.payload.scope if isinstance(request.payload, RagRequestPayload) else None
        return cls(
            request=request,
            request_id=request.request_id,
            trace_id=request.trace.trace_id,
            user_id=request.actor.user_id,
            conversation_id=request.conversation_id,
            scope=scope,
            user_goal=request.user_goal,
        )
