from __future__ import annotations

import asyncio
import json
import time
import typing as t
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from threading import Lock
from urllib.parse import urlparse

import httpx

from campus_evals.settings import SupplementalHTTPSettings

_REQUEST_PACERS: dict[tuple[str, float], "RequestPacer"] = {}
_REQUEST_PACERS_LOCK = Lock()
_PROVIDER_CIRCUIT_BREAKERS: dict[tuple[str, int, float], "ProviderCircuitBreaker"] = {}
_PROVIDER_CIRCUIT_BREAKERS_LOCK = Lock()
_SHARED_SYNC_CLIENTS: dict[tuple[object, ...], httpx.Client] = {}
_SHARED_SYNC_CLIENTS_LOCK = Lock()
_SHARED_ASYNC_CLIENTS: dict[tuple[object, ...], httpx.AsyncClient] = {}
_SHARED_ASYNC_CLIENTS_LOCK = Lock()
_PREFLIGHT_CACHE: dict[tuple[str, str, str], "_PreflightCacheEntry"] = {}
_PREFLIGHT_CACHE_LOCK = Lock()


@dataclass(frozen=True, slots=True)
class _PreflightCacheEntry:
    status: str
    result: dict[str, object] | None = None
    error_message: str | None = None
    error_reasons: tuple[str, ...] = ()
    failure_disposition: str | None = None
    expires_at: float | None = None


class RequestPacer:
    def __init__(self, min_interval_seconds: float) -> None:
        self.min_interval_seconds = min_interval_seconds
        self._next_allowed_at = 0.0
        self._lock = Lock()

    def reserve_delay_seconds(self) -> float:
        if self.min_interval_seconds <= 0:
            return 0.0
        with self._lock:
            now = time.monotonic()
            scheduled_at = max(now, self._next_allowed_at)
            self._next_allowed_at = scheduled_at + self.min_interval_seconds
            return max(0.0, scheduled_at - now)

    def wait_sync(self) -> None:
        delay_seconds = self.reserve_delay_seconds()
        if delay_seconds > 0:
            time.sleep(delay_seconds)

    async def wait_async(self) -> None:
        delay_seconds = self.reserve_delay_seconds()
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)

    def defer_until_after(self, delay_seconds: float) -> None:
        if delay_seconds <= 0:
            return
        with self._lock:
            self._next_allowed_at = max(self._next_allowed_at, time.monotonic() + delay_seconds)

    def observe_response_headers(self, headers: httpx.Headers) -> None:
        delay_seconds = _parse_retry_after_seconds(headers)
        if delay_seconds is None:
            return
        self.defer_until_after(delay_seconds)


class ProviderCircuitBreaker:
    def __init__(
        self,
        *,
        origin: str,
        failure_threshold: int,
        cooldown_seconds: float,
    ) -> None:
        self.origin = origin
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self._consecutive_failures = 0
        self._opened_until = 0.0
        self._last_failure_reasons: tuple[str, ...] = ()
        self._last_failure_disposition: str | None = None
        self._lock = Lock()

    def ensure_request_allowed(self) -> None:
        from campus_evals.supplemental_http_runtime import SupplementalCircuitOpenError

        with self._lock:
            now = time.monotonic()
            if now >= self._opened_until:
                return
            reasons = self._last_failure_reasons or ("circuit_open",)
            raise SupplementalCircuitOpenError(
                f"circuit_open: provider origin {self.origin} is in cooldown",
                reasons=("circuit_open", *reasons),
                disposition=self._last_failure_disposition,
            )

    def record_success(self) -> None:
        with self._lock:
            self._consecutive_failures = 0
            self._opened_until = 0.0
            self._last_failure_reasons = ()
            self._last_failure_disposition = None

    def record_failure(self, *, reasons: tuple[str, ...], disposition: str | None) -> bool:
        with self._lock:
            self._consecutive_failures += 1
            self._last_failure_reasons = reasons
            self._last_failure_disposition = disposition
            if self._consecutive_failures < self.failure_threshold:
                return False
            self._opened_until = time.monotonic() + self.cooldown_seconds
            return True

    def trip(self, *, reasons: tuple[str, ...], disposition: str | None) -> None:
        with self._lock:
            self._consecutive_failures = self.failure_threshold
            self._last_failure_reasons = reasons
            self._last_failure_disposition = disposition
            self._opened_until = time.monotonic() + self.cooldown_seconds


