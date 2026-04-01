from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import random
import re
from threading import Lock
import time
import typing as t
from urllib.parse import urlparse

import httpx
from langchain_core.outputs import Generation, LLMResult
from pydantic import BaseModel, ValidationError
from ragas.embeddings.base import BaseRagasEmbeddings
from ragas.llms.base import BaseRagasLLM, InstructorBaseRagasLLM

from campus_evals.runtime_observability import emit_runtime_event
from campus_evals.settings import RagasSettings, SupplementalHTTPSettings


_RETRYABLE_PROVIDER_ERROR_MARKERS = (
    "system_cpu_overloaded",
    "bad_response_body",
    "do_request_failed",
)
_HARD_UNAVAILABLE_REASON_MARKERS = {
    "auth_unavailable": (
        "auth_unavailable",
        "no auth available",
        "invalid_api_key",
        "invalid api key",
        "authentication failed",
        "authentication_error",
        "unauthorized",
        "forbidden",
    ),
    "quota_unavailable": (
        "insufficient_quota",
        "quota exceeded",
        "quota_exceeded",
    ),
}
_NON_RETRYABLE_REASON_MARKERS = {
    "invalid_request": (
        "invalid_request",
        "invalid request",
        "unsupported parameter",
        "unsupported_parameter",
        "unsupported value",
        "bad request",
    ),
    "model_not_found": (
        "model_not_found",
        "unknown model",
        "model not found",
    ),
}
_TIMEOUT_ERROR_MARKERS = (
    "timeout",
    "timed out",
    "readtimeout",
    "connecttimeout",
    "writetimeout",
    "pooltimeout",
)
_TRANSPORT_ERROR_MARKERS = (
    "connecterror",
    "readerror",
    "writeerror",
    "networkerror",
    "transport error",
    "remoteprotocolerror",
    "connection reset",
)
_FAST_FAIL_ERROR_MARKERS = (
    "circuit_open",
    "preflight_failed",
)
_BEARER_TOKEN_RE = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._-]+\b")
_RUNTIME_SCOPE_SECRET_RE = re.compile(r"::[A-Za-z0-9._-]{6,}")
_SK_LIKE_TOKEN_RE = re.compile(r"\bsk-[A-Za-z0-9._-]{6,}\b")
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
StructuredOutputModel = t.TypeVar("StructuredOutputModel", bound=BaseModel)


class SupplementalFastFailError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        reasons: tuple[str, ...],
        disposition: str | None = None,
    ) -> None:
        super().__init__(message)
        self.reasons = reasons
        self.disposition = disposition


class SupplementalPreflightFailedError(SupplementalFastFailError):
    pass


class SupplementalCircuitOpenError(SupplementalFastFailError):
    pass


class SupplementalProviderUnavailableError(SupplementalFastFailError):
    pass


class SupplementalNonRetryableRequestError(SupplementalFastFailError):
    pass


@dataclass(frozen=True, slots=True)
class RuntimeFailureClassification:
    disposition: str
    reasons: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _PreflightCacheEntry:
    status: str
    result: dict[str, object] | None = None
    error_message: str | None = None
    error_reasons: tuple[str, ...] = ()
    failure_disposition: str | None = None
    expires_at: float | None = None


class _ResponsesStructuredPreflightModel(BaseModel):
    status: str


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


