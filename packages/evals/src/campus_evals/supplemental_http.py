from __future__ import annotations

import asyncio
import json
import re
from threading import Lock
import time
import typing as t
from urllib.parse import urlparse

import httpx
from langchain_core.outputs import Generation, LLMResult
from ragas.embeddings.base import BaseRagasEmbeddings
from ragas.llms.base import BaseRagasLLM

from campus_evals.settings import RagasSettings, SupplementalHTTPSettings


_RETRYABLE_PROVIDER_ERROR_MARKERS = (
    "system_cpu_overloaded",
    "bad_response_body",
    "do_request_failed",
)
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
_REQUEST_PACERS: dict[tuple[str, float], "RequestPacer"] = {}
_REQUEST_PACERS_LOCK = Lock()
_PROVIDER_CIRCUIT_BREAKERS: dict[tuple[str, int, float], "ProviderCircuitBreaker"] = {}
_PROVIDER_CIRCUIT_BREAKERS_LOCK = Lock()


class SupplementalFastFailError(RuntimeError):
    def __init__(self, message: str, *, reasons: tuple[str, ...]) -> None:
        super().__init__(message)
        self.reasons = reasons


class SupplementalPreflightFailedError(SupplementalFastFailError):
    pass


class SupplementalCircuitOpenError(SupplementalFastFailError):
    pass


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
            )

    def record_success(self) -> None:
        with self._lock:
            self._consecutive_failures = 0
            self._opened_until = 0.0
            self._last_failure_reasons = ()

    def record_failure(self, *, reasons: tuple[str, ...]) -> bool:
        with self._lock:
            self._consecutive_failures += 1
            self._last_failure_reasons = reasons
            if self._consecutive_failures < self.failure_threshold:
                return False
            self._opened_until = time.monotonic() + self.cooldown_seconds
            return True

    def trip(self, *, reasons: tuple[str, ...]) -> None:
        with self._lock:
            self._consecutive_failures = self.failure_threshold
            self._last_failure_reasons = reasons
            self._opened_until = time.monotonic() + self.cooldown_seconds


