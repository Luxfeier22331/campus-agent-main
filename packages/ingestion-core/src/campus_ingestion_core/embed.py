from __future__ import annotations

import os
from dataclasses import dataclass

import httpx
from llama_index.core.base.embeddings.base import BaseEmbedding, Embedding
from llama_index.core.callbacks.base import CallbackManager
from llama_index.core.embeddings.mock_embed_model import MockEmbedding
from llama_index.embeddings.openai import OpenAIEmbedding
from openai import AsyncOpenAI, OpenAI

DEFAULT_EMBEDDING_PROVIDER = "gitee"
DEFAULT_EMBEDDING_MODEL = "Qwen3-Embedding-4B"
DEFAULT_EMBEDDING_TIMEOUT_SECONDS = 60.0
DEFAULT_EMBED_BATCH_SIZE = 100
DEFAULT_QWEN3_EMBEDDING_DIMENSIONS = 2560


def _build_openai_http_client(*, timeout_seconds: float) -> httpx.Client:
    return httpx.Client(timeout=timeout_seconds, trust_env=False)


def _build_openai_async_http_client(*, timeout_seconds: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout_seconds, trust_env=False)


class OpenAICompatibleEmbedding(BaseEmbedding):
    api_key: str = ""
    api_base: str | None = None
    dimensions: int | None = None
    timeout_seconds: float = 60.0
    max_retries: int = 10

    def __init__(
        self,
        *,
        model: str,
        api_key: str = "",
        api_base: str | None = None,
        dimensions: int | None = None,
        timeout_seconds: float = 60.0,
        embed_batch_size: int = 100,
        max_retries: int = 10,
    ) -> None:
        super().__init__(
            model_name=model,
            embed_batch_size=embed_batch_size,
            callback_manager=CallbackManager([]),
        )
        self.api_key = api_key
        self.api_base = api_base
        self.dimensions = dimensions
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        sync_http_client = _build_openai_http_client(timeout_seconds=timeout_seconds)
        async_http_client = _build_openai_async_http_client(timeout_seconds=timeout_seconds)
        self._client = OpenAI(
            api_key=api_key or None,
            base_url=api_base,
            timeout=timeout_seconds,
            max_retries=max_retries,
            http_client=sync_http_client,
        )
        self._aclient = AsyncOpenAI(
            api_key=api_key or None,
            base_url=api_base,
            timeout=timeout_seconds,
            max_retries=max_retries,
            http_client=async_http_client,
        )

    def _build_payload(self, texts: list[str]) -> dict[str, object]:
        payload: dict[str, object] = {"input": texts, "model": self.model_name}
        if self.dimensions is not None:
            payload["dimensions"] = self.dimensions
        return payload

    def _create_embedding(self, text: str) -> Embedding:
        response = self._client.embeddings.create(**self._build_payload([text]))
        return [float(item) for item in response.data[0].embedding]

    def _create_embeddings(self, texts: list[str]) -> list[Embedding]:
        if not texts:
            return []
        try:
            response = self._client.embeddings.create(**self._build_payload(texts))
        except Exception:
            if len(texts) <= 1:
                raise
            midpoint = len(texts) // 2
            return [
                *self._create_embeddings(texts[:midpoint]),
                *self._create_embeddings(texts[midpoint:]),
            ]
        return [[float(item) for item in record.embedding] for record in response.data]

    def _get_query_embedding(self, query: str) -> Embedding:
        return self._create_embedding(query)

    async def _aget_query_embedding(self, query: str) -> Embedding:
        response = await self._aclient.embeddings.create(**self._build_payload([query]))
        return [float(item) for item in response.data[0].embedding]

    def _get_text_embedding(self, text: str) -> Embedding:
        return self._create_embedding(text)

    def _get_text_embeddings(self, texts: list[str]) -> list[Embedding]:
        return self._create_embeddings(texts)


