from __future__ import annotations

import asyncio
import json
import random
import re
import time
import typing as t
from dataclasses import dataclass

import httpx
from pydantic import ValidationError

from campus_evals.runtime_observability import emit_runtime_event
from campus_evals.settings import SupplementalHTTPSettings
from campus_evals.supplemental_http_state import ProviderCircuitBreaker, RequestPacer

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
_PROVIDER_CONTRACT_REASON_MARKERS = {
    "provider_contract_violation": (
        "responses contract violation",
        "chat completions contract violation",
        "payload did not contain output text",
        "payload did not contain assistant message content",
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
_BEARER_TOKEN_RE = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._-]+\b")
_RUNTIME_SCOPE_SECRET_RE = re.compile(r"::[A-Za-z0-9._-]{6,}")
_SK_LIKE_TOKEN_RE = re.compile(r"\bsk-[A-Za-z0-9._-]{6,}\b")


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


def _build_runtime_event_metadata(
    *,
    base_url: str,
    endpoint: str,
    model: str,
    request_kind: str,
    preflight: bool,
) -> dict[str, t.Any]:
    from campus_evals.supplemental_http_state import _pacer_scope_key

    return {
        "provider_origin": _pacer_scope_key(base_url),
        "endpoint": endpoint,
        "model": model,
        "request_kind": request_kind,
        "preflight": preflight,
    }


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
    total_attempts = 1 + (
        http_settings.retry_attempts if retry_attempts is None else retry_attempts
    )
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
            final_attempt = (
                attempt >= total_attempts or classification.disposition != "transient_retryable"
            )
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
                breaker_opened = circuit_breaker.record_failure(
                    reasons=reasons, disposition=classification.disposition
                )
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
    total_attempts = 1 + (
        http_settings.retry_attempts if retry_attempts is None else retry_attempts
    )
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
            final_attempt = (
                attempt >= total_attempts or classification.disposition != "transient_retryable"
            )
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
                breaker_opened = circuit_breaker.record_failure(
                    reasons=reasons, disposition=classification.disposition
                )
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
    return _SK_LIKE_TOKEN_RE.sub("sk-<redacted>", sanitized)


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
    for reason, markers in _PROVIDER_CONTRACT_REASON_MARKERS.items():
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
        elif any(
            reason in reasons
            for reason in (
                "timeout",
                "transport",
                "provider_runtime",
                "http_408",
                "http_409",
                "http_429",
                "http_5xx",
            )
        ):
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
        for reason in (
            "timeout",
            "transport",
            "provider_runtime",
            "http_408",
            "http_409",
            "http_429",
            "http_5xx",
        )
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
    if isinstance(exc, ValueError):
        classification = classify_runtime_failure(str(exc), error_type=type(exc).__name__)
        if "provider_contract_violation" in classification.reasons:
            return classification
        return RuntimeFailureClassification(
            disposition="non_retryable_request",
            reasons=("structured_output_invalid",),
        )
    return classify_runtime_failure(str(exc), error_type=type(exc).__name__)


__all__ = [
    "RuntimeFailureClassification",
    "SupplementalCircuitOpenError",
    "SupplementalFastFailError",
    "SupplementalNonRetryableRequestError",
    "SupplementalPreflightFailedError",
    "SupplementalProviderUnavailableError",
    "_build_runtime_event_metadata",
    "_classify_preflight_exception",
    "_request_json_async",
    "_request_json_sync",
    "_retry_delay_seconds",
    "classify_retryable_runtime_failure",
    "classify_runtime_failure",
    "format_runtime_exception_message",
    "is_retryable_provider_exception",
    "sanitize_runtime_message",
]
