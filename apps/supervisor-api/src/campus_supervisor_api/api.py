from __future__ import annotations

import secrets
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field
from uuid import uuid4

from campus_contracts import ErrorInfo, SupervisorRequest, SupervisorResponse, TraceContext
from campus_supervisor_core import (
    SupervisorError,
    build_audit_record,
    build_error_audit_record,
    handle_request,
)

from campus_supervisor_api.api_request_parsing import (
    _parse_bridge_supervisor_request,
    _parse_context_projection,
    _parse_optional_string,
    _parse_request_actor_projection,
    _parse_requested_capability,
    _parse_requested_scope,
    _parse_version_query,
    _resolve_request_identity_projection,
)
from campus_supervisor_api.audit import AuditSink, AuditSinkError, build_jsonl_audit_sink
from campus_supervisor_api.auth import ApiAuthError, map_actor_context
from campus_supervisor_api.prompt_stack import PromptRuntimeSettings
from campus_supervisor_api.settings import ApiSettings


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


SupervisorHandler = Callable[[SupervisorRequest], SupervisorResponse]
RuntimeStatusProvider = Callable[[], Mapping[str, Mapping[str, object]]]


def build_routes(
    settings: ApiSettings,
    *,
    supervisor_handler: SupervisorHandler = handle_request,
    audit_sink: AuditSink | None = None,
    prompt_runtime: PromptRuntimeSettings | None = None,
    runtime_status_provider: RuntimeStatusProvider | None = None,
) -> tuple[HttpRoute, ...]:
    return (
        HttpRoute(
            "POST",
            "/api/v1/answer",
            lambda headers, body: handle_answer(
                headers,
                body,
                settings,
                supervisor_handler,
                audit_sink=audit_sink,
            ),
        ),
        HttpRoute("GET", "/healthz", lambda headers, body: healthz(settings)),
        HttpRoute(
            "GET",
            "/readyz",
            lambda headers, body: readyz(
                settings,
                prompt_runtime=prompt_runtime,
                runtime_status_provider=runtime_status_provider,
            ),
        ),
    )


