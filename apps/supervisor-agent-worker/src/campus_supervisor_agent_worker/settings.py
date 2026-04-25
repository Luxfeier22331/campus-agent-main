from __future__ import annotations

import os
from dataclasses import dataclass

from campus_shared import APP_NAME
from campus_shared.prompt_runtime import (
    DEFAULT_PROMPT_RUNTIME_BASE_URL,
    DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS,
    DEFAULT_PROMPT_RUNTIME_MAX_CONNECTIONS,
    DEFAULT_PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS,
    DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS,
)


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


def _read_float(name: str, *, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip()
    if not normalized:
        return default
    return float(normalized)


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
    structured_query_base_url: str = ""
    structured_query_shared_secret: str = ""
    structured_query_timeout_seconds: float = 1.0

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
            prompt_runtime_provider=os.getenv(
                "PROMPT_RUNTIME_PROVIDER",
                os.getenv("AGENT_RUNTIME_PROVIDER", ""),
            ),
            prompt_runtime_transport=os.getenv(
                "PROMPT_RUNTIME_TRANSPORT",
                "responses",
            ).strip()
            or "responses",
            prompt_runtime_api_key=os.getenv(
                "PROMPT_RUNTIME_API_KEY",
                os.getenv("LLM_API_KEY", ""),
            ).strip(),
            prompt_runtime_base_url=os.getenv(
                "PROMPT_RUNTIME_BASE_URL",
                os.getenv("LLM_BASE_URL", DEFAULT_PROMPT_RUNTIME_BASE_URL),
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
            structured_query_base_url=os.getenv(
                "SUPERVISOR_STRUCTURED_QUERY_BASE_URL",
                "",
            ).strip(),
            structured_query_shared_secret=os.getenv(
                "SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET",
                "",
            ).strip(),
            structured_query_timeout_seconds=_read_float(
                "SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_SECONDS",
                default=1.0,
            ),
        )
