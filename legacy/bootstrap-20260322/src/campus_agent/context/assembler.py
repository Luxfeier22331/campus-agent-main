from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from campus_agent.context.models import PreConversationContext
from campus_agent.context.store import ContextStore, JsonDict
from campus_agent.state.models import WorkflowActorContext


_MEMORY_FACT_TYPE_ALLOWLIST = {
    "major",
    "program",
    "academic_stage",
    "grade",
    "identity_type",
    "employment_role",
    "org_unit",
    "primary_affiliation",
}
_CONFIDENCE_RANK = {
    "authoritative": 3,
    "high": 2,
    "medium": 1,
}


@dataclass(slots=True)
class ContextAssembler:
    store: ContextStore | None = None
    memory_limit: int = 3
    memory_candidate_limit: int = 10

    def assemble(
        self,
        *,
        conversation_id: str,
        user_query: str,
        actor_context: WorkflowActorContext,
    ) -> PreConversationContext:
        snapshot = dict(actor_context.snapshot or {})
        profile = _mapping(snapshot.get("profile"))
        preferences = _mapping(snapshot.get("preferences"))
        selected_memories = _memory_list(snapshot.get("selected_memories") or snapshot.get("memories"))
        conversation_summary = str(snapshot.get("conversation_summary") or "")

        if self.store is not None and actor_context.user_id:
            stored_profile = self.store.get_user_profile(actor_context.user_id)
            if stored_profile:
                profile = dict(stored_profile)
            stored_preferences = self.store.get_user_preferences(actor_context.user_id)
            if stored_preferences:
                preferences = dict(stored_preferences)
            stored_memories = self.store.select_memories(
                actor_context.user_id,
                query=user_query,
                limit=self.memory_candidate_limit,
            )
            if stored_memories:
                selected_memories = [dict(item) for item in stored_memories]
        if self.store is not None:
            conversation_context = self.store.get_conversation_context(conversation_id)
            if conversation_context and conversation_context.get("summary"):
                conversation_summary = str(conversation_context.get("summary") or "")

        selected_memories = _select_memories(
            selected_memories,
            query=user_query,
            limit=self.memory_limit,
        )

        return PreConversationContext(
            actor_snapshot=actor_context.to_actor_snapshot(),
            profile=profile,
            preferences=preferences,
            conversation_summary=conversation_summary,
            selected_memories=selected_memories,
        )


def _mapping(raw: object) -> JsonDict:
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def _memory_list(raw: object) -> list[JsonDict]:
    if not isinstance(raw, list):
        return []
    return [dict(item) for item in raw if isinstance(item, dict)]


def _select_memories(raw_memories: list[JsonDict], *, query: str, limit: int) -> list[JsonDict]:
    ranked: list[tuple[tuple[int, int, int, int], JsonDict]] = []
    seen: set[tuple[str, str]] = set()
    query_norm = _normalize_text(query)
    for idx, memory in enumerate(raw_memories):
        cleaned = dict(memory)
        fact_type = str(cleaned.get("fact_type") or "").strip()
        value = str(cleaned.get("value") or "").strip()
        source = str(cleaned.get("source") or "").strip()
        if not fact_type or not value or not source:
            continue
        if fact_type not in _MEMORY_FACT_TYPE_ALLOWLIST:
            continue
        if _is_expired(cleaned.get("expires_at")):
            continue
        confidence = str(cleaned.get("confidence") or "").strip().lower()
        confidence_rank = _CONFIDENCE_RANK.get(confidence, 0)
        if confidence_rank <= 0:
            continue
        dedupe_key = (fact_type, _normalize_text(value))
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        ranked.append(
            (
                (
                    _relevance_score(query_norm, value),
                    _fact_type_rank(fact_type),
                    confidence_rank,
                    -idx,
                ),
                cleaned,
            )
        )
    ranked.sort(reverse=True)
    return [item for _, item in ranked[: max(1, int(limit))]]


def _fact_type_rank(fact_type: str) -> int:
    if fact_type in {"major", "program", "org_unit"}:
        return 3
    if fact_type in {"academic_stage", "grade"}:
        return 2
    return 1


def _relevance_score(query_norm: str, value: str) -> int:
    value_norm = _normalize_text(value)
    if not query_norm or not value_norm:
        return 0
    if value_norm in query_norm or query_norm in value_norm:
        return 3
    overlap = set(value_norm) & set(query_norm)
    if overlap:
        return 1
    return 0


def _normalize_text(value: object) -> str:
    return "".join(str(value or "").strip().lower().split())


def _is_expired(value: object) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    normalized = text.replace("Z", "+00:00")
    try:
        expires_at = datetime.fromisoformat(normalized)
    except ValueError:
        return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at <= datetime.now(timezone.utc)