class OpenAICompatibleResponsesLLM(BaseRagasLLM):
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
        self._own_sync_client: httpx.Client | None = None
        self._own_async_client: httpx.AsyncClient | None = None
        self._own_async_client_loop: asyncio.AbstractEventLoop | None = None

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
        payload = {
            "model": self.model,
            "stream": False,
            "input": [{"role": "user", "type": "message", "content": "Reply with OK only."}],
            "max_output_tokens": min(self.max_output_tokens or 16, 16),
        }
        try:
            with httpx.Client(
                base_url=self.base_url,
                timeout=_build_httpx_timeout(self.http_settings, preflight=True),
                trust_env=False,
            ) as client:
                _request_json_sync(
                    lambda: client.post("/responses", json=payload, headers=_build_headers(self.api_key)),
                    http_settings=self.http_settings,
                    circuit_breaker=self.circuit_breaker,
                    retry_attempts=0,
                )
        except Exception as exc:
            reasons = ("preflight_failed", *classify_retryable_runtime_failure(str(exc), error_type=type(exc).__name__))
            if self.circuit_breaker is not None:
                self.circuit_breaker.trip(reasons=reasons)
            raise SupplementalPreflightFailedError(
                f"preflight_failed: {exc}",
                reasons=reasons,
            ) from exc
        return {"status": "passed", "endpoint": "/responses", "model": self.model}

    def _post_json_sync(self, path: str, payload: dict[str, t.Any]) -> dict[str, t.Any]:
        if self.request_pacer is not None:
            self.request_pacer.wait_sync()
        return _request_json_sync(
            lambda: self._get_sync_client().post(path, json=payload, headers=_build_headers(self.api_key)),
            http_settings=self.http_settings,
            circuit_breaker=self.circuit_breaker,
        )

    async def _post_json_async(self, path: str, payload: dict[str, t.Any]) -> dict[str, t.Any]:
        if self.request_pacer is not None:
            await self.request_pacer.wait_async()
        return await _request_json_async(
            lambda: self._get_async_client().post(path, json=payload, headers=_build_headers(self.api_key)),
            http_settings=self.http_settings,
            circuit_breaker=self.circuit_breaker,
        )

    def _get_sync_client(self) -> httpx.Client:
        if self._sync_client is not None:
            return self._sync_client
        if self._own_sync_client is None:
            self._own_sync_client = httpx.Client(
                base_url=self.base_url,
                timeout=_build_httpx_timeout(self.http_settings),
                trust_env=False,
            )
        return self._own_sync_client

    def _get_async_client(self) -> httpx.AsyncClient:
        if self._async_client is not None:
            return self._async_client
        current_loop = asyncio.get_running_loop()
        if (
            self._own_async_client is None
            or self._own_async_client_loop is not current_loop
            or getattr(self._own_async_client, "is_closed", False)
        ):
            self._own_async_client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=_build_httpx_timeout(self.http_settings),
                trust_env=False,
            )
            self._own_async_client_loop = current_loop
        return self._own_async_client


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
        self._own_sync_client: httpx.Client | None = None
        self._own_async_client: httpx.AsyncClient | None = None
        self._own_async_client_loop: asyncio.AbstractEventLoop | None = None

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        payload = _build_embeddings_payload(
            model=self.model,
            texts=texts,
            dimensions=self.dimensions,
        )
        if self.request_pacer is not None:
            self.request_pacer.wait_sync()
        return _extract_embeddings(
            _request_json_sync(
                lambda: self._get_sync_client().post("/embeddings", json=payload, headers=_build_headers(self.api_key)),
                http_settings=self.http_settings,
                circuit_breaker=self.circuit_breaker,
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
        if self.request_pacer is not None:
            await self.request_pacer.wait_async()
        return _extract_embeddings(
            await _request_json_async(
                lambda: self._get_async_client().post("/embeddings", json=payload, headers=_build_headers(self.api_key)),
                http_settings=self.http_settings,
                circuit_breaker=self.circuit_breaker,
            )
        )

    def preflight_sync(self) -> dict[str, object]:
        payload = _build_embeddings_payload(
            model=self.model,
            texts=["supplemental preflight"],
            dimensions=self.dimensions,
        )
        try:
            with httpx.Client(
                base_url=self.base_url,
                timeout=_build_httpx_timeout(self.http_settings, preflight=True),
                trust_env=False,
            ) as client:
                _request_json_sync(
                    lambda: client.post("/embeddings", json=payload, headers=_build_headers(self.api_key)),
                    http_settings=self.http_settings,
                    circuit_breaker=self.circuit_breaker,
                    retry_attempts=0,
                )
        except Exception as exc:
            reasons = ("preflight_failed", *classify_retryable_runtime_failure(str(exc), error_type=type(exc).__name__))
            if self.circuit_breaker is not None:
                self.circuit_breaker.trip(reasons=reasons)
            raise SupplementalPreflightFailedError(
                f"preflight_failed: {exc}",
                reasons=reasons,
            ) from exc
        return {"status": "passed", "endpoint": "/embeddings", "model": self.model}

    def _get_sync_client(self) -> httpx.Client:
        if self._sync_client is not None:
            return self._sync_client
        if self._own_sync_client is None:
            self._own_sync_client = httpx.Client(
                base_url=self.base_url,
                timeout=_build_httpx_timeout(self.http_settings),
                trust_env=False,
            )
        return self._own_sync_client

    def _get_async_client(self) -> httpx.AsyncClient:
        if self._async_client is not None:
            return self._async_client
        current_loop = asyncio.get_running_loop()
        if (
            self._own_async_client is None
            or self._own_async_client_loop is not current_loop
            or getattr(self._own_async_client, "is_closed", False)
        ):
            self._own_async_client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=_build_httpx_timeout(self.http_settings),
                trust_env=False,
            )
            self._own_async_client_loop = current_loop
        return self._own_async_client


def build_http_ragas_llm(
    settings: RagasSettings,
    *,
    sync_client: httpx.Client | None = None,
    async_client: httpx.AsyncClient | None = None,
) -> OpenAICompatibleResponsesLLM:
    request_pacer = get_request_pacer(
        base_url=settings.llm_base_url or "https://api.openai.com/v1",
        api_key=settings.llm_api_key,
        min_interval_seconds=settings.http_settings.request_min_interval_seconds,
    )
    circuit_breaker = get_provider_circuit_breaker(
        base_url=settings.llm_base_url or "https://api.openai.com/v1",
        settings=settings.http_settings,
    )
    return OpenAICompatibleResponsesLLM(
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


def _prompt_to_responses_input(prompt) -> list[dict[str, t.Any]]:
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
) -> dict[str, t.Any]:
    total_attempts = 1 + (http_settings.retry_attempts if retry_attempts is None else retry_attempts)
    if circuit_breaker is not None:
        circuit_breaker.ensure_request_allowed()
    for attempt in range(1, total_attempts + 1):
        try:
            payload = _decode_json_response(request_fn())
        except Exception as exc:
            if isinstance(exc, SupplementalFastFailError):
                raise
            retryable = _is_retryable_exception(exc)
            reasons = classify_retryable_runtime_failure(str(exc), error_type=type(exc).__name__) or ("provider_error",)
            if circuit_breaker is not None:
                circuit_breaker.record_failure(reasons=reasons)
            if attempt >= total_attempts or not retryable:
                raise
            time.sleep(_retry_delay_seconds(attempt, http_settings.retry_backoff_seconds))
        else:
            if circuit_breaker is not None:
                circuit_breaker.record_success()
            return payload
    raise RuntimeError("unreachable retry loop")


async def _request_json_async(
    request_fn: t.Callable[[], t.Awaitable[httpx.Response]],
    *,
    http_settings: SupplementalHTTPSettings,
    circuit_breaker: ProviderCircuitBreaker | None,
    retry_attempts: int | None = None,
) -> dict[str, t.Any]:
    total_attempts = 1 + (http_settings.retry_attempts if retry_attempts is None else retry_attempts)
    if circuit_breaker is not None:
        circuit_breaker.ensure_request_allowed()
    for attempt in range(1, total_attempts + 1):
        try:
            payload = _decode_json_response(await request_fn())
        except Exception as exc:
            if isinstance(exc, SupplementalFastFailError):
                raise
            retryable = _is_retryable_exception(exc)
            reasons = classify_retryable_runtime_failure(str(exc), error_type=type(exc).__name__) or ("provider_error",)
            if circuit_breaker is not None:
                circuit_breaker.record_failure(reasons=reasons)
            if attempt >= total_attempts or not retryable:
                raise
            await asyncio.sleep(_retry_delay_seconds(attempt, http_settings.retry_backoff_seconds))
        else:
            if circuit_breaker is not None:
                circuit_breaker.record_success()
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


def _is_retryable_exception(exc: Exception) -> bool:
    return is_retryable_provider_exception(exc)


def is_retryable_provider_exception(exc: Exception) -> bool:
    if isinstance(exc, SupplementalFastFailError):
        return False
    if isinstance(exc, (httpx.TimeoutException, httpx.TransportError)):
        return True
    if isinstance(exc, RuntimeError):
        reasons = classify_retryable_runtime_failure(str(exc), error_type=type(exc).__name__)
        return any(reason not in {"circuit_open", "preflight_failed"} for reason in reasons)
    return False


def _retry_delay_seconds(attempt: int, backoff_seconds: float) -> float:
    return backoff_seconds * attempt


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
    normalized_message = message.lower()
    normalized_error_type = (error_type or "").strip().lower()
    combined = " ".join(part for part in (normalized_error_type, normalized_message) if part)
    reasons: list[str] = []
    status_code = _leading_status_code(message)
    if status_code in {408, 409, 429}:
        reasons.append(f"http_{status_code}")
    elif status_code is not None and 500 <= status_code <= 599:
        reasons.append("http_5xx")
    if any(marker in combined for marker in _TIMEOUT_ERROR_MARKERS):
        reasons.append("timeout")
    if any(marker in combined for marker in _TRANSPORT_ERROR_MARKERS):
        reasons.append("transport")
    if any(marker in combined for marker in _RETRYABLE_PROVIDER_ERROR_MARKERS):
        reasons.append("provider_runtime")
    if "circuit_open" in combined:
        reasons.append("circuit_open")
    if "preflight_failed" in combined:
        reasons.append("preflight_failed")
    return tuple(dict.fromkeys(reasons))


def get_request_pacer(
    *,
    base_url: str,
    api_key: str,
    min_interval_seconds: float,
) -> RequestPacer | None:
    del api_key
    if min_interval_seconds <= 0:
        return None
    key = (_pacer_scope_key(base_url), float(min_interval_seconds))
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
    settings: SupplementalHTTPSettings,
) -> ProviderCircuitBreaker:
    key = (
        _pacer_scope_key(base_url),
        settings.circuit_breaker_failure_threshold,
        float(settings.circuit_breaker_cooldown_seconds),
    )
    with _PROVIDER_CIRCUIT_BREAKERS_LOCK:
        existing = _PROVIDER_CIRCUIT_BREAKERS.get(key)
        if existing is not None:
            return existing
        breaker = ProviderCircuitBreaker(
            origin=key[0],
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
