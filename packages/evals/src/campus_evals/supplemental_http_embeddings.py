from __future__ import annotations

import time

import httpx
from ragas.embeddings.base import BaseRagasEmbeddings

from campus_evals.settings import SupplementalHTTPSettings
from campus_evals.supplemental_http_payloads import (
    _build_embeddings_payload,
    _build_headers,
    _extract_embeddings,
)
from campus_evals.supplemental_http_runtime import (
    SupplementalPreflightFailedError,
    _build_runtime_event_metadata,
    _request_json_async,
    _request_json_sync,
    classify_runtime_failure,
    format_runtime_exception_message,
)
from campus_evals.supplemental_http_state import (
    ProviderCircuitBreaker,
    RequestPacer,
    _build_httpx_timeout,
    _get_cached_preflight_entry,
    _preflight_cache_key,
    _PreflightCacheEntry,
    _store_preflight_entry,
    get_shared_async_client,
    get_shared_sync_client,
)


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
                lambda: self._get_sync_client().post(
                    "/embeddings", json=payload, headers=_build_headers(self.api_key)
                ),
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
                lambda: self._get_async_client().post(
                    "/embeddings", json=payload, headers=_build_headers(self.api_key)
                ),
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
                    expires_at=time.monotonic()
                    + self.http_settings.circuit_breaker_cooldown_seconds,
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


__all__ = ["OpenAICompatibleHTTPEmbeddings"]
