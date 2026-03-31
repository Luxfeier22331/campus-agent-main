from __future__ import annotations

from dataclasses import dataclass, replace
import os


DEFAULT_SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS = 10.0
DEFAULT_SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS = 30.0
DEFAULT_SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS = 10.0
DEFAULT_SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS = 3.0
DEFAULT_SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS = 1
DEFAULT_SUPPLEMENTAL_HTTP_RETRY_BACKOFF_SECONDS = 1.0
DEFAULT_SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3
DEFAULT_SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_COOLDOWN_SECONDS = 60.0
DEFAULT_SUPPLEMENTAL_HTTP_PREFLIGHT_TIMEOUT_SECONDS = 20.0
DEFAULT_SUPPLEMENTAL_HTTP_KEEPALIVE_EXPIRY_SECONDS = 30.0
DEFAULT_SUPPLEMENTAL_HTTP_MAX_CONNECTIONS = 100
DEFAULT_SUPPLEMENTAL_HTTP_MAX_KEEPALIVE_CONNECTIONS = 20
DEFAULT_SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS = 0.0
DEFAULT_FAITHFULNESS_STATEMENT_GENERATION_READ_TIMEOUT_SECONDS = 180.0
ALLOWED_RAGAS_REASONING_EFFORTS = frozenset({"minimal", "low", "medium", "high", "none"})
ALLOWED_RAGAS_TEXT_VERBOSITIES = frozenset({"low", "medium", "high"})


@dataclass(frozen=True, slots=True)
class SupplementalHTTPSettings:
    connect_timeout_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS
    read_timeout_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS
    write_timeout_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS
    pool_timeout_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS
    retry_attempts: int = DEFAULT_SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS
    retry_backoff_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_RETRY_BACKOFF_SECONDS
    circuit_breaker_failure_threshold: int = DEFAULT_SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD
    circuit_breaker_cooldown_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_COOLDOWN_SECONDS
    preflight_timeout_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_PREFLIGHT_TIMEOUT_SECONDS
    requests_per_minute: float | None = None
    request_min_interval_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS
    keepalive_expiry_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_KEEPALIVE_EXPIRY_SECONDS
    max_connections: int = DEFAULT_SUPPLEMENTAL_HTTP_MAX_CONNECTIONS
    max_keepalive_connections: int = DEFAULT_SUPPLEMENTAL_HTTP_MAX_KEEPALIVE_CONNECTIONS

    def __post_init__(self) -> None:
        if self.connect_timeout_seconds <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS must be greater than zero")
        if self.read_timeout_seconds <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS must be greater than zero")
        if self.write_timeout_seconds <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS must be greater than zero")
        if self.pool_timeout_seconds <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS must be greater than zero")
        if self.retry_attempts < 0:
            raise ValueError("SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS must be greater than or equal to zero")
        if self.retry_backoff_seconds < 0:
            raise ValueError("SUPPLEMENTAL_HTTP_RETRY_BACKOFF_SECONDS must be greater than or equal to zero")
        if self.circuit_breaker_failure_threshold <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD must be greater than zero")
        if self.circuit_breaker_cooldown_seconds <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_COOLDOWN_SECONDS must be greater than zero")
        if self.preflight_timeout_seconds <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_PREFLIGHT_TIMEOUT_SECONDS must be greater than zero")
        if self.requests_per_minute is not None and self.requests_per_minute <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_REQUESTS_PER_MINUTE must be greater than zero")
        if self.request_min_interval_seconds < 0:
            raise ValueError("SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS must be greater than or equal to zero")
        if self.keepalive_expiry_seconds <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_KEEPALIVE_EXPIRY_SECONDS must be greater than zero")
        if self.max_connections <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_MAX_CONNECTIONS must be greater than zero")
        if self.max_keepalive_connections <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_MAX_KEEPALIVE_CONNECTIONS must be greater than zero")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "SupplementalHTTPSettings":
        source = env if env is not None else os.environ
        explicit_request_interval = _read_optional_float(
            _read_first_non_empty(
                source,
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS",
            )
        )
        requests_per_minute = _read_optional_float(
            _read_first_non_empty(
                source,
                "SUPPLEMENTAL_HTTP_REQUESTS_PER_MINUTE",
            )
        )
        if explicit_request_interval is not None:
            request_min_interval_seconds = explicit_request_interval
        elif requests_per_minute is not None:
            request_min_interval_seconds = 60.0 / requests_per_minute
        else:
            request_min_interval_seconds = DEFAULT_SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS
        return cls(
            connect_timeout_seconds=float(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS)
            ),
            read_timeout_seconds=float(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS)
            ),
            write_timeout_seconds=float(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS)
            ),
            pool_timeout_seconds=float(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS)
            ),
            retry_attempts=int(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS)
            ),
            retry_backoff_seconds=float(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_RETRY_BACKOFF_SECONDS",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_RETRY_BACKOFF_SECONDS)
            ),
            circuit_breaker_failure_threshold=int(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD)
            ),
            circuit_breaker_cooldown_seconds=float(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_COOLDOWN_SECONDS",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_COOLDOWN_SECONDS)
            ),
            preflight_timeout_seconds=float(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_PREFLIGHT_TIMEOUT_SECONDS",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_PREFLIGHT_TIMEOUT_SECONDS)
            ),
            requests_per_minute=requests_per_minute,
            request_min_interval_seconds=request_min_interval_seconds,
            keepalive_expiry_seconds=float(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_KEEPALIVE_EXPIRY_SECONDS",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_KEEPALIVE_EXPIRY_SECONDS)
            ),
            max_connections=int(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_MAX_CONNECTIONS",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_MAX_CONNECTIONS)
            ),
            max_keepalive_connections=int(
                _read_first_non_empty(
                    source,
                    "SUPPLEMENTAL_HTTP_MAX_KEEPALIVE_CONNECTIONS",
                )
                or str(DEFAULT_SUPPLEMENTAL_HTTP_MAX_KEEPALIVE_CONNECTIONS)
            ),
        )