class OpenAICompatibleTextResponsesLLM(BaseRagasLLM):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        http_settings: SupplementalHTTPSettings,
        reasoning_effort: str | None = None,
        text_verbosity: str | None = None,
        max_output_tokens: int | None = None,
        request_pacer: RequestPacer | None = None,
        circuit_breaker: ProviderCircuitBreaker | None = None,
        cache=None,
        sync_client: httpx.Client | None = None,
        async_client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(cache=cache)
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.http_settings = http_settings
        self.reasoning_effort = reasoning_effort
        self.text_verbosity = text_verbosity
        self.max_output_tokens = max_output_tokens
        self.request_pacer = request_pacer
        self.circuit_breaker = circuit_breaker
        self._sync_client = sync_client
        self._async_client = async_client

    def generate_text(
        self,
        prompt,
        n: int = 1,
        temperature: float = 0.01,
        stop: list[str] | None = None,
        callbacks=None,
    ) -> LLMResult:
        generations = [
            Generation(
                text=_extract_output_text(
                    self._post_json_sync(
                        "/responses",
                        _build_responses_payload(
                            model=self.model,
                            prompt=prompt,
                            temperature=temperature,
                            reasoning_effort=self.reasoning_effort,
                            text_verbosity=self.text_verbosity,
                            max_output_tokens=self.max_output_tokens,
                        ),
                    )
                ),
                generation_info={"finish_reason": "stop"},
            )
            for _ in range(n)
        ]
        return LLMResult(
            generations=[generations],
            llm_output={"provider": "responses_http", "model": self.model},
        )

    async def agenerate_text(
        self,
        prompt,
        n: int = 1,
        temperature: float | None = 0.01,
        stop: list[str] | None = None,
        callbacks=None,
    ) -> LLMResult:
        requests = [
            self._post_json_async(
                "/responses",
                _build_responses_payload(
                    model=self.model,
                    prompt=prompt,
                    temperature=temperature,
                    reasoning_effort=self.reasoning_effort,
                    text_verbosity=self.text_verbosity,
                    max_output_tokens=self.max_output_tokens,
                ),
            )
            for _ in range(n)
        ]
        responses = await asyncio.gather(*requests)
        generations = [
            Generation(
                text=_extract_output_text(response_json),
                generation_info={"finish_reason": "stop"},
            )
            for response_json in responses
        ]
        return LLMResult(
            generations=[generations],
            llm_output={"provider": "responses_http", "model": self.model},
        )

    def is_finished(self, response: LLMResult) -> bool:
        return True

    def preflight_sync(self) -> dict[str, object]:
        payload = _build_responses_payload(
            model=self.model,
            prompt="Reply with OK only.",
            temperature=0.0,
            reasoning_effort=self.reasoning_effort,
            text_verbosity=self.text_verbosity,
            max_output_tokens=min(self.max_output_tokens or 16, 16),
        )
        cache_key = _preflight_cache_key(
            base_url=self.base_url,
            api_key=self.api_key,
            endpoint="/responses",
            payload=payload,
        )
        cached = _get_cached_preflight_entry(cache_key)
        if cached is not None:
            if cached.status == "passed" and cached.result is not None:
                return dict(cached.result)
            raise SupplementalPreflightFailedError(
                cached.error_message or "preflight_failed",
                reasons=cached.error_reasons,
                disposition=cached.failure_disposition,
            )
        try:
            output_text = _extract_output_text(
                _request_json_sync(
                    lambda: self._get_sync_client().post(
                        "/responses",
                        json=payload,
                        headers=_build_headers(self.api_key),
                        timeout=_build_httpx_timeout(self.http_settings, preflight=True),
                    ),
                    http_settings=self.http_settings,
                    circuit_breaker=self.circuit_breaker,
                    retry_attempts=self.http_settings.retry_attempts,
                    request_pacer=self.request_pacer,
                    event_metadata=_build_runtime_event_metadata(
                        base_url=self.base_url,
                        endpoint="/responses",
                        model=self.model,
                        request_kind="llm",
                        preflight=True,
                    ),
                )
            )
        except Exception as exc:
            classification = classify_runtime_failure(str(exc), error_type=type(exc).__name__)
            reasons = ("preflight_failed", *classification.reasons)
            error_message = f"preflight_failed: {format_runtime_exception_message(exc)}"
            _store_preflight_entry(
                cache_key,
                _PreflightCacheEntry(
                    status="failed",
                    error_message=error_message,
                    error_reasons=reasons,
                    failure_disposition=classification.disposition,
                    expires_at=time.monotonic() + self.http_settings.circuit_breaker_cooldown_seconds,
                ),
            )
            raise SupplementalPreflightFailedError(
                error_message,
                reasons=reasons,
                disposition=classification.disposition,
            ) from exc
        result = {
            "status": "passed",
            "endpoint": "/responses",
            "model": self.model,
            "output_text": output_text,
        }
        _store_preflight_entry(
            cache_key,
            _PreflightCacheEntry(
                status="passed",
                result=result,
            ),
        )
        return result

    def _post_json_sync(self, path: str, payload: dict[str, t.Any]) -> dict[str, t.Any]:
        return _request_json_sync(
            lambda: self._get_sync_client().post(path, json=payload, headers=_build_headers(self.api_key)),
            http_settings=self.http_settings,
            circuit_breaker=self.circuit_breaker,
            request_pacer=self.request_pacer,
            event_metadata=_build_runtime_event_metadata(
                base_url=self.base_url,
                endpoint=path,
                model=self.model,
                request_kind="llm",
                preflight=False,
            ),
        )

    async def _post_json_async(self, path: str, payload: dict[str, t.Any]) -> dict[str, t.Any]:
        return await _request_json_async(
            lambda: self._get_async_client().post(path, json=payload, headers=_build_headers(self.api_key)),
            http_settings=self.http_settings,
            circuit_breaker=self.circuit_breaker,
            request_pacer=self.request_pacer,
            event_metadata=_build_runtime_event_metadata(
                base_url=self.base_url,
                endpoint=path,
                model=self.model,
                request_kind="llm",
                preflight=False,
            ),
        )

    def _get_sync_client(self) -> httpx.Client:
        if self._sync_client is not None:
            return self._sync_client
        return get_shared_sync_client(
            base_url=self.base_url,
            api_key=self.api_key,
            settings=self.http_settings,
        )

    def _get_async_client(self) -> httpx.AsyncClient:
        if self._async_client is not None:
            return self._async_client
        return get_shared_async_client(
            base_url=self.base_url,
            api_key=self.api_key,
            settings=self.http_settings,
        )


