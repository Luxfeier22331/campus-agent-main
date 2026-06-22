from __future__ import annotations

import json
import os
from dataclasses import dataclass, replace
from functools import cache
from pathlib import Path

from campus_evals.provider_projection import load_provider_projection_from_env

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
DEFAULT_FAITHFULNESS_NLI_BATCH_SIZE = 4
ALLOWED_EVAL_LLM_TRANSPORTS = frozenset({"responses", "chat_completions"})
ALLOWED_RAGAS_REASONING_EFFORTS = frozenset({"minimal", "low", "medium", "high", "none"})
ALLOWED_RAGAS_TEXT_VERBOSITIES = frozenset({"low", "medium", "high"})
DEFAULT_EVAL_RUNTIME_PROFILES_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "ops" / "eval_runtime_profiles.v1.json"
)


@dataclass(frozen=True, slots=True)
class EvalRuntimeProfile:
    profile_id: str
    ragas_model: str
    judge_model: str
    llm_transport: str
    embedding_model: str
    embedding_dimensions: int | None
    reasoning_effort: str | None
    text_verbosity: str | None
    max_output_tokens: int | None
    target_language: str | None
    adapt_instruction: bool

    def __post_init__(self) -> None:
        if not self.profile_id.strip():
            raise ValueError("eval runtime profile_id is required")
        if not self.ragas_model.strip():
            raise ValueError("eval runtime ragas_model is required")
        if not self.judge_model.strip():
            raise ValueError("eval runtime judge_model is required")
        if self.llm_transport not in ALLOWED_EVAL_LLM_TRANSPORTS:
            raise ValueError("eval runtime llm_transport must be responses or chat_completions")
        if not self.embedding_model.strip():
            raise ValueError("eval runtime embedding_model is required")
        if self.embedding_dimensions is not None and self.embedding_dimensions <= 0:
            raise ValueError("eval runtime embedding_dimensions must be greater than zero")
        if (
            self.reasoning_effort is not None
            and self.reasoning_effort not in ALLOWED_RAGAS_REASONING_EFFORTS
        ):
            raise ValueError("eval runtime reasoning_effort is unsupported")
        if (
            self.text_verbosity is not None
            and self.text_verbosity not in ALLOWED_RAGAS_TEXT_VERBOSITIES
        ):
            raise ValueError("eval runtime text_verbosity is unsupported")
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError("eval runtime max_output_tokens must be greater than zero")


