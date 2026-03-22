from __future__ import annotations

from dataclasses import dataclass
import os

from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.core.embeddings.mock_embed_model import MockEmbedding
from llama_index.embeddings.openai import OpenAIEmbedding


@dataclass(frozen=True, slots=True)
class EmbeddingSettings:
    provider: str
    model: str
    api_key: str = ""
    api_base: str | None = None
    timeout_seconds: float = 60.0
    embed_batch_size: int = 100

    def __post_init__(self) -> None:
        if not self.provider:
            raise ValueError("embedding provider is required")
        if not self.model:
            raise ValueError("embedding model is required")
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
    ) -> "EmbeddingSettings":
        source = env if env is not None else os.environ
        model = (model_override or source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or "").strip()
        return cls(
            provider=(source.get("EMBEDDING_PROVIDER") or "openai").strip() or "openai",
            model=model,
            api_key=(source.get("EMBEDDING_API_KEY") or "").strip(),
            api_base=(source.get("EMBEDDING_BASE_URL") or "").strip() or None,
            timeout_seconds=float((source.get("EMBEDDING_TIMEOUT_SECONDS") or "60").strip()),
            embed_batch_size=int((source.get("EMBEDDING_BATCH_SIZE") or "100").strip()),
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
        return OpenAIEmbedding(
            model=settings.model,
            api_key=settings.api_key or None,
            api_base=settings.api_base,
            timeout=settings.timeout_seconds,
            embed_batch_size=settings.embed_batch_size,
            model_name=settings.model,
        )
    if provider == "mock":
        return MockEmbedding(embed_dim=1536, model_name=settings.model)
    raise ValueError(f"unsupported embedding provider: {settings.provider}")


def build_mock_embedding_model(settings: MockEmbeddingSettings | None = None) -> BaseEmbedding:
    resolved = settings or MockEmbeddingSettings()
    return MockEmbedding(embed_dim=resolved.embed_dim, model_name=resolved.model_name)
