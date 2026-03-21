from __future__ import annotations

from typing import Protocol


JsonDict = dict[str, object]


class ContextStore(Protocol):
    def get_user_profile(self, user_id: str) -> JsonDict | None:
        """Return the latest profile payload for a user."""

    def get_user_preferences(self, user_id: str) -> JsonDict | None:
        """Return persisted user preferences."""

    def select_memories(self, user_id: str, *, query: str, limit: int) -> list[JsonDict]:
        """Return the selected memory subset for the current query."""

    def get_conversation_context(self, conversation_id: str) -> JsonDict | None:
        """Return compacted conversation context for a conversation."""
