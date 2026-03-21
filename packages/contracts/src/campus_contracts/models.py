from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class DelegateToRagAgentRequest:
    user_goal: str
    conversation_id: str = "bootstrap-conversation"


@dataclass(frozen=True, slots=True)
class DelegateToRagAgentResponse:
    status: str
    answer_text: str = ""
    sources: tuple[str, ...] = field(default_factory=tuple)
