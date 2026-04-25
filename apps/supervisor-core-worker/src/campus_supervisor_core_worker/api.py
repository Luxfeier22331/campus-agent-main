from __future__ import annotations

import secrets
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field
from threading import Lock

from campus_contracts import ErrorInfo, SpecialistRequest, SupervisorRequest, SupervisorResponse
from campus_supervisor_core import (
    ExecutionCancelledError,
    SupervisorError,
    handle_request,
)

from campus_supervisor_core_worker.api_request_parsing import (
    _parse_bridge_supervisor_envelope,
)
from campus_supervisor_core_worker.prompt_stack import PromptRuntimeSettings
from campus_supervisor_core_worker.settings import ApiSettings


@dataclass(frozen=True, slots=True)
class HttpResponse:
    status_code: int
    json_body: dict[str, object]
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class HttpRoute:
    method: str
    path: str
    handler: Callable[[Mapping[str, str], dict[str, object] | None], HttpResponse]


SupervisorHandler = Callable[
    [SupervisorRequest],
    SupervisorResponse,
]
SupervisorEnvelopeHandler = Callable[
    [SupervisorRequest, SpecialistRequest],
    SupervisorResponse,
]
RuntimeStatusProvider = Callable[[], Mapping[str, Mapping[str, object]]]


@dataclass(slots=True)
class CancelRecord:
    request_id: str
    trace_id: str = ""
    reason: str = ""
    cancel_requested: bool = False


class ExecutionCancelRegistry:
    def __init__(self) -> None:
        self._lock = Lock()
        self._active: dict[str, CancelRecord] = {}

    def register(self, request: SupervisorRequest) -> None:
        if not request.request_id:
            return
        with self._lock:
            self._active[request.request_id] = CancelRecord(
                request_id=request.request_id,
                trace_id=request.trace.trace_id,
            )

    def complete(self, request_id: str) -> None:
        if not request_id:
            return
        with self._lock:
            self._active.pop(request_id, None)

    def cancel(self, request_id: str, reason: str = "") -> CancelRecord | None:
        with self._lock:
            record = self._active.get(request_id)
            if record is None:
                return None
            record.cancel_requested = True
            record.reason = reason
            return CancelRecord(
                request_id=record.request_id,
                trace_id=record.trace_id,
                reason=record.reason,
                cancel_requested=record.cancel_requested,
            )

    def is_cancel_requested(self, request_id: str) -> bool:
        if not request_id:
            return False
        with self._lock:
            record = self._active.get(request_id)
            return bool(record and record.cancel_requested)


def build_bridge_routes(
    settings: ApiSettings,
    *,
    supervisor_handler: SupervisorEnvelopeHandler | None = None,
    prompt_runtime: PromptRuntimeSettings | None = None,
    runtime_status_provider: RuntimeStatusProvider | None = None,
    cancel_registry: ExecutionCancelRegistry | None = None,
) -> tuple[HttpRoute, ...]:
    runtime_cancel_registry = cancel_registry or ExecutionCancelRegistry()
    runtime_supervisor_handler = supervisor_handler or _default_supervisor_envelope_handler
    return (
        HttpRoute(
            "POST",
            "/internal/bridge/supervisor/answer",
            lambda headers, body: handle_bridge_answer(
                headers,
                body,
                settings,
                runtime_supervisor_handler,
                cancel_registry=runtime_cancel_registry,
            ),
        ),
        HttpRoute(
            "POST",
            "/internal/bridge/execution/cancel",
            lambda headers, body: handle_bridge_cancel(
                headers,
                body,
                settings,
                cancel_registry=runtime_cancel_registry,
            ),
        ),
        HttpRoute(
            "GET",
            "/internal/bridge/healthz",
            lambda headers, body: handle_bridge_healthz(headers, settings),
        ),
        HttpRoute(
            "GET",
            "/internal/bridge/readyz",
            lambda headers, body: handle_bridge_readyz(
                headers,
                settings,
                prompt_runtime=prompt_runtime,
                runtime_status_provider=runtime_status_provider,
            ),
        ),
    )


def _default_supervisor_envelope_handler(
    request: SupervisorRequest,
    preplanned_specialist_request: SpecialistRequest,
) -> SupervisorResponse:
    return handle_request(
        request,
        preplanned_specialist_request=preplanned_specialist_request,
    )


