from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_QDRANT_COLLECTION = "student_handbook"
DEFAULT_QDRANT_TIMEOUT_SECONDS = 10.0
DEFAULT_DOCUMENT_REGISTRY_BACKEND = "file"
DEFAULT_DOCUMENT_REGISTRY_PATH = Path("./var/registry/student_handbook.json")


@dataclass(frozen=True, slots=True)
class RetrievalSettings:
    qdrant_url: str
    qdrant_collection: str = DEFAULT_QDRANT_COLLECTION
    qdrant_api_key: str | None = None
    qdrant_timeout_seconds: float = DEFAULT_QDRANT_TIMEOUT_SECONDS
    document_registry_backend: str = DEFAULT_DOCUMENT_REGISTRY_BACKEND
    document_registry_path: Path = DEFAULT_DOCUMENT_REGISTRY_PATH
    embedding_provider: str = "openai"
    embedding_model: str = "text-embedding-3-large"
    embedding_api_key: str = ""
    embedding_base_url: str | None = None

    def __post_init__(self) -> None:
        if self.qdrant_url != ":memory:":
            parsed = urlparse(self.qdrant_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("QDRANT_URL must be http(s) or :memory:")
        if not self.qdrant_collection:
            raise ValueError("QDRANT_COLLECTION is required")
        if self.qdrant_timeout_seconds <= 0:
            raise ValueError("QDRANT_TIMEOUT_SECONDS must be greater than zero")
        if self.document_registry_backend != "file":
            raise ValueError("only file document registry backend is supported in phase 1")
        if not self.embedding_provider:
            raise ValueError("EMBEDDING_PROVIDER is required")
        if not self.embedding_model:
            raise ValueError("EMBEDDING_MODEL is required")

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
            document_registry_backend=(
                source.get("DOCUMENT_REGISTRY_BACKEND") or DEFAULT_DOCUMENT_REGISTRY_BACKEND
            ).strip()
            or DEFAULT_DOCUMENT_REGISTRY_BACKEND,
            document_registry_path=Path(
                (source.get("DOCUMENT_REGISTRY_PATH") or str(DEFAULT_DOCUMENT_REGISTRY_PATH)).strip()
            ),
            embedding_provider=(source.get("EMBEDDING_PROVIDER") or "openai").strip() or "openai",
            embedding_model=(source.get("EMBEDDING_MODEL") or "text-embedding-3-large").strip(),
            embedding_api_key=(source.get("EMBEDDING_API_KEY") or "").strip(),
            embedding_base_url=(source.get("EMBEDDING_BASE_URL") or "").strip() or None,
        )