def build_bridge_routes(
    settings: ApiSettings,
    *,
    supervisor_handler: SupervisorHandler = handle_request,
    audit_sink: AuditSink | None = None,
    prompt_runtime: PromptRuntimeSettings | None = None,
    runtime_status_provider: RuntimeStatusProvider | None = None,
) -> tuple[HttpRoute, ...]:
    return (
        HttpRoute(
            "POST",
            "/internal/bridge/supervisor/answer",
            lambda headers, body: handle_bridge_answer(
                headers,
                body,
                settings,
                supervisor_handler,
                audit_sink=audit_sink,
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


def handle_answer(
    headers: Mapping[str, str],
    body: dict[str, object] | None,
    settings: ApiSettings,
    supervisor_handler: SupervisorHandler,
    *,
    audit_sink: AuditSink | None = None,
) -> HttpResponse:
    runtime_audit_sink = audit_sink or build_jsonl_audit_sink(settings.audit_log_path)
    try:
        authenticated_actor = map_actor_context(headers, settings)
    except ApiAuthError as exc:
        return error_response(exc.status_code, ErrorInfo(code=exc.code, message=exc.message))

    payload = body or {}
    user_goal = str(payload.get("user_goal", ""))
    trace_id = str(headers.get("x-trace-id") or uuid4())
    try:
        body_actor = _parse_request_actor_projection(
            payload.get("actor"),
            auth_mode=settings.auth_mode,
        )
        body_context = _parse_context_projection(
            payload.get("context"),
            auth_mode=settings.auth_mode,
        )
        actor, context = _resolve_request_identity_projection(
            authenticated_actor=authenticated_actor,
            body_actor=body_actor,
            body_context=body_context,
            auth_mode=settings.auth_mode,
        )
        request = SupervisorRequest(
            user_goal=user_goal,
            conversation_id=str(payload.get("conversation_id", "")),
            request_id=str(payload.get("request_id", "")),
            safety_identifier=_parse_optional_string(payload.get("safety_identifier")),
            trace=TraceContext(trace_id=trace_id),
            actor=actor,
            context=context,
            requested_capability=_parse_requested_capability(payload.get("requested_capability")),
            requested_scope=_parse_requested_scope(payload.get("requested_scope")),
            version_query=_parse_version_query(payload.get("version_query")),
        )
    except ValueError as exc:
        return error_response(400, ErrorInfo(code="invalid_request", message=str(exc)))
    try:
        response = supervisor_handler(request)
    except SupervisorError as exc:
        _emit_audit_best_effort(
            runtime_audit_sink,
            build_error_audit_record(request, error_code=exc.error_code),
        )
        return error_response(exc.http_status_code, exc.to_error_info())
    _emit_audit_best_effort(runtime_audit_sink, build_audit_record(request, response))
    response_payload = asdict(response)
    response_payload["trace_id"] = trace_id
    return HttpResponse(status_code=200, json_body=response_payload)


def handle_bridge_answer(
    headers: Mapping[str, str],
    body: dict[str, object] | None,
    settings: ApiSettings,
    supervisor_handler: SupervisorHandler,
    *,
    audit_sink: AuditSink | None = None,
) -> HttpResponse:
    bridge_auth_error = _require_bridge_auth(headers, settings)
    if bridge_auth_error is not None:
        return bridge_auth_error

    runtime_audit_sink = audit_sink or build_jsonl_audit_sink(settings.audit_log_path)
    payload = body or {}
    try:
        request = _parse_bridge_supervisor_request(payload)
    except ValueError as exc:
        return _bridge_response(
            400,
            {"error": asdict(ErrorInfo(code="invalid_request", message=str(exc)))},
            kind="bridge_invalid_request",
        )

    try:
        response = supervisor_handler(request)
    except SupervisorError as exc:
        _emit_audit_best_effort(
            runtime_audit_sink,
            build_error_audit_record(request, error_code=exc.error_code),
        )
        return _bridge_response(
            exc.http_status_code,
            {"error": asdict(exc.to_error_info())},
            kind="supervisor_error",
        )

    _emit_audit_best_effort(runtime_audit_sink, build_audit_record(request, response))
    return _bridge_response(200, asdict(response), kind="supervisor_response")


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
    audit_runtime = dict(
        runtime_status.get("audit_runtime")
        or {
            "healthy": True,
            "queue_depth": 0,
            "queue_capacity": 0,
            "dropped_count": 0,
            "writer_alive": True,
            "last_error": "",
        }
    )
    transport_runtime = dict(
        runtime_status.get("transport_runtime")
        or {
            "healthy": True,
            "max_concurrent_answers": settings.transport_max_concurrent_answers,
            "active_answers": 0,
            "saturated_count": 0,
        }
    )
    degraded = (
        not runtime_prompt.admitted
        or not bool(prompt_http_pool.get("healthy", True))
        or not bool(audit_runtime.get("healthy", True))
        or not bool(transport_runtime.get("healthy", True))
    )
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
            "audit_runtime": audit_runtime,
            "transport_runtime": transport_runtime,
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


def _emit_audit_best_effort(audit_sink: AuditSink, record: object) -> None:
    try:
        audit_sink(record)  # type: ignore[arg-type]
    except AuditSinkError:
        return


def _resolve_prompt_runtime_settings(settings: ApiSettings) -> PromptRuntimeSettings:
    prompt_runtime_provider = settings.prompt_runtime_provider or settings.runtime_provider
    if not prompt_runtime_provider:
        admission_reason = "provider_not_configured"
    elif not settings.prompt_strict_structured_outputs:
        admission_reason = "strict_structured_outputs_disabled"
    elif (
        not settings.supervisor_prompt_model.strip() or not settings.specialist_prompt_model.strip()
    ):
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