@dataclass(frozen=True, slots=True)
class RagasSettings:
    llm_api_key: str
    llm_model: str
    embedding_api_key: str
    embedding_model: str
    llm_base_url: str | None = None
    embedding_base_url: str | None = None
    embedding_dimensions: int | None = None
    http_settings: SupplementalHTTPSettings = SupplementalHTTPSettings()
    use_responses_api: bool = True
    reasoning_effort: str | None = None
    text_verbosity: str | None = None
    max_output_tokens: int | None = None
    target_language: str | None = None
    adapt_instruction: bool = False

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
        if self.reasoning_effort is not None and self.reasoning_effort not in ALLOWED_RAGAS_REASONING_EFFORTS:
            raise ValueError("RAGAS_REASONING_EFFORT must be one of minimal, low, medium, high, none")
        if self.text_verbosity is not None and self.text_verbosity not in ALLOWED_RAGAS_TEXT_VERBOSITIES:
            raise ValueError("RAGAS_TEXT_VERBOSITY must be one of low, medium, high")
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError("RAGAS_MAX_OUTPUT_TOKENS must be greater than zero")

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
        *,
        http_settings: SupplementalHTTPSettings | None = None,
    ) -> "RagasSettings":
        source = env if env is not None else os.environ
        embedding_model = _read_first_non_empty(
            source,
            "EVAL_EMBEDDING_MODEL",
            "EMBEDDING_MODEL",
        ) or ""
        raw_embedding_dimensions = _read_first_non_empty(
            source,
            "EVAL_EMBEDDING_DIMENSIONS",
            "EMBEDDING_DIMENSIONS",
        ) or ""
        return cls(
            llm_api_key=_read_first_non_empty(source, "EVAL_LLM_API_KEY", "LLM_API_KEY") or "",
            llm_model=_resolve_ragas_model(source),
            embedding_api_key=_read_first_non_empty(
                source,
                "EVAL_EMBEDDING_API_KEY",
                "EMBEDDING_API_KEY",
            )
            or "",
            embedding_model=embedding_model,
            llm_base_url=_read_first_non_empty(source, "EVAL_LLM_BASE_URL", "LLM_BASE_URL"),
            embedding_base_url=_read_first_non_empty(
                source,
                "EVAL_EMBEDDING_BASE_URL",
                "EMBEDDING_BASE_URL",
            ),
            embedding_dimensions=_resolve_embedding_dimensions(
                model=embedding_model,
                raw_dimensions=raw_embedding_dimensions,
            ),
            http_settings=http_settings or SupplementalHTTPSettings.from_env(source),
            use_responses_api=_read_bool(source.get("RAGAS_USE_RESPONSES_API"), default=True),
            reasoning_effort=_read_optional_str(source.get("RAGAS_REASONING_EFFORT")),
            text_verbosity=_read_optional_str(source.get("RAGAS_TEXT_VERBOSITY")),
            max_output_tokens=_read_optional_int(source.get("RAGAS_MAX_OUTPUT_TOKENS")),
            target_language=_read_first_non_empty(source, "EVAL_RAGAS_TARGET_LANGUAGE", "RAGAS_TARGET_LANGUAGE"),
            adapt_instruction=_read_bool(source.get("RAGAS_ADAPT_INSTRUCTION"), default=False),
        )

    @property
    def request_timeout_seconds(self) -> float:
        return self.http_settings.read_timeout_seconds

    @property
    def request_min_interval_seconds(self) -> float:
        return self.http_settings.request_min_interval_seconds

    def http_settings_for_metric_stage(
        self,
        *,
        metric_name: str,
        stage_name: str,
    ) -> SupplementalHTTPSettings:
        normalized_metric_name = metric_name.strip().lower()
        normalized_stage_name = stage_name.strip().lower()
        if normalized_metric_name == "faithfulness" and normalized_stage_name == "statement_generation":
            extended_read_timeout = max(
                self.http_settings.read_timeout_seconds,
                DEFAULT_FAITHFULNESS_STATEMENT_GENERATION_READ_TIMEOUT_SECONDS,
            )
            if extended_read_timeout > self.http_settings.read_timeout_seconds:
                return replace(
                    self.http_settings,
                    read_timeout_seconds=extended_read_timeout,
                )
        return self.http_settings


