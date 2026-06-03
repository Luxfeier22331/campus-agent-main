from __future__ import annotations

from dataclasses import dataclass

import httpx

from .constants import (
    DEFAULT_PROMPT_RUNTIME_BASE_URL,
    DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS,
    DEFAULT_PROMPT_RUNTIME_MAX_CONNECTIONS,
    DEFAULT_PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS,
    DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS,
)
from .contracts import PromptRuntimeTransport


@dataclass(frozen=True, slots=True)
class PromptRuntimeHTTPSettings:
    connect_timeout_seconds: float = DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS
    read_timeout_seconds: float = DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS
    write_timeout_seconds: float = DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS
    pool_timeout_seconds: float = DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS
    max_connections: int = DEFAULT_PROMPT_RUNTIME_MAX_CONNECTIONS
    max_keepalive_connections: int = DEFAULT_PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS
    keepalive_expiry_seconds: float = DEFAULT_PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS

    def __post_init__(self) -> None:
        if self.connect_timeout_seconds <= 0:
            raise ValueError("connect_timeout_seconds must be greater than zero")
        if self.read_timeout_seconds <= 0:
            raise ValueError("read_timeout_seconds must be greater than zero")
        if self.write_timeout_seconds <= 0:
            raise ValueError("write_timeout_seconds must be greater than zero")
        if self.pool_timeout_seconds <= 0:
            raise ValueError("pool_timeout_seconds must be greater than zero")
        if self.max_connections <= 0:
            raise ValueError("max_connections must be greater than zero")
        if self.max_keepalive_connections < 0:
            raise ValueError("max_keepalive_connections must not be negative")
        if self.max_keepalive_connections > self.max_connections:
            raise ValueError("max_keepalive_connections must not exceed max_connections")
        if self.keepalive_expiry_seconds <= 0:
            raise ValueError("keepalive_expiry_seconds must be greater than zero")

    def to_httpx_timeout(self) -> httpx.Timeout:
        return httpx.Timeout(
            connect=self.connect_timeout_seconds,
            read=self.read_timeout_seconds,
            write=self.write_timeout_seconds,
            pool=self.pool_timeout_seconds,
        )

    def to_httpx_limits(self) -> httpx.Limits:
        return httpx.Limits(
            max_connections=self.max_connections,
            max_keepalive_connections=self.max_keepalive_connections,
            keepalive_expiry=self.keepalive_expiry_seconds,
        )


@dataclass(frozen=True, slots=True)
class PromptRuntimeProviderConfig:
    provider: str
    api_key: str
    base_url: str = DEFAULT_PROMPT_RUNTIME_BASE_URL
    transport: PromptRuntimeTransport = "responses"
    supports_safety_identifier: bool = True
    reasoning_effort: str | None = None
    max_output_tokens: int | None = None
    http_settings: PromptRuntimeHTTPSettings = PromptRuntimeHTTPSettings()

    def __post_init__(self) -> None:
        if not self.provider.strip():
            raise ValueError("provider must not be empty")
        if not self.api_key.strip():
            raise ValueError("api_key must not be empty")
        if not self.base_url.strip():
            raise ValueError("base_url must not be empty")
        if self.transport != "responses":
            raise ValueError("transport must be 'responses'")
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be greater than zero")