@cache
def load_default_eval_runtime_profile() -> EvalRuntimeProfile:
    payload = json.loads(DEFAULT_EVAL_RUNTIME_PROFILES_PATH.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "eval_runtime_profiles.v1":
        raise ValueError("unsupported eval runtime profile schema_version")
    default_profile_id = str(payload.get("default_profile_id") or "")
    profiles = dict(payload.get("profiles") or {})
    raw_profile = profiles.get(default_profile_id)
    if not isinstance(raw_profile, dict):
        raise ValueError("default eval runtime profile is missing")
    return EvalRuntimeProfile(
        profile_id=default_profile_id,
        ragas_model=str(raw_profile.get("ragas_model") or ""),
        judge_model=str(raw_profile.get("judge_model") or ""),
        llm_transport=str(raw_profile.get("llm_transport") or ""),
        embedding_model=str(raw_profile.get("embedding_model") or ""),
        embedding_dimensions=_read_optional_int_value(raw_profile.get("embedding_dimensions")),
        reasoning_effort=_read_optional_profile_str(raw_profile.get("reasoning_effort")),
        text_verbosity=_read_optional_profile_str(raw_profile.get("text_verbosity")),
        max_output_tokens=_read_optional_int_value(raw_profile.get("max_output_tokens")),
        target_language=_read_optional_profile_str(raw_profile.get("target_language")),
        adapt_instruction=bool(raw_profile.get("adapt_instruction", False)),
    )


@dataclass(frozen=True, slots=True)
class SupplementalHTTPSettings:
    connect_timeout_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS
    read_timeout_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS
    write_timeout_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS
    pool_timeout_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS
    retry_attempts: int = DEFAULT_SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS
    retry_backoff_seconds: float = DEFAULT_SUPPLEMENTAL_HTTP_RETRY_BACKOFF_SECONDS
    circuit_breaker_failure_threshold: int = (
        DEFAULT_SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD
    )
    circuit_breaker_cooldown_seconds: float = (
        DEFAULT_SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_COOLDOWN_SECONDS
    )
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
            raise ValueError(
                "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS must be greater than or equal to zero"
            )
        if self.retry_backoff_seconds < 0:
            raise ValueError(
                "SUPPLEMENTAL_HTTP_RETRY_BACKOFF_SECONDS must be greater than or equal to zero"
            )
        if self.circuit_breaker_failure_threshold <= 0:
            raise ValueError(
                "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD must be greater than zero"
            )
        if self.circuit_breaker_cooldown_seconds <= 0:
            raise ValueError(
                "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_COOLDOWN_SECONDS must be greater than zero"
            )
        if self.preflight_timeout_seconds <= 0:
            raise ValueError(
                "SUPPLEMENTAL_HTTP_PREFLIGHT_TIMEOUT_SECONDS must be greater than zero"
            )
        if self.requests_per_minute is not None and self.requests_per_minute <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_REQUESTS_PER_MINUTE must be greater than zero")
        if self.request_min_interval_seconds < 0:
            raise ValueError(
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS must be greater than or equal to zero"
            )
        if self.keepalive_expiry_seconds <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_KEEPALIVE_EXPIRY_SECONDS must be greater than zero")
        if self.max_connections <= 0:
            raise ValueError("SUPPLEMENTAL_HTTP_MAX_CONNECTIONS must be greater than zero")
        if self.max_keepalive_connections <= 0:
            raise ValueError(
                "SUPPLEMENTAL_HTTP_MAX_KEEPALIVE_CONNECTIONS must be greater than zero"
            )

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> SupplementalHTTPSettings:
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
    llm_transport: str = "responses"
    llm_base_url: str | None = None
    embedding_base_url: str | None = None
    embedding_dimensions: int | None = None
    http_settings: SupplementalHTTPSettings = SupplementalHTTPSettings()
    reasoning_effort: str | None = None
    text_verbosity: str | None = None
    max_output_tokens: int | None = None
    max_workers: int = 1
    target_language: str | None = None
    adapt_instruction: bool = False
    faithfulness_nli_batch_size: int = DEFAULT_FAITHFULNESS_NLI_BATCH_SIZE

    def __post_init__(self) -> None:
        if not self.llm_api_key.strip():
            raise ValueError("ragas llm api_key is required")
        if not self.llm_model.strip():
            raise ValueError("eval runtime profile ragas_model is required")
        if self.llm_transport not in ALLOWED_EVAL_LLM_TRANSPORTS:
            raise ValueError(
                "eval runtime profile llm_transport must be one of responses, chat_completions"
            )
        if not self.embedding_api_key.strip():
            raise ValueError("ragas embedding api_key is required")
        if not self.embedding_model.strip():
            raise ValueError("eval runtime profile embedding_model is required")
        if self.embedding_dimensions is None and self.embedding_model == "Qwen3-Embedding-4B":
            object.__setattr__(self, "embedding_dimensions", 2560)
        if self.embedding_dimensions is not None and self.embedding_dimensions <= 0:
            raise ValueError("eval runtime profile embedding_dimensions must be greater than zero")
        if (
            self.reasoning_effort is not None
            and self.reasoning_effort not in ALLOWED_RAGAS_REASONING_EFFORTS
        ):
            raise ValueError(
                "eval runtime profile reasoning_effort must be one of minimal, low, medium, high, none"
            )
        if (
            self.text_verbosity is not None
            and self.text_verbosity not in ALLOWED_RAGAS_TEXT_VERBOSITIES
        ):
            raise ValueError("eval runtime profile text_verbosity must be one of low, medium, high")
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError("eval runtime profile max_output_tokens must be greater than zero")
        if self.max_workers <= 0:
            raise ValueError("RAGAS_MAX_WORKERS must be greater than zero")
        if self.faithfulness_nli_batch_size <= 0:
            raise ValueError("faithfulness_nli_batch_size must be greater than zero")

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
        *,
        http_settings: SupplementalHTTPSettings | None = None,
        faithfulness_nli_batch_size: int = DEFAULT_FAITHFULNESS_NLI_BATCH_SIZE,
    ) -> RagasSettings:
        source = env if env is not None else os.environ
        runtime_profile = load_default_eval_runtime_profile()
        projection = load_provider_projection_from_env(source)
        llm_provider = projection.profile("eval_ragas_llm")
        embedding_provider = projection.profile("eval_ragas_embedding")
        return cls(
            llm_api_key=llm_provider.api_key,
            llm_model=runtime_profile.ragas_model,
            llm_transport=runtime_profile.llm_transport,
            embedding_api_key=embedding_provider.api_key,
            embedding_model=runtime_profile.embedding_model,
            llm_base_url=llm_provider.base_url,
            embedding_base_url=embedding_provider.base_url,
            embedding_dimensions=runtime_profile.embedding_dimensions,
            http_settings=http_settings or SupplementalHTTPSettings.from_env(source),
            reasoning_effort=runtime_profile.reasoning_effort,
            text_verbosity=runtime_profile.text_verbosity,
            max_output_tokens=runtime_profile.max_output_tokens,
            max_workers=_read_optional_int(source.get("RAGAS_MAX_WORKERS")) or 1,
            target_language=runtime_profile.target_language,
            adapt_instruction=runtime_profile.adapt_instruction,
            faithfulness_nli_batch_size=faithfulness_nli_batch_size,
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
        if (
            normalized_metric_name == "faithfulness"
            and normalized_stage_name == "statement_generation"
        ):
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
    llm_transport: str = "responses"
    llm_base_url: str | None = None
    http_settings: SupplementalHTTPSettings = SupplementalHTTPSettings()
    reasoning_effort: str | None = None
    text_verbosity: str | None = None
    max_output_tokens: int | None = None

    def __post_init__(self) -> None:
        if not self.llm_api_key.strip():
            raise ValueError("judge llm api_key is required")
        if not self.llm_model.strip():
            raise ValueError("eval runtime profile judge_model is required")
        if self.llm_transport not in ALLOWED_EVAL_LLM_TRANSPORTS:
            raise ValueError(
                "eval runtime profile llm_transport must be one of responses, chat_completions"
            )
        if (
            self.reasoning_effort is not None
            and self.reasoning_effort not in ALLOWED_RAGAS_REASONING_EFFORTS
        ):
            raise ValueError(
                "eval runtime profile reasoning_effort must be one of minimal, low, medium, high, none"
            )
        if (
            self.text_verbosity is not None
            and self.text_verbosity not in ALLOWED_RAGAS_TEXT_VERBOSITIES
        ):
            raise ValueError("eval runtime profile text_verbosity must be one of low, medium, high")
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError("eval runtime profile max_output_tokens must be greater than zero")

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
        *,
        http_settings: SupplementalHTTPSettings | None = None,
    ) -> JudgeLLMSettings:
        source = env if env is not None else os.environ
        runtime_profile = load_default_eval_runtime_profile()
        projection = load_provider_projection_from_env(source)
        llm_provider = projection.profile("eval_judge_llm")
        return cls(
            llm_api_key=llm_provider.api_key,
            llm_model=runtime_profile.judge_model,
            llm_transport=runtime_profile.llm_transport,
            llm_base_url=llm_provider.base_url,
            http_settings=http_settings or SupplementalHTTPSettings.from_env(source),
            reasoning_effort=runtime_profile.reasoning_effort,
            text_verbosity=runtime_profile.text_verbosity,
            max_output_tokens=runtime_profile.max_output_tokens,
        )

    def as_runtime_options(self) -> dict[str, object]:
        return {
            "llm_api_key": self.llm_api_key,
            "llm_model": self.llm_model,
            "llm_transport": self.llm_transport,
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


def _read_optional_profile_str(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _read_optional_int_value(value: object) -> int | None:
    if value is None:
        return None
    return int(value)


def _read_first_non_empty(source: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = source.get(key)
        if value is None:
            continue
        normalized = value.strip()
        if normalized:
            return normalized
    return None