@dataclass(frozen=True, slots=True)
class JudgeLLMSettings:
    llm_api_key: str
    llm_model: str
    llm_base_url: str | None = None
    http_settings: SupplementalHTTPSettings = SupplementalHTTPSettings()
    reasoning_effort: str | None = None
    text_verbosity: str | None = None
    max_output_tokens: int | None = None

    def __post_init__(self) -> None:
        if not self.llm_api_key.strip():
            raise ValueError("LLM_API_KEY is required")
        if not self.llm_model.strip():
            raise ValueError("RAGAS_LLM_MODEL, LLM_REASONING_MODEL, or LLM_CHAT_MODEL is required")
        if self.reasoning_effort is not None and self.reasoning_effort not in ALLOWED_RAGAS_REASONING_EFFORTS:
            raise ValueError("RAGAS_REASONING_EFFORT must be one of minimal, low, medium, high, none")
        if self.text_verbosity is not None and self.text_verbosity not in ALLOWED_RAGAS_TEXT_VERBOSITIES:
            raise ValueError("RAGAS_TEXT_VERBOSITY must be one of low, medium, high")
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError("RAGAS_MAX_OUTPUT_TOKENS must be greater than zero")

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
        *,
        http_settings: SupplementalHTTPSettings | None = None,
    ) -> "JudgeLLMSettings":
        source = env if env is not None else os.environ
        return cls(
            llm_api_key=_read_first_non_empty(source, "EVAL_LLM_API_KEY", "LLM_API_KEY") or "",
            llm_model=_resolve_judge_model(source),
            llm_base_url=_read_first_non_empty(source, "EVAL_LLM_BASE_URL", "LLM_BASE_URL"),
            http_settings=http_settings or SupplementalHTTPSettings.from_env(source),
            reasoning_effort=_read_optional_str(source.get("RAGAS_REASONING_EFFORT")),
            text_verbosity=_read_optional_str(source.get("RAGAS_TEXT_VERBOSITY")),
            max_output_tokens=_read_optional_int(source.get("RAGAS_MAX_OUTPUT_TOKENS")),
        )

    def as_runtime_options(self) -> dict[str, object]:
        return {
            "llm_api_key": self.llm_api_key,
            "llm_model": self.llm_model,
            "llm_base_url": self.llm_base_url,
            "http_settings": self.http_settings,
            "reasoning_effort": self.reasoning_effort,
            "text_verbosity": self.text_verbosity,
            "max_output_tokens": self.max_output_tokens,
        }

    @property
    def request_timeout_seconds(self) -> float:
        return self.http_settings.read_timeout_seconds

    @property
    def request_min_interval_seconds(self) -> float:
        return self.http_settings.request_min_interval_seconds


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


def _read_optional_float(value: str | None) -> float | None:
    normalized = _read_optional_str(value)
    if normalized is None:
        return None
    return float(normalized)


def _read_first_non_empty(source: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = source.get(key)
        if value is None:
            continue
        normalized = value.strip()
        if normalized:
            return normalized
    return None


def _resolve_ragas_model(source: dict[str, str]) -> str:
    eval_ragas_model = _read_first_non_empty(source, "EVAL_RAGAS_MODEL")
    ragas_llm_model = _read_first_non_empty(source, "RAGAS_LLM_MODEL")
    llm_reasoning_model = _read_first_non_empty(source, "LLM_REASONING_MODEL")
    llm_chat_model = _read_first_non_empty(source, "LLM_CHAT_MODEL")
    return eval_ragas_model or ragas_llm_model or llm_reasoning_model or llm_chat_model or ""


def _resolve_judge_model(source: dict[str, str]) -> str:
    eval_judge_model = _read_first_non_empty(source, "EVAL_JUDGE_MODEL")
    eval_ragas_model = _read_first_non_empty(source, "EVAL_RAGAS_MODEL")
    ragas_llm_model = _read_first_non_empty(source, "RAGAS_LLM_MODEL")
    llm_reasoning_model = _read_first_non_empty(source, "LLM_REASONING_MODEL")
    llm_chat_model = _read_first_non_empty(source, "LLM_CHAT_MODEL")
    return eval_judge_model or eval_ragas_model or ragas_llm_model or llm_reasoning_model or llm_chat_model or ""
