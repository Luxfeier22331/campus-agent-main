from __future__ import annotations

import os
from dataclasses import dataclass

from campus_prompt_runtime import (
    DEFAULT_PROMPT_RUNTIME_BASE_URL,
    DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS,
    DEFAULT_PROMPT_RUNTIME_MAX_CONNECTIONS,
    DEFAULT_PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS,
    DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS,
)
from campus_shared import APP_NAME

DEFAULT_BRIDGE_REQUEST_BODY_LIMIT_BYTES = 1_048_576


def _read_bool(name: str, *, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off", ""}


def _read_optional_int(name: str) -> int | None:
    value = os.getenv(name)
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    return int(normalized)


def _read_int(name: str, *, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip()
    if not normalized:
        return default
    return int(normalized)


def _read_positive_int(name: str, *, default: int) -> int:
    value = _read_int(name, default=default)
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _read_float(name: str, *, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip()
    if not normalized:
        return default
    return float(normalized)


def _read_positive_float(name: str, *, default: float) -> float:
    value = _read_float(name, default=default)
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


@dataclass(frozen=True, slots=True)
class ApiSettings:
    app_name: str = APP_NAME
    bridge_shared_secret: str = ""
    runtime_provider: str = ""
    prompt_runtime_model: str = ""
    supervisor_prompt_model: str = ""
    agent_prompt_model: str = ""
    prompt_runtime_provider: str = ""
    prompt_runtime_transport: str = "responses"
    prompt_runtime_api_key: str = ""
    prompt_runtime_base_url: str = DEFAULT_PROMPT_RUNTIME_BASE_URL
    prompt_runtime_reasoning_effort: str | None = None
    prompt_runtime_max_output_tokens: int | None = None
    prompt_runtime_connect_timeout_seconds: float = DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS
    prompt_runtime_read_timeout_seconds: float = DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS
    prompt_runtime_write_timeout_seconds: float = DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS
    prompt_runtime_pool_timeout_seconds: float = DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS
    prompt_runtime_max_connections: int = DEFAULT_PROMPT_RUNTIME_MAX_CONNECTIONS
    prompt_runtime_max_keepalive_connections: int = DEFAULT_PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS
    prompt_runtime_keepalive_expiry_seconds: float = DEFAULT_PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS
    prompt_strict_structured_outputs: bool = True
    bridge_worker_threads: int = 8
    bridge_request_body_limit_bytes: int = DEFAULT_BRIDGE_REQUEST_BODY_LIMIT_BYTES
    internal_query_base_url: str = ""
    internal_query_shared_secret: str = ""
    structured_query_timeout_seconds: float = 1.0
    agents_sdk_runtime_enabled: bool = True
    retrieval_observation_jsonl_path: str = ""
    retrieval_runtime_event_jsonl_path: str = ""
    retrieval_observation_include_query_text: bool = False
    otel_enabled: bool = False
    otel_service_name: str = "campus-supervisor-agent-worker"
    otel_allowed_attributes_version: str = "supervisor-agent-worker-otel-attrs-v1"
    otel_export_timeout_seconds: float = 1.0
    otel_export_interval_seconds: float = 5.0
    otel_exporter_otlp_headers: str = ""
    otel_exporter_otlp_traces_endpoint: str = ""
    otel_exporter_otlp_metrics_endpoint: str = ""
    otel_exporter_otlp_logs_endpoint: str = ""
    cancel_flag_ttl_seconds: float = 900.0

    def __post_init__(self) -> None:
        _require_positive_float(
            "prompt_runtime_connect_timeout_seconds",
            self.prompt_runtime_connect_timeout_seconds,
        )
        _require_positive_float(
            "prompt_runtime_read_timeout_seconds",
            self.prompt_runtime_read_timeout_seconds,
        )
        _require_positive_float(
            "prompt_runtime_write_timeout_seconds",
            self.prompt_runtime_write_timeout_seconds,
        )
        _require_positive_float(
            "prompt_runtime_pool_timeout_seconds",
            self.prompt_runtime_pool_timeout_seconds,
        )
        _require_positive_int(
            "prompt_runtime_max_connections",
            self.prompt_runtime_max_connections,
        )
        _require_non_negative_int(
            "prompt_runtime_max_keepalive_connections",
            self.prompt_runtime_max_keepalive_connections,
        )
        if self.prompt_runtime_max_keepalive_connections > self.prompt_runtime_max_connections:
            raise ValueError(
                "prompt_runtime_max_keepalive_connections must not exceed "
                "prompt_runtime_max_connections"
            )
        _require_positive_float(
            "prompt_runtime_keepalive_expiry_seconds",
            self.prompt_runtime_keepalive_expiry_seconds,
        )
        if self.prompt_runtime_max_output_tokens is not None:
            _require_positive_int(
                "prompt_runtime_max_output_tokens",
                self.prompt_runtime_max_output_tokens,
            )
        _require_positive_int("bridge_worker_threads", self.bridge_worker_threads)
        _require_positive_int(
            "bridge_request_body_limit_bytes",
            self.bridge_request_body_limit_bytes,
        )
        _require_positive_float(
            "structured_query_timeout_seconds",
            self.structured_query_timeout_seconds,
        )
        _require_positive_float("otel_export_timeout_seconds", self.otel_export_timeout_seconds)
        _require_positive_float(
            "otel_export_interval_seconds",
            self.otel_export_interval_seconds,
        )
        _require_positive_float("cancel_flag_ttl_seconds", self.cancel_flag_ttl_seconds)

    @classmethod
    def from_env(cls) -> ApiSettings:
        prompt_runtime_model = (os.getenv("PROMPT_RUNTIME_MODEL", "")).strip()
        return cls(
            app_name=os.getenv("CAMPUS_AGENT_APP_NAME", APP_NAME),
            bridge_shared_secret=os.getenv("SUPERVISOR_AGENT_WORKER_SHARED_SECRET", "").strip(),
            runtime_provider=os.getenv("AGENT_RUNTIME_PROVIDER", ""),
            prompt_runtime_model=prompt_runtime_model,
            supervisor_prompt_model=(
                os.getenv("SUPERVISOR_PROMPT_MODEL", "").strip() or prompt_runtime_model
            ),
            agent_prompt_model=(
                os.getenv("AGENT_PROMPT_MODEL", "").strip() or prompt_runtime_model
            ),
            prompt_runtime_provider=os.getenv("PROMPT_RUNTIME_PROVIDER", ""),
            prompt_runtime_transport=os.getenv(
                "PROMPT_RUNTIME_TRANSPORT",
                "responses",
            ).strip()
            or "responses",
            prompt_runtime_api_key=os.getenv("PROMPT_RUNTIME_API_KEY", "").strip(),
            prompt_runtime_base_url=os.getenv(
                "PROMPT_RUNTIME_BASE_URL",
                DEFAULT_PROMPT_RUNTIME_BASE_URL,
            ).strip()
            or DEFAULT_PROMPT_RUNTIME_BASE_URL,
            prompt_runtime_reasoning_effort=(os.getenv("PROMPT_RUNTIME_REASONING_EFFORT") or None),
            prompt_runtime_max_output_tokens=_read_optional_int("PROMPT_RUNTIME_MAX_OUTPUT_TOKENS"),
            prompt_runtime_connect_timeout_seconds=_read_float(
                "PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS",
                default=DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS,
            ),
            prompt_runtime_read_timeout_seconds=_read_float(
                "PROMPT_RUNTIME_READ_TIMEOUT_SECONDS",
                default=DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS,
            ),
            prompt_runtime_write_timeout_seconds=_read_float(
                "PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS",
                default=DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS,
            ),
            prompt_runtime_pool_timeout_seconds=_read_float(
                "PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS",
                default=DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS,
            ),
            prompt_runtime_max_connections=_read_int(
                "PROMPT_RUNTIME_MAX_CONNECTIONS",
                default=DEFAULT_PROMPT_RUNTIME_MAX_CONNECTIONS,
            ),
            prompt_runtime_max_keepalive_connections=_read_int(
                "PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS",
                default=DEFAULT_PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS,
            ),
            prompt_runtime_keepalive_expiry_seconds=_read_float(
                "PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS",
                default=DEFAULT_PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS,
            ),
            prompt_strict_structured_outputs=_read_bool(
                "PROMPT_STRICT_STRUCTURED_OUTPUTS",
                default=True,
            ),
            bridge_worker_threads=_read_int(
                "SUPERVISOR_AGENT_WORKER_THREADS",
                default=8,
            ),
            bridge_request_body_limit_bytes=_read_positive_int(
                "SUPERVISOR_AGENT_WORKER_REQUEST_BODY_LIMIT_BYTES",
                default=DEFAULT_BRIDGE_REQUEST_BODY_LIMIT_BYTES,
            ),
            internal_query_base_url=os.getenv(
                "SUPERVISOR_INTERNAL_QUERY_BASE_URL",
                "",
            ).strip(),
            internal_query_shared_secret=os.getenv(
                "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET",
                "",
            ).strip(),
            structured_query_timeout_seconds=_read_float(
                "SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_SECONDS",
                default=1.0,
            ),
            agents_sdk_runtime_enabled=_read_bool(
                "SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED",
                default=True,
            ),
            retrieval_observation_jsonl_path=os.getenv(
                "SUPERVISOR_RETRIEVAL_OBSERVATION_JSONL_PATH",
                "",
            ).strip(),
            retrieval_runtime_event_jsonl_path=os.getenv(
                "SUPERVISOR_RETRIEVAL_RUNTIME_EVENT_JSONL_PATH",
                "",
            ).strip(),
            retrieval_observation_include_query_text=_read_bool(
                "SUPERVISOR_RETRIEVAL_OBSERVATION_INCLUDE_QUERY_TEXT",
                default=False,
            ),
            otel_enabled=_read_bool(
                "SUPERVISOR_AGENT_WORKER_OTEL_ENABLED",
                default=False,
            ),
            otel_service_name=os.getenv(
                "SUPERVISOR_AGENT_WORKER_OTEL_SERVICE_NAME",
                "campus-supervisor-agent-worker",
            ).strip()
            or "campus-supervisor-agent-worker",
            otel_allowed_attributes_version=os.getenv(
                "SUPERVISOR_AGENT_WORKER_OTEL_ALLOWED_ATTRIBUTES_VERSION",
                "supervisor-agent-worker-otel-attrs-v1",
            ).strip()
            or "supervisor-agent-worker-otel-attrs-v1",
            otel_export_timeout_seconds=_read_positive_float(
                "SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_TIMEOUT_SECONDS",
                default=1.0,
            ),
            otel_export_interval_seconds=_read_positive_float(
                "SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_INTERVAL_SECONDS",
                default=5.0,
            ),
            otel_exporter_otlp_headers=os.getenv(
                "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_HEADERS",
                "",
            ).strip(),
            otel_exporter_otlp_traces_endpoint=os.getenv(
                "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
                "",
            ).strip(),
            otel_exporter_otlp_metrics_endpoint=os.getenv(
                "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
                "",
            ).strip(),
            otel_exporter_otlp_logs_endpoint=os.getenv(
                "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
                "",
            ).strip(),
            cancel_flag_ttl_seconds=_read_positive_float(
                "SUPERVISOR_AGENT_WORKER_CANCEL_FLAG_TTL_SECONDS",
                default=900.0,
            ),
        )


def _require_positive_int(name: str, value: int) -> None:
    if value <= 0:
        raise ValueError(f"{name} must be positive")


def _require_non_negative_int(name: str, value: int) -> None:
    if value < 0:
        raise ValueError(f"{name} must not be negative")


def _require_positive_float(name: str, value: float) -> None:
    if value <= 0:
        raise ValueError(f"{name} must be positive")
