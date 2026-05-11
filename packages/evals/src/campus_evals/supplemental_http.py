from __future__ import annotations

import campus_evals.supplemental_http_runtime as _runtime
import campus_evals.supplemental_http_state as _state
from campus_evals.settings import RagasSettings
from campus_evals.supplemental_http_chat import (
    OpenAICompatibleChatCompletionsLLM,
    OpenAICompatibleTextChatCompletionsLLM,
)
from campus_evals.supplemental_http_embeddings import OpenAICompatibleHTTPEmbeddings
from campus_evals.supplemental_http_responses import (
    OpenAICompatibleResponsesLLM,
    OpenAICompatibleTextResponsesLLM,
)

SupplementalFastFailError = _runtime.SupplementalFastFailError
SupplementalPreflightFailedError = _runtime.SupplementalPreflightFailedError
SupplementalCircuitOpenError = _runtime.SupplementalCircuitOpenError
SupplementalProviderUnavailableError = _runtime.SupplementalProviderUnavailableError
SupplementalNonRetryableRequestError = _runtime.SupplementalNonRetryableRequestError
RuntimeFailureClassification = _runtime.RuntimeFailureClassification
classify_retryable_runtime_failure = _runtime.classify_retryable_runtime_failure
classify_runtime_failure = _runtime.classify_runtime_failure
format_runtime_exception_message = _runtime.format_runtime_exception_message
is_retryable_provider_exception = _runtime.is_retryable_provider_exception
sanitize_runtime_message = _runtime.sanitize_runtime_message
_retry_delay_seconds = _runtime._retry_delay_seconds
get_request_pacer = _state.get_request_pacer
get_provider_circuit_breaker = _state.get_provider_circuit_breaker
reset_supplemental_http_runtime_state_for_tests = (
    _state.reset_supplemental_http_runtime_state_for_tests
)

# Preserve existing patch seams used by tests.
httpx = _state.httpx
random = _runtime.random
asyncio = _state.asyncio
time = _runtime.time


def build_http_ragas_llm(
    settings: RagasSettings,
    *,
    sync_client: httpx.Client | None = None,
    async_client: httpx.AsyncClient | None = None,
) -> OpenAICompatibleResponsesLLM | OpenAICompatibleChatCompletionsLLM:
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
    llm_kwargs = {
        "base_url": settings.llm_base_url or "https://api.openai.com/v1",
        "api_key": settings.llm_api_key,
        "model": settings.llm_model,
        "http_settings": settings.http_settings,
        "reasoning_effort": settings.reasoning_effort,
        "text_verbosity": settings.text_verbosity,
        "max_output_tokens": settings.max_output_tokens,
        "request_pacer": request_pacer,
        "circuit_breaker": circuit_breaker,
        "sync_client": sync_client,
        "async_client": async_client,
    }
    if settings.llm_transport == "chat_completions":
        llm = OpenAICompatibleChatCompletionsLLM(**llm_kwargs)
        text_preflight_llm = OpenAICompatibleTextChatCompletionsLLM(**llm_kwargs)
    else:
        llm = OpenAICompatibleResponsesLLM(**llm_kwargs)
        text_preflight_llm = OpenAICompatibleTextResponsesLLM(**llm_kwargs)
    llm.preflight_sync = text_preflight_llm.preflight_sync
    return llm


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


__all__ = [
    "OpenAICompatibleChatCompletionsLLM",
    "OpenAICompatibleHTTPEmbeddings",
    "OpenAICompatibleResponsesLLM",
    "OpenAICompatibleTextChatCompletionsLLM",
    "OpenAICompatibleTextResponsesLLM",
    "RuntimeFailureClassification",
    "SupplementalCircuitOpenError",
    "SupplementalFastFailError",
    "SupplementalNonRetryableRequestError",
    "SupplementalPreflightFailedError",
    "SupplementalProviderUnavailableError",
    "build_http_ragas_embeddings",
    "build_http_ragas_llm",
    "classify_retryable_runtime_failure",
    "classify_runtime_failure",
    "format_runtime_exception_message",
    "get_provider_circuit_breaker",
    "get_request_pacer",
    "is_retryable_provider_exception",
    "reset_supplemental_http_runtime_state_for_tests",
    "sanitize_runtime_message",
]