class OpenAICompatibleResponsesLLM(OpenAICompatibleTextResponsesLLM, InstructorBaseRagasLLM):
    @property
    def is_async(self) -> bool:
        return True

    def generate(
        self,
        prompt: str,
        response_model: type[StructuredOutputModel],
    ) -> StructuredOutputModel:
        payload = _build_responses_structured_payload(
            model=self.model,
            prompt=prompt,
            response_model=response_model,
            reasoning_effort=self.reasoning_effort,
            max_output_tokens=self.max_output_tokens,
        )
        return _extract_structured_output_model(
            self._post_json_sync("/responses", payload),
            response_model=response_model,
        )

    async def agenerate(
        self,
        prompt: str,
        response_model: type[StructuredOutputModel],
    ) -> StructuredOutputModel:
        payload = _build_responses_structured_payload(
            model=self.model,
            prompt=prompt,
            response_model=response_model,
            reasoning_effort=self.reasoning_effort,
            max_output_tokens=self.max_output_tokens,
        )
        return _extract_structured_output_model(
            await self._post_json_async("/responses", payload),
            response_model=response_model,
        )

    def preflight_sync(self) -> dict[str, object]:
        payload = _build_responses_structured_payload(
            model=self.model,
            prompt="Return a JSON object with status set to 'ok'.",
            response_model=_ResponsesStructuredPreflightModel,
            reasoning_effort=self.reasoning_effort,
            max_output_tokens=min(self.max_output_tokens or 32, 32),
        )
        cache_key = _preflight_cache_key(
            base_url=self.base_url,
            api_key=self.api_key,
            endpoint="/responses",
            payload=payload,
        )
        cached = _get_cached_preflight_entry(cache_key)
        if cached is not None:
            if cached.status == "passed" and cached.result is not None:
                return dict(cached.result)
            raise SupplementalPreflightFailedError(
                cached.error_message or "preflight_failed",
                reasons=cached.error_reasons,
                disposition=cached.failure_disposition,
            )
        try:
            result_model = _extract_structured_output_model(
                _request_json_sync(
                    lambda: self._get_sync_client().post(
                        "/responses",
                        json=payload,
                        headers=_build_headers(self.api_key),
                        timeout=_build_httpx_timeout(self.http_settings, preflight=True),
                    ),
                    http_settings=self.http_settings,
                    circuit_breaker=self.circuit_breaker,
                    retry_attempts=self.http_settings.retry_attempts,
                    request_pacer=self.request_pacer,
                    event_metadata=_build_runtime_event_metadata(
                        base_url=self.base_url,
                        endpoint="/responses",
                        model=self.model,
                        request_kind="llm",
                        preflight=True,
                    ),
                ),
                response_model=_ResponsesStructuredPreflightModel,
            )
        except Exception as exc:
            classification = _classify_preflight_exception(exc)
            reasons = ("preflight_failed", *classification.reasons)
            error_message = f"preflight_failed: {format_runtime_exception_message(exc)}"
            _store_preflight_entry(
                cache_key,
                _PreflightCacheEntry(
                    status="failed",
                    error_message=error_message,
                    error_reasons=reasons,
                    failure_disposition=classification.disposition,
                    expires_at=time.monotonic() + self.http_settings.circuit_breaker_cooldown_seconds,
                ),
            )
            raise SupplementalPreflightFailedError(
                error_message,
                reasons=reasons,
                disposition=classification.disposition,
            ) from exc
        result = {
            "status": "passed",
            "endpoint": "/responses",
            "model": self.model,
            "structured_output": result_model.model_dump(mode="json"),
        }
        _store_preflight_entry(
            cache_key,
            _PreflightCacheEntry(
                status="passed",
                result=result,
            ),
        )
        return result


