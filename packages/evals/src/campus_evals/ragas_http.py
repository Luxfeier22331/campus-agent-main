from __future__ import annotations

import json
import typing as t

import httpx
from langchain_core.outputs import Generation, LLMResult
from ragas.embeddings.base import BaseRagasEmbeddings
from ragas.llms.base import BaseRagasLLM

from campus_evals.settings import RagasSettings


class OpenAICompatibleResponsesLLM(BaseRagasLLM):
    """Minimal Responses API client for ragas judge calls.

    Some OpenAI-compatible providers accept raw `/v1/responses` HTTP payloads while
    rejecting the same call shape when it comes through the OpenAI Python SDK stack.
    This client keeps the request surface minimal and SDK-free.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float,
        cache=None,
        sync_client: httpx.Client | None = None,
        async_client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(cache=cache)
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self._sync_client = sync_client
        self._async_client = async_client

    def generate_text(
        self,
        prompt,
        n: int = 1,
        temperature: float = 0.01,
        stop: list[str] | None = None,
        callbacks=None,
    ) -> LLMResult:
        generations = [
            Generation(
                text=_extract_output_text(
                    self._post_json_sync(
                        "/responses",
                        _build_responses_payload(
                            model=self.model,
                            prompt=prompt,
                            temperature=temperature,
                        ),
                    )
                ),
                generation_info={"finish_reason": "stop"},
            )
            for _ in range(n)
        ]
        return LLMResult(
            generations=[generations],
            llm_output={"provider": "responses_http", "model": self.model},
        )

    async def agenerate_text(
        self,
        prompt,
        n: int = 1,
        temperature: float | None = 0.01,
        stop: list[str] | None = None,
        callbacks=None,
    ) -> LLMResult:
        generations: list[Generation] = []
        for _ in range(n):
            response_json = await self._post_json_async(
                "/responses",
                _build_responses_payload(
                    model=self.model,
                    prompt=prompt,
                    temperature=temperature,
                ),
            )
            generations.append(
                Generation(
                    text=_extract_output_text(response_json),
                    generation_info={"finish_reason": "stop"},
                )
            )
        return LLMResult(
            generations=[generations],
            llm_output={"provider": "responses_http", "model": self.model},
        )

    def is_finished(self, response: LLMResult) -> bool:
        return True

    def _post_json_sync(self, path: str, payload: dict[str, t.Any]) -> dict[str, t.Any]:
        if self._sync_client is not None:
            response = self._sync_client.post(path, json=payload, headers=_build_headers(self.api_key))
        else:
            with httpx.Client(base_url=self.base_url, timeout=self.timeout) as client:
                response = client.post(path, json=payload, headers=_build_headers(self.api_key))
        return _decode_json_response(response)

    async def _post_json_async(self, path: str, payload: dict[str, t.Any]) -> dict[str, t.Any]:
        if self._async_client is not None:
            response = await self._async_client.post(path, json=payload, headers=_build_headers(self.api_key))
        else:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
                response = await client.post(path, json=payload, headers=_build_headers(self.api_key))
        return _decode_json_response(response)


class OpenAICompatibleHTTPEmbeddings(BaseRagasEmbeddings):
    """Minimal embeddings client for OpenAI-compatible HTTP providers."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float,
        dimensions: int | None = None,
        cache=None,
        sync_client: httpx.Client | None = None,
        async_client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(cache=cache)
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.dimensions = dimensions
        self._sync_client = sync_client
        self._async_client = async_client

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        payload = _build_embeddings_payload(
            model=self.model,
            texts=texts,
            dimensions=self.dimensions,
        )
        if self._sync_client is not None:
            response = self._sync_client.post("/embeddings", json=payload, headers=_build_headers(self.api_key))
        else:
            with httpx.Client(base_url=self.base_url, timeout=self.timeout) as client:
                response = client.post("/embeddings", json=payload, headers=_build_headers(self.api_key))
        return _extract_embeddings(_decode_json_response(response))

    async def aembed_query(self, text: str) -> list[float]:
        return (await self.aembed_documents([text]))[0]

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        payload = _build_embeddings_payload(
            model=self.model,
            texts=texts,
            dimensions=self.dimensions,
        )
        if self._async_client is not None:
            response = await self._async_client.post("/embeddings", json=payload, headers=_build_headers(self.api_key))
        else:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
                response = await client.post("/embeddings", json=payload, headers=_build_headers(self.api_key))
        return _extract_embeddings(_decode_json_response(response))


