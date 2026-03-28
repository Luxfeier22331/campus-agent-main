from __future__ import annotations

from dataclasses import dataclass
import os


DEFAULT_RAGAS_TIMEOUT_SECONDS = 60.0


@dataclass(frozen=True, slots=True)
class RagasSettings:
    llm_api_key: str
    llm_model: str
    embedding_api_key: str
    embedding_model: str
    llm_base_url: str | None = None
    embedding_base_url: str | None = None
    embedding_dimensions: int | None = None
    request_timeout_seconds: float = DEFAULT_RAGAS_TIMEOUT_SECONDS
    batch_size: int | None = None
    use_responses_api: bool = True

    def __post_init__(self) -> None:
        if not self.llm_api_key.strip():
            raise ValueError("LLM_API_KEY is required")
        if not self.llm_model.strip():
            raise ValueError("RAGAS_LLM_MODEL, LLM_REASONING_MODEL, or LLM_CHAT_MODEL is required")
        if not self.embedding_api_key.strip():
            raise ValueError("EMBEDDING_API_KEY is required")
        if not self.embedding_model.strip():
            raise ValueError("EMBEDDING_MODEL is required")
        if self.embedding_dimensions is None and self.embedding_model == "Qwen3-Embedding-4B":
            object.__setattr__(self, "embedding_dimensions", 2560)
        if self.embedding_dimensions is not None and self.embedding_dimensions <= 0:
            raise ValueError("EMBEDDING_DIMENSIONS must be greater than zero")
        if self.request_timeout_seconds <= 0:
            raise ValueError("ragas timeout must be greater than zero")
        if self.batch_size is not None and self.batch_size <= 0:
            raise ValueError("RAGAS_BATCH_SIZE must be greater than zero")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "RagasSettings":
        source = env if env is not None else os.environ
        embedding_model = (source.get("EMBEDDING_MODEL") or "").strip()
        raw_embedding_dimensions = (source.get("EMBEDDING_DIMENSIONS") or "").strip()
        ragas_llm_model = (source.get("RAGAS_LLM_MODEL") or "").strip()
        llm_reasoning_model = (source.get("LLM_REASONING_MODEL") or "").strip()
        llm_chat_model = (source.get("LLM_CHAT_MODEL") or "").strip()
        return cls(
            llm_api_key=(source.get("LLM_API_KEY") or "").strip(),
            llm_model=ragas_llm_model or llm_reasoning_model or llm_chat_model,
            embedding_api_key=(source.get("EMBEDDING_API_KEY") or "").strip(),
            embedding_model=embedding_model,
            llm_base_url=(source.get("LLM_BASE_URL") or "").strip() or None,
            embedding_base_url=(source.get("EMBEDDING_BASE_URL") or "").strip() or None,
            embedding_dimensions=_resolve_embedding_dimensions(
                model=embedding_model,
                raw_dimensions=raw_embedding_dimensions,
            ),
            request_timeout_seconds=float(
                (source.get("EMBEDDING_TIMEOUT_SECONDS") or str(DEFAULT_RAGAS_TIMEOUT_SECONDS)).strip()
            ),
            use_responses_api=_read_bool(source.get("RAGAS_USE_RESPONSES_API"), default=True),
        )


def _resolve_embedding_dimensions(*, model: str, raw_dimensions: str) -> int | None:
    if raw_dimensions:
        return int(raw_dimensions)
    if model == "Qwen3-Embedding-4B":
        return 2560
    return None


def _read_bool(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if not normalized:
        return default
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError("RAGAS_USE_RESPONSES_API must be a boolean")