class OpenAICompatibleHTTPEmbeddings(BaseRagasEmbeddings):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        http_settings: SupplementalHTTPSettings,
        dimensions: int | None = None,
        request_pacer: RequestPacer | None = None,
        circuit_breaker: ProviderCircuitBreaker | None = None,
        cache=None,
        sync_client: httpx.Client | None = None,
        async_client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(cache=cache)
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.http_settings = http_settings
        self.dimensions = dimensions
        self.request_pacer = request_pacer
        self.circuit_breaker = circuit_breaker
        self._sync_client = sync_client
        self._async_client = async_client

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        payload = _build_embeddings_payload(
            model=self.model,
            texts=texts,
            dimensions=self.dimensions,
        )
        return _extract_embeddings(
            _request_json_sync(
                lambda: self._get_sync_client().post("/embeddings", json=payload, headers=_build_headers(self.api_key)),
                http_settings=self.http_settings,
                circuit_breaker=self.circuit_breaker,
                request_pacer=self.request_pacer,
                event_metadata=_build_runtime_event_metadata(
                    base_url=self.base_url,
                    endpoint="/embeddings",
                    model=self.model,
                    request_kind="embeddings",
                    preflight=False,
                ),
            )
        )

    async def aembed_query(self, text: str) -> list[float]:
        return (await self.aembed_documents([text]))[0]

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        payload = _build_embeddings_payload(
            model=self.model,
            texts=texts,
            dimensions=self.dimensions,
        )
        return _extract_embeddings(
            await _request_json_async(
                lambda: self._get_async_client().post("/embeddings", json=payload, headers=_build_headers(self.api_key)),
                http_settings=self.http_settings,
                circuit_breaker=self.circuit_breaker,
                request_pacer=self.request_pacer,
                event_metadata=_build_runtime_event_metadata(
                    base_url=self.base_url,
                    endpoint="/embeddings",
                    model=self.model,
                    request_kind="embeddings",
                    preflight=False,
                ),
            )
        )

    def preflight_sync(self) -> dict[str, object]:
        payload = _build_embeddings_payload(
            model=self.model,
            texts=["supplemental preflight"],
            dimensions=self.dimensions,
        )
        cache_key = _preflight_cache_key(
            base_url=self.base_url,
            api_key=self.api_key,
            endpoint="/embeddings",
            payload=payload,
        )
        cached = _get_cached_preflight_entry(cache_key)
        if cached is not None:
            if cached.status == "passed" and cached.result is not None:
                return dict(cached.result)
            raise SupplementalPreflightFailedError(
                cached.error_message or "preflight_failed",
                reasons=cached.error_reasons,
                disposition=cached.failure_disposition,
            )
        try:
            _request_json_sync(
                lambda: self._get_sync_client().post(
                    "/embeddings",
                    json=payload,
                    headers=_build_headers(self.api_key),
                    timeout=_build_httpx_timeout(self.http_settings, preflight=True),
                ),
                http_settings=self.http_settings,
                circuit_breaker=self.circuit_breaker,
                retry_attempts=self.http_settings.retry_attempts,
                request_pacer=self.request_pacer,
                event_metadata=_build_runtime_event_metadata(
                    base_url=self.base_url,
                    endpoint="/embeddings",
                    model=self.model,
                    request_kind="embeddings",
                    preflight=True,
                ),
            )
        except Exception as exc:
            classification = classify_runtime_failure(str(exc), error_type=type(exc).__name__)
            reasons = ("preflight_failed", *classification.reasons)
            error_message = f"preflight_failed: {format_runtime_exception_message(exc)}"
            _store_preflight_entry(
                cache_key,
                _PreflightCacheEntry(
                    status="failed",
                    error_message=error_message,
                    error_reasons=reasons,
                    failure_disposition=classification.disposition,
                    expires_at=time.monotonic() + self.http_settings.circuit_breaker_cooldown_seconds,
                ),
            )
            raise SupplementalPreflightFailedError(
                error_message,
                reasons=reasons,
                disposition=classification.disposition,
            ) from exc
        result = {"status": "passed", "endpoint": "/embeddings", "model": self.model}
        _store_preflight_entry(
            cache_key,
            _PreflightCacheEntry(
                status="passed",
                result=result,
            ),
        )
        return result

    def _get_sync_client(self) -> httpx.Client:
        if self._sync_client is not None:
            return self._sync_client
        return get_shared_sync_client(
            base_url=self.base_url,
            api_key=self.api_key,
            settings=self.http_settings,
        )

    def _get_async_client(self) -> httpx.AsyncClient:
        if self._async_client is not None:
            return self._async_client
        return get_shared_async_client(
            base_url=self.base_url,
            api_key=self.api_key,
            settings=self.http_settings,
        )


def build_http_ragas_llm(
    settings: RagasSettings,
    *,
    sync_client: httpx.Client | None = None,
    async_client: httpx.AsyncClient | None = None,
) -> OpenAICompatibleTextResponsesLLM:
    request_pacer = get_request_pacer(
        base_url=settings.llm_base_url or "https://api.openai.com/v1",
        api_key=settings.llm_api_key,
        min_interval_seconds=settings.http_settings.request_min_interval_seconds,
    )
    circuit_breaker = get_provider_circuit_breaker(
        base_url=settings.llm_base_url or "https://api.openai.com/v1",
        api_key=settings.llm_api_key,
        settings=settings.http_settings,
    )
    return OpenAICompatibleTextResponsesLLM(
        base_url=settings.llm_base_url or "https://api.openai.com/v1",
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        http_settings=settings.http_settings,
        reasoning_effort=settings.reasoning_effort,
        text_verbosity=settings.text_verbosity,
        max_output_tokens=settings.max_output_tokens,
        request_pacer=request_pacer,
        circuit_breaker=circuit_breaker,
        sync_client=sync_client,
        async_client=async_client,
    )


def build_http_ragas_embeddings(
    settings: RagasSettings,
    *,
    sync_client: httpx.Client | None = None,
    async_client: httpx.AsyncClient | None = None,
) -> OpenAICompatibleHTTPEmbeddings:
    base_url = settings.embedding_base_url or settings.llm_base_url or "https://api.openai.com/v1"
    request_pacer = get_request_pacer(
        base_url=base_url,
        api_key=settings.embedding_api_key,
        min_interval_seconds=settings.http_settings.request_min_interval_seconds,
    )
    circuit_breaker = get_provider_circuit_breaker(
        base_url=base_url,
        api_key=settings.embedding_api_key,
        settings=settings.http_settings,
    )
    return OpenAICompatibleHTTPEmbeddings(
        base_url=base_url,
        api_key=settings.embedding_api_key,
        model=settings.embedding_model,
        http_settings=settings.http_settings,
        dimensions=settings.embedding_dimensions,
        request_pacer=request_pacer,
        circuit_breaker=circuit_breaker,
        sync_client=sync_client,
        async_client=async_client,
    )


