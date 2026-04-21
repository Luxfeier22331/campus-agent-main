from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Generic, Protocol, TypeVar

from campus_contracts import PromptTrace
from campus_shared import (
    NormalizedProviderGroundingSupport,
    PromptRuntimeValidationError,
    require_non_empty_output_text,
    validate_prompt_packet_contract,
    validate_prompt_trace_contract,
)

from campus_rag_agent.prompt_packets import RagPromptPacket
from campus_rag_agent.prompts.registry import get_rag_prompt_spec


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
    provider_grounding_supports: tuple[NormalizedProviderGroundingSupport, ...] = ()


class RagPromptExecutor(Protocol):
    def compose_clarify(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagClarifyPromptOutput]: ...

    def compose_no_answer(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagAnswerPromptOutput]: ...

    def compose_answer(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagAnswerPromptOutput]: ...


class StrictValidatedRagPromptExecutor:
    def __init__(self, delegate: RagPromptExecutor) -> None:
        self._delegate = delegate

    def compose_clarify(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
        spec = get_rag_prompt_spec(packet.prompt_id)
        validate_prompt_packet_contract(packet=packet, spec=spec)
        execution = self._delegate.compose_clarify(packet)
        if not isinstance(execution.output, RagClarifyPromptOutput):
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

    def compose_no_answer(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
        return self._compose_answer_like(packet, self._delegate.compose_no_answer)

    def compose_answer(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
        return self._compose_answer_like(packet, self._delegate.compose_answer)

    def _compose_answer_like(
        self,
        packet: RagPromptPacket,
        compose: Callable[[RagPromptPacket], RagPromptExecutionResult[RagAnswerPromptOutput]],
    ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
        spec = get_rag_prompt_spec(packet.prompt_id)
        validate_prompt_packet_contract(packet=packet, spec=spec)
        execution = compose(packet)
        if not isinstance(execution.output, RagAnswerPromptOutput):
            raise PromptRuntimeValidationError(
                prompt_id=spec.prompt_id,
                reason="answer output type mismatch",
            )
        require_non_empty_output_text(
            prompt_id=spec.prompt_id,
            field_name="answer_text",
            value=execution.output.answer_text,
        )
        _validate_prompt_trace(execution.prompt_trace, prompt_id=spec.prompt_id)
        validate_prompt_trace_contract(prompt_trace=execution.prompt_trace, spec=spec)
        return execution


def wrap_rag_prompt_executor(
    prompt_executor: RagPromptExecutor | None,
) -> RagPromptExecutor | None:
    if prompt_executor is None or isinstance(prompt_executor, StrictValidatedRagPromptExecutor):
        return prompt_executor
    return StrictValidatedRagPromptExecutor(prompt_executor)


def _validate_prompt_trace(prompt_trace: object, *, prompt_id: str) -> PromptTrace:
    if not isinstance(prompt_trace, PromptTrace):
        raise PromptRuntimeValidationError(
            prompt_id=prompt_id,
            reason="prompt_trace type mismatch",
        )
    return prompt_trace


__all__ = [
    "RagAnswerPromptOutput",
    "RagClarifyPromptOutput",
    "RagPromptExecutionResult",
    "RagPromptExecutor",
    "StrictValidatedRagPromptExecutor",
    "wrap_rag_prompt_executor",
]
