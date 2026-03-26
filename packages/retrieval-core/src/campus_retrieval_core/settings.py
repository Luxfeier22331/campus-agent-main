from __future__ import annotations

from dataclasses import dataclass
import os
from urllib.parse import urlparse


DEFAULT_QDRANT_COLLECTION = "student_handbook"
DEFAULT_QDRANT_TIMEOUT_SECONDS = 10.0
DEFAULT_EMBEDDING_PROVIDER = "gitee"
DEFAULT_EMBEDDING_MODEL = "Qwen3-Embedding-4B"


@dataclass(frozen=True, slots=True)
class RetrievalSettings:
    qdrant_url: str
    qdrant_collection: str = DEFAULT_QDRANT_COLLECTION
    qdrant_api_key: str | None = None
    qdrant_timeout_seconds: float = DEFAULT_QDRANT_TIMEOUT_SECONDS
    document_registry_database_url: str = ""
    embedding_provider: str = DEFAULT_EMBEDDING_PROVIDER
    embedding_model: str = DEFAULT_EMBEDDING_MODEL
    embedding_api_key: str = ""
    embedding_base_url: str | None = None
    embedding_dimensions: int | None = None

    def __post_init__(self) -> None:
        if self.embedding_dimensions is None and self.embedding_model == "Qwen3-Embedding-4B":
            object.__setattr__(self, "embedding_dimensions", 2560)
        if self.qdrant_url != ":memory:":
            parsed = urlparse(self.qdrant_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("QDRANT_URL must be http(s) or :memory:")
        if not self.qdrant_collection:
            raise ValueError("QDRANT_COLLECTION is required")
        if self.qdrant_timeout_seconds <= 0:
            raise ValueError("QDRANT_TIMEOUT_SECONDS must be greater than zero")
        if not self.embedding_provider:
            raise ValueError("EMBEDDING_PROVIDER is required")
        if not self.embedding_model:
            raise ValueError("EMBEDDING_MODEL is required")
        if self.embedding_dimensions is not None and self.embedding_dimensions <= 0:
            raise ValueError("EMBEDDING_DIMENSIONS must be greater than zero")
        if self.document_registry_database_url:
            parsed_registry = urlparse(self.document_registry_database_url)
            if parsed_registry.scheme not in {"postgresql", "postgres"}:
                raise ValueError("DOCUMENT_REGISTRY_DATABASE_URL must be a postgres URL")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "RetrievalSettings":
        source = env if env is not None else os.environ
        return cls(
            qdrant_url=(source.get("QDRANT_URL") or "http://localhost:6333").strip(),
            qdrant_collection=(source.get("QDRANT_COLLECTION") or DEFAULT_QDRANT_COLLECTION).strip(),
            qdrant_api_key=(source.get("QDRANT_API_KEY") or "").strip() or None,
            qdrant_timeout_seconds=float(
                (source.get("QDRANT_TIMEOUT_SECONDS") or str(DEFAULT_QDRANT_TIMEOUT_SECONDS)).strip()
            ),
            document_registry_database_url=(
                source.get("DOCUMENT_REGISTRY_DATABASE_URL") or ""
            ).strip(),
            embedding_provider=(source.get("EMBEDDING_PROVIDER") or DEFAULT_EMBEDDING_PROVIDER).strip()
            or DEFAULT_EMBEDDING_PROVIDER,
            embedding_model=(source.get("EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL).strip(),
            embedding_api_key=(source.get("EMBEDDING_API_KEY") or "").strip(),
            embedding_base_url=(source.get("EMBEDDING_BASE_URL") or "").strip() or None,
            embedding_dimensions=_resolve_embedding_dimensions(
                model=(source.get("EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL).strip(),
                raw_dimensions=(source.get("EMBEDDING_DIMENSIONS") or "").strip(),
            ),
        )


def _resolve_embedding_dimensions(*, model: str, raw_dimensions: str) -> int | None:
    if raw_dimensions:
        return int(raw_dimensions)
    if model == "Qwen3-Embedding-4B":
        return 2560
    return None