def get_request_pacer(
    *,
    base_url: str,
    api_key: str,
    min_interval_seconds: float,
) -> RequestPacer | None:
    if min_interval_seconds <= 0:
        return None
    key = (_runtime_scope_key(base_url, api_key), float(min_interval_seconds))
    with _REQUEST_PACERS_LOCK:
        existing = _REQUEST_PACERS.get(key)
        if existing is not None:
            return existing
        pacer = RequestPacer(min_interval_seconds)
        _REQUEST_PACERS[key] = pacer
        return pacer


def get_provider_circuit_breaker(
    *,
    base_url: str,
    api_key: str,
    settings: SupplementalHTTPSettings,
) -> ProviderCircuitBreaker:
    key = (
        _runtime_scope_key(base_url, api_key),
        settings.circuit_breaker_failure_threshold,
        float(settings.circuit_breaker_cooldown_seconds),
    )
    with _PROVIDER_CIRCUIT_BREAKERS_LOCK:
        existing = _PROVIDER_CIRCUIT_BREAKERS.get(key)
        if existing is not None:
            return existing
        breaker = ProviderCircuitBreaker(
            origin=_pacer_scope_key(base_url),
            failure_threshold=settings.circuit_breaker_failure_threshold,
            cooldown_seconds=settings.circuit_breaker_cooldown_seconds,
        )
        _PROVIDER_CIRCUIT_BREAKERS[key] = breaker
        return breaker


def _pacer_scope_key(base_url: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return base_url.rstrip("/")


def _runtime_scope_key(base_url: str, api_key: str) -> str:
    return f"{_pacer_scope_key(base_url)}::{api_key}"


def _shared_client_key(
    *,
    base_url: str,
    api_key: str,
    settings: SupplementalHTTPSettings,
) -> tuple[object, ...]:
    return (
        base_url.rstrip("/"),
        api_key,
        float(settings.connect_timeout_seconds),
        float(settings.read_timeout_seconds),
        float(settings.write_timeout_seconds),
        float(settings.pool_timeout_seconds),
        float(settings.keepalive_expiry_seconds),
        int(settings.max_connections),
        int(settings.max_keepalive_connections),
    )


def _build_httpx_limits(settings: SupplementalHTTPSettings) -> httpx.Limits:
    return httpx.Limits(
        max_connections=settings.max_connections,
        max_keepalive_connections=settings.max_keepalive_connections,
        keepalive_expiry=settings.keepalive_expiry_seconds,
    )


def get_shared_sync_client(
    *,
    base_url: str,
    api_key: str,
    settings: SupplementalHTTPSettings,
) -> httpx.Client:
    key = _shared_client_key(base_url=base_url, api_key=api_key, settings=settings)
    with _SHARED_SYNC_CLIENTS_LOCK:
        existing = _SHARED_SYNC_CLIENTS.get(key)
        if existing is not None:
            return existing
        client = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=_build_httpx_timeout(settings),
            limits=_build_httpx_limits(settings),
            trust_env=False,
        )
        _SHARED_SYNC_CLIENTS[key] = client
        return client


def get_shared_async_client(
    *,
    base_url: str,
    api_key: str,
    settings: SupplementalHTTPSettings,
) -> httpx.AsyncClient:
    current_loop = asyncio.get_running_loop()
    key = _shared_client_key(base_url=base_url, api_key=api_key, settings=settings) + (
        current_loop,
    )
    with _SHARED_ASYNC_CLIENTS_LOCK:
        existing = _SHARED_ASYNC_CLIENTS.get(key)
        if existing is not None and not getattr(existing, "is_closed", False):
            return existing
        client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=_build_httpx_timeout(settings),
            limits=_build_httpx_limits(settings),
            trust_env=False,
        )
        _SHARED_ASYNC_CLIENTS[key] = client
        return client


