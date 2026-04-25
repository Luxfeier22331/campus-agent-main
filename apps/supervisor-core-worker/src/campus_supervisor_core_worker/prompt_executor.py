from __future__ import annotations

import httpx
from campus_rag_agent.prompt_execution import (
    RagAnswerPromptOutput,
    RagClarifyPromptOutput,
    RagPromptExecutionResult,
)
from campus_rag_agent.prompt_packets import RagPromptPacket
from campus_rag_agent.prompts.registry import get_rag_prompt_spec
from campus_shared import (
    PromptRuntimeProviderConfig,
    ResponsesStructuredOutputExecutor,
    build_prompt_trace,
)
from pydantic import BaseModel, ConfigDict

from campus_supervisor_core_worker.prompt_stack import (
    build_rag_prompt_stack,
)


class _FollowUpQuestionModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    follow_up_question: str


class _AnswerTextModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer_text: str


class ProviderBackedRagPromptExecutor:
    def __init__(
        self,
        *,
        provider_config: PromptRuntimeProviderConfig,
        model_name: str,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._provider_config = provider_config
        self._model_name = model_name
        self._structured_executor = ResponsesStructuredOutputExecutor(
            provider_config,
            http_client=http_client,
        )

    def compose_clarify(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
        spec = get_rag_prompt_spec(packet.prompt_id)
        stack = build_rag_prompt_stack(
            packet,
            provider=self._provider_config.provider,
            model_name=self._model_name,
        )
        parsed = self._structured_executor.execute(
            stack,
            response_model=_FollowUpQuestionModel,
            safety_identifier=packet.safety_identifier,
        )
        return RagPromptExecutionResult(
            output=RagClarifyPromptOutput(follow_up_question=parsed.follow_up_question),
            prompt_trace=build_prompt_trace(
                spec=spec,
                model_provider=stack.model_provider,
                model_name=stack.model_name,
            ),
        )

    def compose_no_answer(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
        return self._compose_answer_like(packet)

    def compose_answer(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
        return self._compose_answer_like(packet)

    def _compose_answer_like(
        self,
        packet: RagPromptPacket,
    ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
        spec = get_rag_prompt_spec(packet.prompt_id)
        stack = build_rag_prompt_stack(
            packet,
            provider=self._provider_config.provider,
            model_name=self._model_name,
        )
        execution = self._structured_executor.execute_with_metadata(
            stack,
            response_model=_AnswerTextModel,
            safety_identifier=packet.safety_identifier,
        )
        return RagPromptExecutionResult(
            output=RagAnswerPromptOutput(answer_text=execution.output.answer_text),
            prompt_trace=build_prompt_trace(
                spec=spec,
                model_provider=stack.model_provider,
                model_name=stack.model_name,
            ),
            provider_grounding_supports=execution.provider_grounding_supports,
        )


__all__ = [
    "ProviderBackedRagPromptExecutor",
]
