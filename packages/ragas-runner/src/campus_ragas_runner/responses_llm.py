from __future__ import annotations

from typing import TypeVar

from openai import AsyncOpenAI, OpenAI
from pydantic import BaseModel
from ragas.llms.base import InstructorBaseRagasLLM

T = TypeVar("T")

RAGAS_MAX_OUTPUT_TOKENS = 1024
RAGAS_USER_AGENT = "campus-ragas-runner/0.1"


class ResponsesRagasLLM(InstructorBaseRagasLLM):
    """Ragas structured-output LLM backed by the Responses API."""

    def __init__(
        self,
        *,
        client: OpenAI,
        async_client: AsyncOpenAI,
        model: str,
    ) -> None:
        self.model = model
        self._client = client
        self._async_client = async_client

    def generate(self, prompt: str, response_model: type[T]) -> T:
        response = self._client.responses.create(
            **_request_parameters(prompt, self.model, response_model),
        )
        return _parse_response(response.output_text, response_model)

    async def agenerate(self, prompt: str, response_model: type[T]) -> T:
        response = await self._async_client.responses.create(
            **_request_parameters(prompt, self.model, response_model),
        )
        return _parse_response(response.output_text, response_model)


def _request_parameters[T: BaseModel](
    prompt: str,
    model: str,
    response_model: type[T],
) -> dict[str, object]:
    if not issubclass(response_model, BaseModel):
        raise TypeError("response_model must be a Pydantic BaseModel")
    return {
        "input": prompt,
        "model": model,
        "temperature": 0,
        "max_output_tokens": RAGAS_MAX_OUTPUT_TOKENS,
        "text": {
            "format": {
                "type": "json_schema",
                "name": response_model.__name__,
                "strict": True,
                "schema": response_model.model_json_schema(),
            }
        },
    }


def _parse_response[T: BaseModel](output_text: str, response_model: type[T]) -> T:
    if not issubclass(response_model, BaseModel):
        raise TypeError("response_model must be a Pydantic BaseModel")
    return response_model.model_validate_json(output_text)
