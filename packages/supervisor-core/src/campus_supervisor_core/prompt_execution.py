from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Protocol, TypeVar

from campus_contracts import PromptTrace

from campus_supervisor_core.prompt_packets import SupervisorPromptPacket


@dataclass(frozen=True, slots=True)
class SupervisorClarifyPromptOutput:
    follow_up_question: str


@dataclass(frozen=True, slots=True)
class SupervisorTerminalPromptOutput:
    answer_text: str


PromptOutputT = TypeVar("PromptOutputT")


@dataclass(frozen=True, slots=True)
class SupervisorPromptExecutionResult(Generic[PromptOutputT]):
    output: PromptOutputT
    prompt_trace: PromptTrace


class SupervisorPromptExecutor(Protocol):
    def compose_clarify(
        self,
        packet: SupervisorPromptPacket,
    ) -> SupervisorPromptExecutionResult[SupervisorClarifyPromptOutput]:
        ...

    def compose_approval_required(
        self,
        packet: SupervisorPromptPacket,
    ) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]:
        ...

    def compose_reject(
        self,
        packet: SupervisorPromptPacket,
    ) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]:
        ...


__all__ = [
    "SupervisorClarifyPromptOutput",
    "SupervisorPromptExecutionResult",
    "SupervisorPromptExecutor",
    "SupervisorTerminalPromptOutput",
]
