from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Protocol, TypeVar

from campus_contracts import PromptTrace

from campus_rag_specialist.prompt_packets import RagPromptPacket


@dataclass(frozen=True, slots=True)
class RagClarifyPromptOutput:
    follow_up_question: str


@dataclass(frozen=True, slots=True)
class RagAnswerPromptOutput:
    answer_text: str


PromptOutputT = TypeVar("PromptOutputT")


@dataclass(frozen=True, slots=True)
class RagPromptExecutionResult(Generic[PromptOutputT]):
    output: PromptOutputT
    prompt_trace: PromptTrace


class RagPromptExecutor(Protocol):
    def compose_clarify(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
        ...

    def compose_no_answer(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
        ...

    def compose_answer(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
        ...


__all__ = [
    "RagAnswerPromptOutput",
    "RagClarifyPromptOutput",
    "RagPromptExecutionResult",
    "RagPromptExecutor",
]