def build_http_ragas_llm(
    settings: RagasSettings,
    *,
    sync_client: httpx.Client | None = None,
    async_client: httpx.AsyncClient | None = None,
) -> OpenAICompatibleResponsesLLM:
    return OpenAICompatibleResponsesLLM(
        base_url=settings.llm_base_url or "https://api.openai.com/v1",
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        timeout=settings.request_timeout_seconds,
        sync_client=sync_client,
        async_client=async_client,
    )


def build_http_ragas_embeddings(
    settings: RagasSettings,
    *,
    sync_client: httpx.Client | None = None,
    async_client: httpx.AsyncClient | None = None,
) -> OpenAICompatibleHTTPEmbeddings:
    return OpenAICompatibleHTTPEmbeddings(
        base_url=settings.embedding_base_url or settings.llm_base_url or "https://api.openai.com/v1",
        api_key=settings.embedding_api_key,
        model=settings.embedding_model,
        timeout=settings.request_timeout_seconds,
        dimensions=settings.embedding_dimensions,
        sync_client=sync_client,
        async_client=async_client,
    )


def _build_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _build_responses_payload(
    *,
    model: str,
    prompt,
    temperature: float | None,
) -> dict[str, t.Any]:
    payload: dict[str, t.Any] = {
        "model": model,
        "stream": False,
        "input": _prompt_to_responses_input(prompt),
    }
    if temperature is not None:
        payload["temperature"] = temperature
    return payload


def _build_embeddings_payload(
    *,
    model: str,
    texts: list[str],
    dimensions: int | None,
) -> dict[str, t.Any]:
    payload: dict[str, t.Any] = {
        "model": model,
        "input": texts,
    }
    if dimensions is not None:
        payload["dimensions"] = dimensions
    return payload


def _prompt_to_responses_input(prompt) -> list[dict[str, t.Any]]:
    messages = prompt.to_messages()
    items: list[dict[str, t.Any]] = []
    for message in messages:
        role = _message_role(message)
        items.append(
            {
                "role": role,
                "type": "message",
                "content": _message_content_to_text(getattr(message, "content", "")),
            }
        )
    return items


def _message_role(message) -> str:
    message_type = getattr(message, "type", "human")
    if message_type == "human":
        return "user"
    if message_type == "ai":
        return "assistant"
    if message_type == "system":
        return "system"
    return "user"


def _message_content_to_text(content: t.Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(part for part in parts if part)
    return str(content)


def _decode_json_response(response: httpx.Response) -> dict[str, t.Any]:
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(f"{response.status_code} {response.text}") from exc
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("provider response must be a JSON object")
    error = payload.get("error")
    if error:
        raise RuntimeError(json.dumps(error, ensure_ascii=False))
    return payload


def _extract_output_text(payload: dict[str, t.Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text
    texts: list[str] = []
    for output_item in payload.get("output", []):
        if not isinstance(output_item, dict):
            continue
        for content_item in output_item.get("content", []):
            if not isinstance(content_item, dict):
                continue
            text = content_item.get("text")
            if isinstance(text, str) and text:
                texts.append(text)
    if texts:
        return "\n".join(texts)
    raise ValueError("responses payload did not contain output text")


def _extract_embeddings(payload: dict[str, t.Any]) -> list[list[float]]:
    raw_data = payload.get("data")
    if not isinstance(raw_data, list):
        raise ValueError("embeddings payload missing data array")
    items: list[tuple[int, list[float]]] = []
    for item in raw_data:
        if not isinstance(item, dict):
            continue
        index = item.get("index")
        embedding = item.get("embedding")
        if isinstance(index, int) and isinstance(embedding, list):
            items.append((index, [float(value) for value in embedding]))
    if not items:
        raise ValueError("embeddings payload did not contain embedding vectors")
    return [embedding for _, embedding in sorted(items, key=lambda pair: pair[0])]