def _build_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _build_responses_payload(
    *,
    model: str,
    prompt,
    temperature: float | None,
    reasoning_effort: str | None,
    text_verbosity: str | None,
    max_output_tokens: int | None,
) -> dict[str, t.Any]:
    payload: dict[str, t.Any] = {
        "model": model,
        "stream": False,
        "input": _prompt_to_responses_input(prompt),
    }
    if temperature is not None:
        payload["temperature"] = temperature
    if reasoning_effort is not None:
        payload["reasoning"] = {"effort": reasoning_effort}
    if text_verbosity is not None:
        payload["text"] = {"format": {"type": "text"}, "verbosity": text_verbosity}
    if max_output_tokens is not None:
        payload["max_output_tokens"] = max_output_tokens
    return payload


def _build_responses_structured_payload(
    *,
    model: str,
    prompt: str,
    response_model: type[BaseModel],
    reasoning_effort: str | None,
    max_output_tokens: int | None,
) -> dict[str, t.Any]:
    schema = _close_json_schema_objects(response_model.model_json_schema())
    payload: dict[str, t.Any] = {
        "model": model,
        "stream": False,
        "input": [
            {
                "role": "user",
                "type": "message",
                "content": prompt,
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": response_model.__name__,
                "schema": schema,
                "strict": True,
            }
        },
    }
    if reasoning_effort is not None:
        payload["reasoning"] = {"effort": reasoning_effort}
    if max_output_tokens is not None:
        payload["max_output_tokens"] = max_output_tokens
    return payload


def _close_json_schema_objects(schema: t.Any) -> t.Any:
    if isinstance(schema, dict):
        normalized = {
            key: _close_json_schema_objects(value)
            for key, value in schema.items()
        }
        if normalized.get("type") == "object" and "additionalProperties" not in normalized:
            normalized["additionalProperties"] = False
        return normalized
    if isinstance(schema, list):
        return [_close_json_schema_objects(item) for item in schema]
    return schema


def _build_embeddings_payload(
    *,
    model: str,
    texts: list[str],
    dimensions: int | None,
) -> dict[str, t.Any]:
    payload: dict[str, t.Any] = {
        "model": model,
        "input": texts,
    }
    if dimensions is not None:
        payload["dimensions"] = dimensions
    return payload


def _build_runtime_event_metadata(
    *,
    base_url: str,
    endpoint: str,
    model: str,
    request_kind: str,
    preflight: bool,
) -> dict[str, t.Any]:
    return {
        "provider_origin": _pacer_scope_key(base_url),
        "endpoint": endpoint,
        "model": model,
        "request_kind": request_kind,
        "preflight": preflight,
    }


def _prompt_to_responses_input(prompt) -> list[dict[str, t.Any]]:
    if isinstance(prompt, str):
        return [
            {
                "role": "user",
                "type": "message",
                "content": prompt,
            }
        ]
    messages = prompt.to_messages()
    items: list[dict[str, t.Any]] = []
    for message in messages:
        role = _message_role(message)
        items.append(
            {
                "role": role,
                "type": "message",
                "content": _message_content_to_text(getattr(message, "content", "")),
            }
        )
    return items


def _message_role(message) -> str:
    message_type = getattr(message, "type", "human")
    if message_type == "human":
        return "user"
    if message_type == "ai":
        return "assistant"
    if message_type == "system":
        return "system"
    return "user"


