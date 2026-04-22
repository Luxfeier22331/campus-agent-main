from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from campus_contracts import PromptTrace
from campus_shared import (
    PromptRuntimeValidationError,
    require_non_empty_output_text,
    validate_prompt_packet_contract,
    validate_prompt_trace_contract,
)

from campus_supervisor_core.prompt_packets import SupervisorPromptPacket
from campus_supervisor_core.prompts.registry import get_supervisor_prompt_spec


@dataclass(frozen=True, slots=True)
class SupervisorClarifyPromptOutput:
    follow_up_question: str


@dataclass(frozen=True, slots=True)
class SupervisorTerminalPromptOutput:
    answer_text: str


@dataclass(frozen=True, slots=True)
class SupervisorPromptExecutionResult[PromptOutputT]:
    output: PromptOutputT
    prompt_trace: PromptTrace


class SupervisorPromptExecutor(Protocol):
    def compose_clarify(
        self,
        packet: SupervisorPromptPacket,
    ) -> SupervisorPromptExecutionResult[SupervisorClarifyPromptOutput]: ...

    def compose_approval_required(
        self,
        packet: SupervisorPromptPacket,
    ) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]: ...

    def compose_out_of_scope(
        self,
        packet: SupervisorPromptPacket,
    ) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]: ...

    def compose_reject(
        self,
        packet: SupervisorPromptPacket,
    ) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]: ...


class StrictValidatedSupervisorPromptExecutor:
    def __init__(self, delegate: SupervisorPromptExecutor) -> None:
        self._delegate = delegate

    def compose_clarify(
        self,
        packet: SupervisorPromptPacket,
    ) -> SupervisorPromptExecutionResult[SupervisorClarifyPromptOutput]:
        spec = get_supervisor_prompt_spec(packet.prompt_id)
        validate_prompt_packet_contract(packet=packet, spec=spec)
        execution = self._delegate.compose_clarify(packet)
        if not isinstance(execution.output, SupervisorClarifyPromptOutput):
            raise PromptRuntimeValidationError(
                prompt_id=spec.prompt_id,
                reason="clarify output type mismatch",
            )
        require_non_empty_output_text(
            prompt_id=spec.prompt_id,
            field_name="follow_up_question",
            value=execution.output.follow_up_question,
        )
        _validate_prompt_trace(execution.prompt_trace, prompt_id=spec.prompt_id)
        validate_prompt_trace_contract(prompt_trace=execution.prompt_trace, spec=spec)
        return execution

    def compose_approval_required(
        self,
        packet: SupervisorPromptPacket,
    ) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]:
        return self._compose_terminal(packet, self._delegate.compose_approval_required)

    def compose_out_of_scope(
        self,
        packet: SupervisorPromptPacket,
    ) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]:
        return self._compose_terminal(packet, self._delegate.compose_out_of_scope)

    def compose_reject(
        self,
        packet: SupervisorPromptPacket,
    ) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]:
        return self._compose_terminal(packet, self._delegate.compose_reject)

    def _compose_terminal(
        self,
        packet: SupervisorPromptPacket,
        compose: Callable[
            [SupervisorPromptPacket],
            SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput],
        ],
    ) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]:
        spec = get_supervisor_prompt_spec(packet.prompt_id)
        validate_prompt_packet_contract(packet=packet, spec=spec)
        execution = compose(packet)
        if not isinstance(execution.output, SupervisorTerminalPromptOutput):
            raise PromptRuntimeValidationError(
                prompt_id=spec.prompt_id,
                reason="terminal output type mismatch",
            )
        require_non_empty_output_text(
            prompt_id=spec.prompt_id,
            field_name="answer_text",
            value=execution.output.answer_text,
        )
        _validate_prompt_trace(execution.prompt_trace, prompt_id=spec.prompt_id)
        validate_prompt_trace_contract(prompt_trace=execution.prompt_trace, spec=spec)
        return execution


def wrap_supervisor_prompt_executor(
    prompt_executor: SupervisorPromptExecutor | None,
) -> SupervisorPromptExecutor | None:
    if prompt_executor is None or isinstance(
        prompt_executor, StrictValidatedSupervisorPromptExecutor
    ):
        return prompt_executor
    return StrictValidatedSupervisorPromptExecutor(prompt_executor)


def _validate_prompt_trace(prompt_trace: object, *, prompt_id: str) -> PromptTrace:
    if not isinstance(prompt_trace, PromptTrace):
        raise PromptRuntimeValidationError(
            prompt_id=prompt_id,
            reason="prompt_trace type mismatch",
        )
    return prompt_trace


__all__ = [
    "SupervisorClarifyPromptOutput",
    "SupervisorPromptExecutionResult",
    "SupervisorPromptExecutor",
    "StrictValidatedSupervisorPromptExecutor",
    "SupervisorTerminalPromptOutput",
    "wrap_supervisor_prompt_executor",
]
