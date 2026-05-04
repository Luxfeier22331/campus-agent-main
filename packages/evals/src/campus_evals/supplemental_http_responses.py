from __future__ import annotations

import asyncio
import time
import typing as t

import httpx

from campus_evals._advisory_suppression import suppress_transformers_missing_torch_advisory

with suppress_transformers_missing_torch_advisory():
    from langchain_core.outputs import Generation, LLMResult
    from ragas.llms.base import BaseRagasLLM, InstructorBaseRagasLLM

from campus_evals.settings import SupplementalHTTPSettings
from campus_evals.supplemental_http_payloads import (
    StructuredOutputModel,
    _build_headers,
    _build_responses_payload,
    _build_responses_structured_payload,
    _extract_output_text,
    _extract_structured_output_model,
    _ResponsesStructuredPreflightModel,
)
from campus_evals.supplemental_http_runtime import (
    SupplementalPreflightFailedError,
    _build_runtime_event_metadata,
    _classify_preflight_exception,
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
                    expires_at=time.monotonic()
                    + self.http_settings.circuit_breaker_cooldown_seconds,
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
            lambda: self._get_sync_client().post(
                path, json=payload, headers=_build_headers(self.api_key)
            ),
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
            lambda: self._get_async_client().post(
                path, json=payload, headers=_build_headers(self.api_key)
            ),
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
                    expires_at=time.monotonic()
                    + self.http_settings.circuit_breaker_cooldown_seconds,
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


__all__ = [
    "OpenAICompatibleResponsesLLM",
    "OpenAICompatibleTextResponsesLLM",
]