@dataclass(frozen=True, slots=True)
class EmbeddingSettings:
    provider: str
    model: str
    api_key: str = ""
    api_base: str | None = None
    dimensions: int | None = None
    timeout_seconds: float = DEFAULT_EMBEDDING_TIMEOUT_SECONDS
    embed_batch_size: int = DEFAULT_EMBED_BATCH_SIZE

    def __post_init__(self) -> None:
        if not self.provider:
            raise ValueError("embedding provider is required")
        if not self.model:
            raise ValueError("embedding model is required")
        if self.dimensions is None:
            resolved_dimensions = _resolve_embedding_dimensions(model=self.model, raw_dimensions="")
            if resolved_dimensions is not None:
                object.__setattr__(self, "dimensions", resolved_dimensions)
        if self.dimensions is not None and self.dimensions <= 0:
            raise ValueError("embedding dimensions must be greater than zero")
        if self.timeout_seconds <= 0:
            raise ValueError("embedding timeout must be greater than zero")
        if self.embed_batch_size <= 0:
            raise ValueError("embed_batch_size must be greater than zero")

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
        *,
        model_override: str | None = None,
    ) -> EmbeddingSettings:
        source = env if env is not None else os.environ
        model = (
            model_override
            or source.get("INGESTION_EMBEDDING_MODEL")
            or source.get("EMBEDDING_MODEL")
            or DEFAULT_EMBEDDING_MODEL
        ).strip()
        dimensions = _resolve_embedding_dimensions(
            model=model,
            raw_dimensions=(
                source.get("INGESTION_EMBEDDING_DIMENSIONS")
                or source.get("EMBEDDING_DIMENSIONS")
                or ""
            ).strip(),
        )
        return cls(
            provider=(source.get("EMBEDDING_PROVIDER") or DEFAULT_EMBEDDING_PROVIDER).strip()
            or DEFAULT_EMBEDDING_PROVIDER,
            model=model,
            api_key=(source.get("EMBEDDING_API_KEY") or "").strip(),
            api_base=(source.get("EMBEDDING_BASE_URL") or "").strip() or None,
            dimensions=dimensions,
            timeout_seconds=float(
                (
                    source.get("EMBEDDING_TIMEOUT_SECONDS")
                    or str(DEFAULT_EMBEDDING_TIMEOUT_SECONDS)
                ).strip()
            ),
            embed_batch_size=int(
                (source.get("EMBEDDING_BATCH_SIZE") or str(DEFAULT_EMBED_BATCH_SIZE)).strip()
            ),
        )


@dataclass(frozen=True, slots=True)
class MockEmbeddingSettings:
    embed_dim: int = 1536
    model_name: str = "mock-embedding"

    def __post_init__(self) -> None:
        if self.embed_dim <= 0:
            raise ValueError("embed_dim must be greater than zero")


def build_embedding_model(settings: EmbeddingSettings) -> BaseEmbedding:
    provider = settings.provider.strip().lower()
    if provider == "openai":
        sync_http_client = _build_openai_http_client(timeout_seconds=settings.timeout_seconds)
        async_http_client = _build_openai_async_http_client(
            timeout_seconds=settings.timeout_seconds
        )
        kwargs = {
            "model": settings.model,
            "api_key": settings.api_key or None,
            "api_base": settings.api_base,
            "timeout": settings.timeout_seconds,
            "embed_batch_size": settings.embed_batch_size,
            "model_name": settings.model,
            "http_client": sync_http_client,
            "async_http_client": async_http_client,
        }
        if settings.dimensions is not None:
            kwargs["dimensions"] = settings.dimensions
        return OpenAIEmbedding(
            **kwargs,
        )
    if provider == "gitee":
        return OpenAICompatibleEmbedding(
            model=settings.model,
            api_key=settings.api_key,
            api_base=settings.api_base,
            dimensions=settings.dimensions,
            timeout_seconds=settings.timeout_seconds,
            embed_batch_size=settings.embed_batch_size,
        )
    if provider == "mock":
        return MockEmbedding(embed_dim=settings.dimensions or 1536, model_name=settings.model)
    raise ValueError(f"unsupported embedding provider: {settings.provider}")


def build_mock_embedding_model(settings: MockEmbeddingSettings | None = None) -> BaseEmbedding:
    resolved = settings or MockEmbeddingSettings()
    return MockEmbedding(embed_dim=resolved.embed_dim, model_name=resolved.model_name)


def validate_ingestion_retrieval_embedding_env_alignment(source: dict[str, str]) -> None:
    ingestion_settings = EmbeddingSettings.from_env(source)
    retrieval_model = _resolve_retrieval_embedding_model(source)
    if ingestion_settings.model != retrieval_model:
        raise ValueError(
            "embedding model mismatch between INGESTION_EMBEDDING_MODEL "
            f"({ingestion_settings.model}) and EMBEDDING_MODEL ({retrieval_model})"
        )
    retrieval_dimensions = _resolve_retrieval_embedding_dimensions(source)
    if ingestion_settings.dimensions != retrieval_dimensions:
        raise ValueError(
            "embedding dimensions mismatch between INGESTION_EMBEDDING_DIMENSIONS "
            f"({ingestion_settings.dimensions}) and EMBEDDING_DIMENSIONS ({retrieval_dimensions})"
        )


def _resolve_retrieval_embedding_model(source: dict[str, str]) -> str:
    return (source.get("EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL).strip()


def _resolve_retrieval_embedding_dimensions(source: dict[str, str]) -> int | None:
    return _resolve_embedding_dimensions(
        model=_resolve_retrieval_embedding_model(source),
        raw_dimensions=(source.get("EMBEDDING_DIMENSIONS") or "").strip(),
    )


def _resolve_embedding_dimensions(*, model: str, raw_dimensions: str) -> int | None:
    if raw_dimensions:
        return int(raw_dimensions)
    if model == DEFAULT_EMBEDDING_MODEL:
        # The accepted Qwen3 baseline uses native-width vectors instead of the API compatibility default.
        return DEFAULT_QWEN3_EMBEDDING_DIMENSIONS
    return None