def _preflight_cache_key(
    *,
    base_url: str,
    api_key: str,
    endpoint: str,
    payload: dict[str, t.Any],
) -> tuple[str, str, str]:
    return (
        _runtime_scope_key(base_url, api_key),
        endpoint,
        json.dumps(payload, sort_keys=True, ensure_ascii=False),
    )


def _get_cached_preflight_entry(cache_key: tuple[str, str, str]) -> _PreflightCacheEntry | None:
    with _PREFLIGHT_CACHE_LOCK:
        entry = _PREFLIGHT_CACHE.get(cache_key)
        if entry is None:
            return None
        if entry.expires_at is not None and time.monotonic() >= entry.expires_at:
            _PREFLIGHT_CACHE.pop(cache_key, None)
            return None
        return entry


def _store_preflight_entry(cache_key: tuple[str, str, str], entry: _PreflightCacheEntry) -> None:
    with _PREFLIGHT_CACHE_LOCK:
        _PREFLIGHT_CACHE[cache_key] = entry


def _parse_retry_after_seconds(headers: httpx.Headers) -> float | None:
    raw_value = headers.get("retry-after")
    if raw_value is None:
        return None
    normalized = raw_value.strip()
    if not normalized:
        return None
    try:
        seconds = float(normalized)
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(normalized)
        except (TypeError, ValueError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        seconds = (retry_at - datetime.now(timezone.utc)).total_seconds()
    return max(0.0, seconds)


def reset_supplemental_http_runtime_state_for_tests() -> None:
    with _REQUEST_PACERS_LOCK:
        _REQUEST_PACERS.clear()
    with _PROVIDER_CIRCUIT_BREAKERS_LOCK:
        _PROVIDER_CIRCUIT_BREAKERS.clear()
    with _PREFLIGHT_CACHE_LOCK:
        _PREFLIGHT_CACHE.clear()
    with _SHARED_SYNC_CLIENTS_LOCK:
        clients = list(_SHARED_SYNC_CLIENTS.values())
        _SHARED_SYNC_CLIENTS.clear()
    for client in clients:
        close = getattr(client, "close", None)
        if callable(close):
            close()
    with _SHARED_ASYNC_CLIENTS_LOCK:
        async_clients = list(_SHARED_ASYNC_CLIENTS.values())
        _SHARED_ASYNC_CLIENTS.clear()
    for client in async_clients:
        if getattr(client, "is_closed", False):
            continue
        aclose = getattr(client, "aclose", None)
        if not callable(aclose):
            continue
        try:
            asyncio.run(aclose())
        except RuntimeError:
            continue


def _build_httpx_timeout(
    settings: SupplementalHTTPSettings,
    *,
    preflight: bool = False,
) -> httpx.Timeout:
    if not preflight:
        return httpx.Timeout(
            connect=settings.connect_timeout_seconds,
            read=settings.read_timeout_seconds,
            write=settings.write_timeout_seconds,
            pool=settings.pool_timeout_seconds,
        )
    timeout = settings.preflight_timeout_seconds
    return httpx.Timeout(
        connect=min(settings.connect_timeout_seconds, timeout),
        read=min(settings.read_timeout_seconds, timeout),
        write=min(settings.write_timeout_seconds, timeout),
        pool=min(settings.pool_timeout_seconds, timeout),
    )


__all__ = [
    "ProviderCircuitBreaker",
    "RequestPacer",
    "_PreflightCacheEntry",
    "_build_httpx_timeout",
    "_get_cached_preflight_entry",
    "_pacer_scope_key",
    "_preflight_cache_key",
    "_runtime_scope_key",
    "_store_preflight_entry",
    "get_provider_circuit_breaker",
    "get_request_pacer",
    "get_shared_async_client",
    "get_shared_sync_client",
    "reset_supplemental_http_runtime_state_for_tests",
]