def _message_content_to_text(content: t.Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(part for part in parts if part)
    return str(content)


def _decode_json_response(response: httpx.Response) -> dict[str, t.Any]:
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(f"{response.status_code} {response.text}") from exc
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("provider response must be a JSON object")
    error = payload.get("error")
    if error:
        raise RuntimeError(json.dumps(error, ensure_ascii=False))
    return payload


def _request_json_sync(
    request_fn: t.Callable[[], httpx.Response],
    *,
    http_settings: SupplementalHTTPSettings,
    circuit_breaker: ProviderCircuitBreaker | None,
    retry_attempts: int | None = None,
    request_pacer: RequestPacer | None = None,
    event_metadata: dict[str, t.Any] | None = None,
) -> dict[str, t.Any]:
    total_attempts = 1 + (http_settings.retry_attempts if retry_attempts is None else retry_attempts)
    if circuit_breaker is not None:
        try:
            circuit_breaker.ensure_request_allowed()
        except SupplementalCircuitOpenError as exc:
            emit_runtime_event(
                "supplemental_breaker_fast_failed",
                **dict(event_metadata or {}),
                failure_reasons=list(getattr(exc, "reasons", ()) or ()),
                failure_disposition=getattr(exc, "disposition", None),
            )
            raise
    for attempt in range(1, total_attempts + 1):
        http_status: int | None = None
        request_id: str | None = None
        started_at = time.perf_counter()
        try:
            if request_pacer is not None:
                request_pacer.wait_sync()
            response = request_fn()
            http_status = response.status_code
            request_id = _extract_request_id(response.headers)
            if request_pacer is not None:
                request_pacer.observe_response_headers(response.headers)
            payload = _decode_json_response(response)
        except Exception as exc:
            if isinstance(exc, SupplementalFastFailError):
                raise
            classification = classify_runtime_failure(str(exc), error_type=type(exc).__name__)
            reasons = classification.reasons or ("provider_error",)
            formatted_message = format_runtime_exception_message(exc)
            final_attempt = attempt >= total_attempts or classification.disposition != "transient_retryable"
            emit_runtime_event(
                "supplemental_request_failed",
                **dict(event_metadata or {}),
                attempt=attempt,
                max_attempts=total_attempts,
                final_attempt=final_attempt,
                elapsed_ms=round((time.perf_counter() - started_at) * 1000, 2),
                http_status=http_status,
                request_id=request_id,
                failure_reasons=list(reasons),
                failure_disposition=classification.disposition,
                error_type=type(exc).__name__,
                error_message=formatted_message,
            )
            if classification.disposition == "hard_unavailable":
                if circuit_breaker is not None:
                    circuit_breaker.trip(reasons=reasons, disposition=classification.disposition)
                    emit_runtime_event(
                        "supplemental_breaker_opened",
                        **dict(event_metadata or {}),
                        failure_reasons=list(reasons),
                        failure_disposition=classification.disposition,
                    )
                raise SupplementalProviderUnavailableError(
                    formatted_message,
                    reasons=reasons,
                    disposition=classification.disposition,
                ) from exc
            if classification.disposition == "non_retryable_request":
                raise SupplementalNonRetryableRequestError(
                    formatted_message,
                    reasons=reasons,
                    disposition=classification.disposition,
                ) from exc
            retryable = classification.disposition == "transient_retryable"
            if circuit_breaker is not None and retryable:
                breaker_opened = circuit_breaker.record_failure(reasons=reasons, disposition=classification.disposition)
                if breaker_opened:
                    emit_runtime_event(
                        "supplemental_breaker_opened",
                        **dict(event_metadata or {}),
                        failure_reasons=list(reasons),
                        failure_disposition=classification.disposition,
                    )
            if attempt >= total_attempts or not retryable:
                raise
            retry_delay_seconds = _retry_delay_seconds(attempt, http_settings.retry_backoff_seconds)
            emit_runtime_event(
                "supplemental_request_retry_scheduled",
                **dict(event_metadata or {}),
                attempt=attempt,
                max_attempts=total_attempts,
                retry_delay_seconds=retry_delay_seconds,
                failure_reasons=list(reasons),
                failure_disposition=classification.disposition,
            )
            time.sleep(retry_delay_seconds)
        else:
            if circuit_breaker is not None:
                circuit_breaker.record_success()
            emit_runtime_event(
                "supplemental_request_succeeded",
                **dict(event_metadata or {}),
                attempt=attempt,
                max_attempts=total_attempts,
                elapsed_ms=round((time.perf_counter() - started_at) * 1000, 2),
                http_status=http_status,
                request_id=request_id,
            )
            return payload
    raise RuntimeError("unreachable retry loop")


async def _request_json_async(
    request_fn: t.Callable[[], t.Awaitable[httpx.Response]],
    *,
    http_settings: SupplementalHTTPSettings,
    circuit_breaker: ProviderCircuitBreaker | None,
    retry_attempts: int | None = None,
    request_pacer: RequestPacer | None = None,
    event_metadata: dict[str, t.Any] | None = None,
) -> dict[str, t.Any]:
    total_attempts = 1 + (http_settings.retry_attempts if retry_attempts is None else retry_attempts)
    if circuit_breaker is not None:
        try:
            circuit_breaker.ensure_request_allowed()
        except SupplementalCircuitOpenError as exc:
            emit_runtime_event(
                "supplemental_breaker_fast_failed",
                **dict(event_metadata or {}),
                failure_reasons=list(getattr(exc, "reasons", ()) or ()),
                failure_disposition=getattr(exc, "disposition", None),
            )
            raise
    for attempt in range(1, total_attempts + 1):
        http_status: int | None = None
        request_id: str | None = None
        started_at = time.perf_counter()
        try:
            if request_pacer is not None:
                await request_pacer.wait_async()
            response = await request_fn()
            http_status = response.status_code
            request_id = _extract_request_id(response.headers)
            if request_pacer is not None:
                request_pacer.observe_response_headers(response.headers)
            payload = _decode_json_response(response)
        except Exception as exc:
            if isinstance(exc, SupplementalFastFailError):
                raise
            classification = classify_runtime_failure(str(exc), error_type=type(exc).__name__)
            reasons = classification.reasons or ("provider_error",)
            formatted_message = format_runtime_exception_message(exc)
            final_attempt = attempt >= total_attempts or classification.disposition != "transient_retryable"
            emit_runtime_event(
                "supplemental_request_failed",
                **dict(event_metadata or {}),
                attempt=attempt,
                max_attempts=total_attempts,
                final_attempt=final_attempt,
                elapsed_ms=round((time.perf_counter() - started_at) * 1000, 2),
                http_status=http_status,
                request_id=request_id,
                failure_reasons=list(reasons),
                failure_disposition=classification.disposition,
                error_type=type(exc).__name__,
                error_message=formatted_message,
            )
            if classification.disposition == "hard_unavailable":
                if circuit_breaker is not None:
                    circuit_breaker.trip(reasons=reasons, disposition=classification.disposition)
                    emit_runtime_event(
                        "supplemental_breaker_opened",
                        **dict(event_metadata or {}),
                        failure_reasons=list(reasons),
                        failure_disposition=classification.disposition,
                    )
                raise SupplementalProviderUnavailableError(
                    formatted_message,
                    reasons=reasons,
                    disposition=classification.disposition,
                ) from exc
            if classification.disposition == "non_retryable_request":
                raise SupplementalNonRetryableRequestError(
                    formatted_message,
                    reasons=reasons,
                    disposition=classification.disposition,
                ) from exc
            retryable = classification.disposition == "transient_retryable"
            if circuit_breaker is not None and retryable:
                breaker_opened = circuit_breaker.record_failure(reasons=reasons, disposition=classification.disposition)
                if breaker_opened:
                    emit_runtime_event(
                        "supplemental_breaker_opened",
                        **dict(event_metadata or {}),
                        failure_reasons=list(reasons),
                        failure_disposition=classification.disposition,
                    )
            if attempt >= total_attempts or not retryable:
                raise
            retry_delay_seconds = _retry_delay_seconds(attempt, http_settings.retry_backoff_seconds)
            emit_runtime_event(
                "supplemental_request_retry_scheduled",
                **dict(event_metadata or {}),
                attempt=attempt,
                max_attempts=total_attempts,
                retry_delay_seconds=retry_delay_seconds,
                failure_reasons=list(reasons),
                failure_disposition=classification.disposition,
            )
            await asyncio.sleep(retry_delay_seconds)
        else:
            if circuit_breaker is not None:
                circuit_breaker.record_success()
            emit_runtime_event(
                "supplemental_request_succeeded",
                **dict(event_metadata or {}),
                attempt=attempt,
                max_attempts=total_attempts,
                elapsed_ms=round((time.perf_counter() - started_at) * 1000, 2),
                http_status=http_status,
                request_id=request_id,
            )
            return payload
    raise RuntimeError("unreachable retry loop")


def _extract_output_text(payload: dict[str, t.Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text
    texts: list[str] = []
    for output_item in payload.get("output", []):
        if not isinstance(output_item, dict):
            continue
        for content_item in output_item.get("content", []):
            if not isinstance(content_item, dict):
                continue
            text = content_item.get("text")
            if isinstance(text, str) and text:
                texts.append(text)
    if texts:
        return "\n".join(texts)
    raise ValueError("responses payload did not contain output text")


def _extract_structured_output_model(
    payload: dict[str, t.Any],
    *,
    response_model: type[StructuredOutputModel],
) -> StructuredOutputModel:
    output_parsed = payload.get("output_parsed")
    if output_parsed is not None:
        try:
            return response_model.model_validate(output_parsed)
        except ValidationError:
            pass
    for output_item in payload.get("output", []):
        if not isinstance(output_item, dict):
            continue
        for content_item in output_item.get("content", []):
            if not isinstance(content_item, dict):
                continue
            parsed_value = content_item.get("parsed")
            if parsed_value is None:
                continue
            return response_model.model_validate(parsed_value)
    return response_model.model_validate_json(_extract_output_text(payload))


def _extract_embeddings(payload: dict[str, t.Any]) -> list[list[float]]:
    raw_data = payload.get("data")
    if not isinstance(raw_data, list):
        raise ValueError("embeddings payload missing data array")
    items: list[tuple[int, list[float]]] = []
    for item in raw_data:
        if not isinstance(item, dict):
            continue
        index = item.get("index")
        embedding = item.get("embedding")
        if isinstance(index, int) and isinstance(embedding, list):
            items.append((index, [float(value) for value in embedding]))
    if not items:
        raise ValueError("embeddings payload did not contain embedding vectors")
    return [embedding for _, embedding in sorted(items, key=lambda pair: pair[0])]


def is_retryable_provider_exception(exc: Exception) -> bool:
    if isinstance(exc, SupplementalFastFailError):
        return False
    classification = classify_runtime_failure(str(exc), error_type=type(exc).__name__)
    return classification.disposition == "transient_retryable"


def sanitize_runtime_message(message: str) -> str:
    sanitized = (message or "").strip()
    if not sanitized:
        return ""
    sanitized = _BEARER_TOKEN_RE.sub("Bearer <redacted>", sanitized)
    sanitized = _RUNTIME_SCOPE_SECRET_RE.sub("::<redacted>", sanitized)
    sanitized = _SK_LIKE_TOKEN_RE.sub("sk-<redacted>", sanitized)
    return sanitized


def format_runtime_exception_message(exc: Exception) -> str:
    message = sanitize_runtime_message(str(exc))
    if message:
        return message
    return type(exc).__name__


def _extract_request_id(headers: httpx.Headers) -> str | None:
    for key in ("x-request-id", "request-id", "openai-request-id", "cf-ray"):
        value = headers.get(key)
        if value:
            return value
    return None


def _retry_delay_seconds(attempt: int, backoff_seconds: float) -> float:
    if attempt <= 0 or backoff_seconds <= 0:
        return 0.0
    exponential_delay_seconds = backoff_seconds * (2 ** (attempt - 1))
    jitter_seconds = random.uniform(0.0, backoff_seconds)
    return exponential_delay_seconds + jitter_seconds


def _leading_status_code(message: str) -> int | None:
    match = re.search(r"\b(\d{3})\b", message)
    if match is None:
        return None
    return int(match.group(1))


def classify_retryable_runtime_failure(
    message: str,
    *,
    error_type: str | None = None,
) -> tuple[str, ...]:
    classification = classify_runtime_failure(message, error_type=error_type)
    if classification.disposition not in {"transient_retryable", "hard_unavailable"}:
        return ()
    return classification.reasons


def classify_runtime_failure(
    message: str,
    *,
    error_type: str | None = None,
) -> RuntimeFailureClassification:
    normalized_message = message.lower()
    normalized_error_type = (error_type or "").strip().lower()
    combined = " ".join(part for part in (normalized_error_type, normalized_message) if part)
    reasons: list[str] = []
    status_code = _leading_status_code(message)
    if status_code in {400, 401, 403, 404, 408, 409, 422, 429}:
        reasons.append(f"http_{status_code}")
    elif status_code is not None and 500 <= status_code <= 599:
        reasons.append("http_5xx")
    hard_unavailable = False
    if status_code in {401, 403}:
        hard_unavailable = True
        reasons.append("auth_unavailable")
    non_retryable = status_code in {400, 404, 422}
    if any(marker in combined for marker in _TIMEOUT_ERROR_MARKERS):
        reasons.append("timeout")
    if any(marker in combined for marker in _TRANSPORT_ERROR_MARKERS):
        reasons.append("transport")
    if any(marker in combined for marker in _RETRYABLE_PROVIDER_ERROR_MARKERS):
        reasons.append("provider_runtime")
    for reason, markers in _HARD_UNAVAILABLE_REASON_MARKERS.items():
        if any(marker in combined for marker in markers):
            reasons.append(reason)
            hard_unavailable = True
    for reason, markers in _NON_RETRYABLE_REASON_MARKERS.items():
        if any(marker in combined for marker in markers):
            reasons.append(reason)
            non_retryable = True
    if "circuit_open" in combined:
        reasons.append("circuit_open")
        return RuntimeFailureClassification(
            disposition="fast_fail_internal",
            reasons=tuple(dict.fromkeys(reasons)),
        )
    if "preflight_failed" in combined:
        reasons.append("preflight_failed")
        if hard_unavailable:
            disposition = "hard_unavailable"
        elif non_retryable:
            disposition = "non_retryable_request"
        elif any(reason in reasons for reason in ("timeout", "transport", "provider_runtime", "http_408", "http_409", "http_429", "http_5xx")):
            disposition = "transient_retryable"
        else:
            disposition = "fast_fail_internal"
        return RuntimeFailureClassification(
            disposition=disposition,
            reasons=tuple(dict.fromkeys(reasons)),
        )
    if hard_unavailable:
        disposition = "hard_unavailable"
    elif non_retryable:
        disposition = "non_retryable_request"
    elif any(
        reason in reasons
        for reason in ("timeout", "transport", "provider_runtime", "http_408", "http_409", "http_429", "http_5xx")
    ):
        disposition = "transient_retryable"
    else:
        disposition = "unknown"
    return RuntimeFailureClassification(
        disposition=disposition,
        reasons=tuple(dict.fromkeys(reasons)),
    )


def _classify_preflight_exception(exc: Exception) -> RuntimeFailureClassification:
    if isinstance(exc, ValidationError):
        return RuntimeFailureClassification(
            disposition="non_retryable_request",
            reasons=("structured_output_invalid",),
        )
    if isinstance(exc, ValueError) and "responses payload did not contain output text" not in str(exc):
        return RuntimeFailureClassification(
            disposition="non_retryable_request",
            reasons=("structured_output_invalid",),
        )
    return classify_runtime_failure(str(exc), error_type=type(exc).__name__)


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
    key = _shared_client_key(base_url=base_url, api_key=api_key, settings=settings) + (current_loop,)
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