def handle_bridge_answer(
    headers: Mapping[str, str],
    body: dict[str, object] | None,
    settings: ApiSettings,
    supervisor_handler: SupervisorEnvelopeHandler,
    *,
    cancel_registry: ExecutionCancelRegistry | None = None,
) -> HttpResponse:
    bridge_auth_error = _require_bridge_auth(headers, settings)
    if bridge_auth_error is not None:
        return bridge_auth_error

    payload = body or {}
    try:
        envelope = _parse_bridge_supervisor_envelope(payload)
    except ValueError as exc:
        return _bridge_response(
            400,
            {"error": asdict(ErrorInfo(code="invalid_request", message=str(exc)))},
            kind="bridge_invalid_request",
        )
    request = envelope.request
    runtime_specialist_request = envelope.specialist_request
    if runtime_specialist_request is None:
        return _bridge_response(
            400,
            {
                "error": asdict(
                    ErrorInfo(
                        code="invalid_request",
                        message="runtime_decisions.handoff.specialist_request is required.",
                    )
                )
            },
            kind="bridge_invalid_request",
        )

    runtime_cancel_registry = cancel_registry or ExecutionCancelRegistry()
    runtime_cancel_registry.register(request)
    try:
        if runtime_cancel_registry.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Supervisor execution was cancelled.")
        response = supervisor_handler(
            request,
            runtime_specialist_request,
        )
        if runtime_cancel_registry.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Supervisor execution was cancelled.")
    except ExecutionCancelledError as exc:
        return _bridge_response(
            exc.http_status_code,
            {"error": asdict(exc.to_error_info())},
            kind="supervisor_error",
        )
    except SupervisorError as exc:
        return _bridge_response(
            exc.http_status_code,
            {"error": asdict(exc.to_error_info())},
            kind="supervisor_error",
        )
    finally:
        runtime_cancel_registry.complete(request.request_id)

    return _bridge_response(200, asdict(response), kind="supervisor_response")


def handle_bridge_cancel(
    headers: Mapping[str, str],
    body: dict[str, object] | None,
    settings: ApiSettings,
    *,
    cancel_registry: ExecutionCancelRegistry,
) -> HttpResponse:
    bridge_auth_error = _require_bridge_auth(headers, settings)
    if bridge_auth_error is not None:
        return bridge_auth_error

    payload = body or {}
    request_id = str(payload.get("request_id", "")).strip()
    if not request_id:
        return error_response(
            400,
            ErrorInfo(code="invalid_request", message="request_id is required."),
        )
    reason = str(payload.get("reason", "")).strip()
    record = cancel_registry.cancel(request_id, reason)
    if record is None:
        return error_response(
            404,
            ErrorInfo(code="execution_not_found", message="Execution request_id is not active."),
        )
    return HttpResponse(
        status_code=202,
        json_body={
            "request_id": record.request_id,
            "trace_id": record.trace_id,
            "status": "cancel_requested",
        },
    )


def healthz(settings: ApiSettings) -> HttpResponse:
    return HttpResponse(status_code=200, json_body={"status": "ok", "app_name": settings.app_name})


def handle_bridge_healthz(headers: Mapping[str, str], settings: ApiSettings) -> HttpResponse:
    bridge_auth_error = _require_bridge_auth(headers, settings)
    if bridge_auth_error is not None:
        return bridge_auth_error
    return healthz(settings)


def readyz(
    settings: ApiSettings,
    *,
    prompt_runtime: PromptRuntimeSettings | None = None,
    runtime_status_provider: RuntimeStatusProvider | None = None,
) -> HttpResponse:
    runtime_prompt = prompt_runtime or _resolve_prompt_runtime_settings(settings)
    runtime_status = dict(runtime_status_provider() if runtime_status_provider else {})
    prompt_http_pool = dict(
        runtime_status.get("prompt_http_pool")
        or _default_prompt_http_pool_status(settings=settings, admitted=runtime_prompt.admitted)
    )
    degraded = not runtime_prompt.admitted or not bool(prompt_http_pool.get("healthy", True))
    return HttpResponse(
        status_code=503 if degraded else 200,
        json_body={
            "status": "degraded" if degraded else "ready",
            "runtime_provider": settings.runtime_provider,
            "supervisor_model": settings.supervisor_prompt_model,
            "specialist_model": settings.specialist_prompt_model,
            "prompt_runtime": {
                "provider": runtime_prompt.provider,
                "transport": runtime_prompt.transport,
                "developer_invariants_id": runtime_prompt.developer_invariants_id,
                "developer_invariants_version": runtime_prompt.developer_invariants_version,
                "strict_structured_outputs": runtime_prompt.strict_structured_outputs,
                "supervisor_model": runtime_prompt.supervisor_prompt_model,
                "specialist_model": runtime_prompt.specialist_prompt_model,
                "admitted": runtime_prompt.admitted,
                "admission_reason": runtime_prompt.admission_reason,
            },
            "prompt_http_pool": prompt_http_pool,
            "worker_runtime": runtime_status.get("worker_runtime")
            or {"role": "semantic_worker", "cancel_flag_store": "available"},
        },
    )


