from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import ContextProjection, KnowledgeScope, RequestedCapability, SupervisorRequest
from campus_contracts.models import AllowedCorpus


@dataclass(frozen=True, slots=True)
class SupervisorPersonalizationHint:
    actor_claim_terms: tuple[str, ...] = ()
    recent_goal: str = ""
    confirmed_slot_terms: tuple[str, ...] = ()

    @property
    def clarification_subject(self) -> str:
        if self.confirmed_slot_terms:
            return self.confirmed_slot_terms[0]
        return self.recent_goal


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

    @property
    def personalization_hint(self) -> SupervisorPersonalizationHint:
        actor = self.context.actor
        visibility_scope = self.context.authorization.visibility_scope
        actor_claim_terms = tuple(
            term
            for term in (
                visibility_scope,
                actor.cohort,
                actor.major,
                actor.program,
            )
            if isinstance(term, str) and term.strip()
        )
        recent_goal = ""
        for item in self.context.profile_memory.items:
            if item.visibility != "user_visible":
                continue
            if item.key == "recent_goal":
                recent_goal = item.value
                break
        confirmed_slot_terms = tuple(
            slot.value
            for slot in self.context.session.confirmed_slots
            if slot.confirmed and slot.value.strip()
        )
        return SupervisorPersonalizationHint(
            actor_claim_terms=actor_claim_terms,
            recent_goal=recent_goal,
            confirmed_slot_terms=confirmed_slot_terms,
        )

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
