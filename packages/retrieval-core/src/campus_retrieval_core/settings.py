from __future__ import annotations

from dataclasses import dataclass
import os
from urllib.parse import urlparse

from campus_ingestion_core.embed import (
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_EMBEDDING_PROVIDER,
    _resolve_embedding_dimensions,
)
from campus_ingestion_core.sparse import (
    DEFAULT_SPARSE_LANGUAGE,
    DEFAULT_SPARSE_MODEL,
    DEFAULT_SPARSE_PROVIDER,
    DEFAULT_SPARSE_TOKENIZER,
)

DEFAULT_QDRANT_TIMEOUT_SECONDS = 10.0


@dataclass(frozen=True, slots=True)
class RetrievalSettings:
    qdrant_url: str
    qdrant_api_key: str | None = None
    qdrant_timeout_seconds: float = DEFAULT_QDRANT_TIMEOUT_SECONDS
    document_registry_database_url: str = ""
    embedding_provider: str = DEFAULT_EMBEDDING_PROVIDER
    embedding_model: str = DEFAULT_EMBEDDING_MODEL
    embedding_api_key: str = ""
    embedding_base_url: str | None = None
    embedding_dimensions: int | None = None
    sparse_provider: str = DEFAULT_SPARSE_PROVIDER
    sparse_model: str = DEFAULT_SPARSE_MODEL
    sparse_tokenizer: str = DEFAULT_SPARSE_TOKENIZER
    sparse_language: str = DEFAULT_SPARSE_LANGUAGE

    def __post_init__(self) -> None:
        if self.embedding_dimensions is None:
            resolved_dimensions = _resolve_embedding_dimensions(model=self.embedding_model, raw_dimensions="")
            if resolved_dimensions is not None:
                object.__setattr__(self, "embedding_dimensions", resolved_dimensions)
        if self.qdrant_url != ":memory:":
            parsed = urlparse(self.qdrant_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("QDRANT_URL must be http(s) or :memory:")
        if self.qdrant_timeout_seconds <= 0:
            raise ValueError("QDRANT_TIMEOUT_SECONDS must be greater than zero")
        if not self.embedding_provider:
            raise ValueError("EMBEDDING_PROVIDER is required")
        if not self.embedding_model:
            raise ValueError("EMBEDDING_MODEL is required")
        if not self.sparse_provider:
            raise ValueError("SPARSE_PROVIDER is required")
        if not self.sparse_model:
            raise ValueError("SPARSE_MODEL is required")
        if not self.sparse_tokenizer:
            raise ValueError("SPARSE_TOKENIZER is required")
        if not self.sparse_language:
            raise ValueError("SPARSE_LANGUAGE is required")
        if self.embedding_dimensions is not None and self.embedding_dimensions <= 0:
            raise ValueError("EMBEDDING_DIMENSIONS must be greater than zero")
        if self.document_registry_database_url:
            parsed_registry = urlparse(self.document_registry_database_url)
            if parsed_registry.scheme not in {"postgresql", "postgres"}:
                raise ValueError("DOCUMENT_REGISTRY_DATABASE_URL must be a postgres URL")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "RetrievalSettings":
        source = env if env is not None else os.environ
        qdrant_url = (source.get("QDRANT_URL") or "").strip()
        if not qdrant_url:
            raise ValueError("QDRANT_URL is required")
        return cls(
            qdrant_url=qdrant_url,
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
            sparse_provider=(source.get("SPARSE_PROVIDER") or DEFAULT_SPARSE_PROVIDER).strip()
            or DEFAULT_SPARSE_PROVIDER,
            sparse_model=(source.get("SPARSE_MODEL") or DEFAULT_SPARSE_MODEL).strip() or DEFAULT_SPARSE_MODEL,
            sparse_tokenizer=(source.get("SPARSE_TOKENIZER") or DEFAULT_SPARSE_TOKENIZER).strip()
            or DEFAULT_SPARSE_TOKENIZER,
            sparse_language=(source.get("SPARSE_LANGUAGE") or DEFAULT_SPARSE_LANGUAGE).strip()
            or DEFAULT_SPARSE_LANGUAGE,
        )
