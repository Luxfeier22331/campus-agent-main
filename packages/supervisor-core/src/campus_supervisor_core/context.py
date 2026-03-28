from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import ContextProjection, KnowledgeScope, RequestedCapability, SupervisorRequest
from campus_contracts.models import AllowedCorpus


@dataclass(frozen=True, slots=True)
class SupervisorRequestContext:
    request: SupervisorRequest
    request_id: str
    trace_id: str
    user_id: str
    conversation_id: str
    context: ContextProjection
    requested_capability: RequestedCapability | None
    requested_scope: KnowledgeScope | None
    availability_target_id: str | None
    follow_redirects: bool
    user_goal: str

    @property
    def primary_corpus(self) -> AllowedCorpus | None:
        if self.requested_scope is None:
            return None
        return self.requested_scope.corpus

    @property
    def primary_collection(self) -> str | None:
        if self.requested_scope is None:
            return None
        return self.requested_scope.collection

    @classmethod
    def from_request(cls, request: SupervisorRequest) -> "SupervisorRequestContext":
        return cls(
            request=request,
            request_id=request.request_id,
            trace_id=request.trace.trace_id,
            user_id=request.actor.user_id,
            conversation_id=request.conversation_id,
            context=request.context,
            requested_capability=request.requested_capability,
            requested_scope=request.requested_scope,
            availability_target_id=request.availability_target_id,
            follow_redirects=request.follow_redirects,
            user_goal=request.user_goal,
        )
