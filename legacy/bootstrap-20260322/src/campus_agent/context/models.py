from __future__ import annotations

from dataclasses import dataclass, field


JsonDict = dict[str, object]
_AUDIENCE_PROFILE_KEYS = (
    "primary_affiliation",
    "org_units",
    "academic_stage",
    "campus_scope",
    "source",
    "confidence",
)
_MEMORY_FACT_KEYS = (
    "fact_type",
    "value",
    "source",
    "confidence",
    "expires_at",
)
_PRESENTATION_PREFERENCE_KEYS = ("language", "response_style")


@dataclass(slots=True)
class PreConversationContext:
    actor_snapshot: JsonDict = field(default_factory=dict)
    profile: JsonDict = field(default_factory=dict)
    preferences: JsonDict = field(default_factory=dict)
    conversation_summary: str = ""
    selected_memories: list[JsonDict] = field(default_factory=list)

    def to_dict(self) -> JsonDict:
        return {
            "actor_snapshot": dict(self.actor_snapshot),
            "profile": dict(self.profile),
            "preferences": dict(self.preferences),
            "conversation_summary": self.conversation_summary,
            "selected_memories": [dict(item) for item in self.selected_memories],
        }

    @classmethod
    def from_dict(cls, data: JsonDict | None) -> "PreConversationContext":
        payload = data or {}
        return cls(
            actor_snapshot=dict(payload.get("actor_snapshot") or {}),
            profile=dict(payload.get("profile") or {}),
            preferences=dict(payload.get("preferences") or {}),
            conversation_summary=str(payload.get("conversation_summary") or ""),
            selected_memories=[dict(item) for item in list(payload.get("selected_memories") or [])],
        )

    def to_request_context(self) -> JsonDict:
        request_context: JsonDict = {}
        audience_profile = _compact_mapping(_subset_mapping(self.profile, _AUDIENCE_PROFILE_KEYS))
        if audience_profile:
            request_context["audience_profile"] = audience_profile

        memory_facts: list[JsonDict] = []
        for memory in self.selected_memories:
            fact = _compact_mapping(_subset_mapping(memory, _MEMORY_FACT_KEYS))
            if fact.get("fact_type") and fact.get("value"):
                memory_facts.append(fact)
        if memory_facts:
            request_context["memory_facts"] = memory_facts

        presentation_preferences: JsonDict = {}
        for key in _PRESENTATION_PREFERENCE_KEYS:
            value = self.preferences.get(key)
            if value in (None, "", [], {}):
                continue
            presentation_preferences[key] = value
        if presentation_preferences:
            request_context["presentation_preferences"] = presentation_preferences
        return request_context

    def to_context_refs(self) -> JsonDict:
        refs: JsonDict = {}
        profile_source = str(self.profile.get("source") or self.profile.get("source_system") or "").strip()
        if profile_source:
            refs["profile_source"] = profile_source
        if "profile_version" in self.profile:
            refs["profile_version"] = self.profile["profile_version"]
        memory_ids = [
            str(item.get("memory_id") or "").strip()
            for item in self.selected_memories
            if str(item.get("memory_id") or "").strip()
        ]
        if memory_ids:
            refs["selected_memory_ids"] = memory_ids
        fact_types = sorted(
            {
                str(item.get("fact_type") or "").strip()
                for item in self.selected_memories
                if str(item.get("fact_type") or "").strip()
            }
        )
        if fact_types:
            refs["selected_memory_fact_types"] = fact_types
            refs["selected_memory_count"] = len(self.selected_memories)
        if self.preferences:
            refs["preference_keys"] = sorted(str(key) for key in self.preferences.keys())
        return refs


def _compact_mapping(raw: JsonDict) -> JsonDict:
    out: JsonDict = {}
    for key, value in dict(raw or {}).items():
        if value in (None, "", [], {}):
            continue
        out[str(key)] = value
    return out


def _subset_mapping(raw: JsonDict, allowed_keys: tuple[str, ...]) -> JsonDict:
    payload = dict(raw or {})
    return {
        key: payload[key]
        for key in allowed_keys
        if key in payload
    }
