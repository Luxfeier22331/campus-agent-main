from __future__ import annotations

from dataclasses import dataclass
import os


DEFAULT_RAGAS_TIMEOUT_SECONDS = 60.0
DEFAULT_RAGAS_REQUEST_MIN_INTERVAL_SECONDS = 0.0
ALLOWED_RAGAS_REASONING_EFFORTS = frozenset({"minimal", "low", "medium", "high", "none"})
ALLOWED_RAGAS_TEXT_VERBOSITIES = frozenset({"low", "medium", "high"})


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
    request_min_interval_seconds: float = DEFAULT_RAGAS_REQUEST_MIN_INTERVAL_SECONDS
    batch_size: int | None = None
    use_responses_api: bool = True
    reasoning_effort: str | None = None
    text_verbosity: str | None = None
    max_output_tokens: int | None = None

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
        if self.request_min_interval_seconds < 0:
            raise ValueError("RAGAS_REQUEST_MIN_INTERVAL_SECONDS must be greater than or equal to zero")
        if self.batch_size is not None and self.batch_size <= 0:
            raise ValueError("RAGAS_BATCH_SIZE must be greater than zero")
        if self.reasoning_effort is not None and self.reasoning_effort not in ALLOWED_RAGAS_REASONING_EFFORTS:
            raise ValueError("RAGAS_REASONING_EFFORT must be one of minimal, low, medium, high, none")
        if self.text_verbosity is not None and self.text_verbosity not in ALLOWED_RAGAS_TEXT_VERBOSITIES:
            raise ValueError("RAGAS_TEXT_VERBOSITY must be one of low, medium, high")
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError("RAGAS_MAX_OUTPUT_TOKENS must be greater than zero")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "RagasSettings":
        source = env if env is not None else os.environ
        embedding_model = (source.get("EMBEDDING_MODEL") or "").strip()
        raw_embedding_dimensions = (source.get("EMBEDDING_DIMENSIONS") or "").strip()
        return cls(
            llm_api_key=(source.get("LLM_API_KEY") or "").strip(),
            llm_model=_resolve_judge_model(source),
            embedding_api_key=(source.get("EMBEDDING_API_KEY") or "").strip(),
            embedding_model=embedding_model,
            llm_base_url=(source.get("LLM_BASE_URL") or "").strip() or None,
            embedding_base_url=(source.get("EMBEDDING_BASE_URL") or "").strip() or None,
            embedding_dimensions=_resolve_embedding_dimensions(
                model=embedding_model,
                raw_dimensions=raw_embedding_dimensions,
            ),
            request_timeout_seconds=float(
                (source.get("RAGAS_REQUEST_TIMEOUT_SECONDS") or str(DEFAULT_RAGAS_TIMEOUT_SECONDS)).strip()
            ),
            request_min_interval_seconds=float(
                (source.get("RAGAS_REQUEST_MIN_INTERVAL_SECONDS") or str(DEFAULT_RAGAS_REQUEST_MIN_INTERVAL_SECONDS)).strip()
            ),
            batch_size=_read_optional_int(source.get("RAGAS_BATCH_SIZE")),
            use_responses_api=_read_bool(source.get("RAGAS_USE_RESPONSES_API"), default=True),
            reasoning_effort=_read_optional_str(source.get("RAGAS_REASONING_EFFORT")),
            text_verbosity=_read_optional_str(source.get("RAGAS_TEXT_VERBOSITY")),
            max_output_tokens=_read_optional_int(source.get("RAGAS_MAX_OUTPUT_TOKENS")),
        )


@dataclass(frozen=True, slots=True)
class JudgeLLMSettings:
    llm_api_key: str
    llm_model: str
    llm_base_url: str | None = None
    request_timeout_seconds: float = DEFAULT_RAGAS_TIMEOUT_SECONDS
    request_min_interval_seconds: float = DEFAULT_RAGAS_REQUEST_MIN_INTERVAL_SECONDS
    reasoning_effort: str | None = None
    text_verbosity: str | None = None
    max_output_tokens: int | None = None

    def __post_init__(self) -> None:
        if not self.llm_api_key.strip():
            raise ValueError("LLM_API_KEY is required")
        if not self.llm_model.strip():
            raise ValueError("RAGAS_LLM_MODEL, LLM_REASONING_MODEL, or LLM_CHAT_MODEL is required")
        if self.request_timeout_seconds <= 0:
            raise ValueError("judge timeout must be greater than zero")
        if self.request_min_interval_seconds < 0:
            raise ValueError("RAGAS_REQUEST_MIN_INTERVAL_SECONDS must be greater than or equal to zero")
        if self.reasoning_effort is not None and self.reasoning_effort not in ALLOWED_RAGAS_REASONING_EFFORTS:
            raise ValueError("RAGAS_REASONING_EFFORT must be one of minimal, low, medium, high, none")
        if self.text_verbosity is not None and self.text_verbosity not in ALLOWED_RAGAS_TEXT_VERBOSITIES:
            raise ValueError("RAGAS_TEXT_VERBOSITY must be one of low, medium, high")
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError("RAGAS_MAX_OUTPUT_TOKENS must be greater than zero")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "JudgeLLMSettings":
        source = env if env is not None else os.environ
        return cls(
            llm_api_key=(source.get("LLM_API_KEY") or "").strip(),
            llm_model=_resolve_judge_model(source),
            llm_base_url=(source.get("LLM_BASE_URL") or "").strip() or None,
            request_timeout_seconds=float(
                (source.get("RAGAS_REQUEST_TIMEOUT_SECONDS") or str(DEFAULT_RAGAS_TIMEOUT_SECONDS)).strip()
            ),
            request_min_interval_seconds=float(
                (source.get("RAGAS_REQUEST_MIN_INTERVAL_SECONDS") or str(DEFAULT_RAGAS_REQUEST_MIN_INTERVAL_SECONDS)).strip()
            ),
            reasoning_effort=_read_optional_str(source.get("RAGAS_REASONING_EFFORT")),
            text_verbosity=_read_optional_str(source.get("RAGAS_TEXT_VERBOSITY")),
            max_output_tokens=_read_optional_int(source.get("RAGAS_MAX_OUTPUT_TOKENS")),
        )

    def as_runtime_options(self) -> dict[str, object]:
        return {
            "llm_api_key": self.llm_api_key,
            "llm_model": self.llm_model,
            "llm_base_url": self.llm_base_url,
            "request_timeout_seconds": self.request_timeout_seconds,
            "request_min_interval_seconds": self.request_min_interval_seconds,
            "reasoning_effort": self.reasoning_effort,
            "text_verbosity": self.text_verbosity,
            "max_output_tokens": self.max_output_tokens,
        }


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


def _read_optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _read_optional_int(value: str | None) -> int | None:
    normalized = _read_optional_str(value)
    if normalized is None:
        return None
    return int(normalized)


def _resolve_judge_model(source: dict[str, str]) -> str:
    ragas_llm_model = (source.get("RAGAS_LLM_MODEL") or "").strip()
    llm_reasoning_model = (source.get("LLM_REASONING_MODEL") or "").strip()
    llm_chat_model = (source.get("LLM_CHAT_MODEL") or "").strip()
    return ragas_llm_model or llm_reasoning_model or llm_chat_model