def handle_bridge_readyz(
    headers: Mapping[str, str],
    settings: ApiSettings,
    *,
    prompt_runtime: PromptRuntimeSettings | None = None,
    runtime_status_provider: RuntimeStatusProvider | None = None,
) -> HttpResponse:
    bridge_auth_error = _require_bridge_auth(headers, settings)
    if bridge_auth_error is not None:
        return bridge_auth_error
    return readyz(
        settings,
        prompt_runtime=prompt_runtime,
        runtime_status_provider=runtime_status_provider,
    )


def error_response(status_code: int, error: ErrorInfo) -> HttpResponse:
    return HttpResponse(status_code=status_code, json_body={"error": asdict(error)})


def _bridge_response(
    status_code: int,
    json_body: dict[str, object],
    *,
    kind: str,
) -> HttpResponse:
    return HttpResponse(
        status_code=status_code,
        json_body=json_body,
        headers={"x-supervisor-bridge-kind": kind},
    )


def _require_bridge_auth(headers: Mapping[str, str], settings: ApiSettings) -> HttpResponse | None:
    shared_secret = settings.bridge_shared_secret.strip()
    if not shared_secret:
        return error_response(
            500,
            ErrorInfo(
                code="bridge_auth_not_configured",
                message="Supervisor bridge auth is not configured.",
            ),
        )

    presented = headers.get("x-supervisor-bridge-auth", "")
    if not presented:
        return error_response(
            401,
            ErrorInfo(code="unauthorized", message="Missing supervisor bridge auth."),
        )
    if not secrets.compare_digest(presented, shared_secret):
        return error_response(
            401,
            ErrorInfo(code="unauthorized", message="Invalid supervisor bridge auth."),
        )
    return None


def _resolve_prompt_runtime_settings(settings: ApiSettings) -> PromptRuntimeSettings:
    prompt_runtime_provider = settings.prompt_runtime_provider or settings.runtime_provider
    if not prompt_runtime_provider:
        admission_reason = "provider_not_configured"
    elif not settings.prompt_strict_structured_outputs:
        admission_reason = "strict_structured_outputs_disabled"
    elif not settings.specialist_prompt_model.strip():
        admission_reason = "prompt_models_not_configured"
    elif not settings.prompt_runtime_api_key.strip():
        admission_reason = "api_key_not_configured"
    elif settings.prompt_runtime_transport != "responses":
        admission_reason = "transport must be 'responses'"
    elif not settings.prompt_runtime_base_url.strip():
        admission_reason = "base_url must not be empty"
    else:
        admission_reason = ""
    return PromptRuntimeSettings(
        provider=prompt_runtime_provider,
        transport=settings.prompt_runtime_transport,
        supervisor_prompt_model=settings.supervisor_prompt_model,
        specialist_prompt_model=settings.specialist_prompt_model,
        strict_structured_outputs=settings.prompt_strict_structured_outputs,
        admitted=not admission_reason,
        admission_reason=admission_reason,
    )


def _default_prompt_http_pool_status(
    *,
    settings: ApiSettings,
    admitted: bool,
) -> dict[str, object]:
    return {
        "healthy": admitted,
        "configured": admitted,
        "base_url": settings.prompt_runtime_base_url,
        "max_connections": settings.prompt_runtime_max_connections,
        "max_keepalive_connections": settings.prompt_runtime_max_keepalive_connections,
        "keepalive_expiry_seconds": settings.prompt_runtime_keepalive_expiry_seconds,
    }
