from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Callable, Mapping
from uuid import uuid4

from campus_contracts import (
    ErrorInfo,
    KnowledgeScope,
    SupervisorResponse,
    SupervisorRequest,
    TraceContext,
)
from campus_supervisor_core import (
    SupervisorError,
    build_audit_record,
    build_error_audit_record,
    handle_request,
)

from campus_supervisor_api.audit import AuditSinkError, build_jsonl_audit_sink
from campus_supervisor_api.auth import ApiAuthError, map_actor_context
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


def build_routes(
    settings: ApiSettings,
    *,
    supervisor_handler: SupervisorHandler = handle_request,
) -> tuple[HttpRoute, ...]:
    return (
        HttpRoute(
            "POST",
            "/api/v1/answer",
            lambda headers, body: handle_answer(headers, body, settings, supervisor_handler),
        ),
        HttpRoute("GET", "/healthz", lambda headers, body: healthz(settings)),
        HttpRoute("GET", "/readyz", lambda headers, body: readyz(settings)),
    )


def handle_answer(
    headers: Mapping[str, str],
    body: dict[str, object] | None,
    settings: ApiSettings,
    supervisor_handler: SupervisorHandler,
) -> HttpResponse:
    audit_sink = build_jsonl_audit_sink(settings.audit_log_path)
    try:
        actor = map_actor_context(headers, settings)
    except ApiAuthError as exc:
        return error_response(exc.status_code, ErrorInfo(code=exc.code, message=exc.message))

    payload = body or {}
    user_goal = str(payload.get("user_goal", ""))
    trace_id = str(headers.get("x-trace-id") or uuid4())
    try:
        request = SupervisorRequest(
            user_goal=user_goal,
            conversation_id=str(payload.get("conversation_id", "")),
            request_id=str(payload.get("request_id", "")),
            trace=TraceContext(trace_id=trace_id),
            actor=actor,
            requested_capability=_parse_requested_capability(payload.get("requested_capability")),
            requested_scope=_parse_requested_scope(payload.get("requested_scope")),
            availability_target_id=_parse_optional_string(payload.get("availability_target_id")),
            follow_redirects=_parse_follow_redirects(payload.get("follow_redirects")),
        )
    except ValueError as exc:
        return error_response(400, ErrorInfo(code="invalid_request", message=str(exc)))
    try:
        response = supervisor_handler(request)
    except SupervisorError as exc:
        try:
            audit_sink(build_error_audit_record(request, error_code=exc.error_code))
        except AuditSinkError as audit_exc:
            return error_response(
                500,
                ErrorInfo(code="audit_write_failed", message=str(audit_exc), retryable=False),
            )
        return error_response(exc.http_status_code, exc.to_error_info())
    try:
        audit_sink(build_audit_record(request, response))
    except AuditSinkError as exc:
        return error_response(
            500,
            ErrorInfo(code="audit_write_failed", message=str(exc), retryable=False),
        )
    response_payload = asdict(response)
    response_payload["trace_id"] = trace_id
    return HttpResponse(status_code=200, json_body=response_payload)


def healthz(settings: ApiSettings) -> HttpResponse:
    return HttpResponse(status_code=200, json_body={"status": "ok", "app_name": settings.app_name})


def readyz(settings: ApiSettings) -> HttpResponse:
    return HttpResponse(
        status_code=200,
        json_body={
            "status": "ready",
            "runtime_provider": settings.runtime_provider,
            "supervisor_model": settings.agno_supervisor_model,
            "specialist_model": settings.agno_specialist_model,
        },
    )


def error_response(status_code: int, error: ErrorInfo) -> HttpResponse:
    return HttpResponse(status_code=status_code, json_body={"error": asdict(error)})


def _parse_requested_scope(raw_scope: object) -> KnowledgeScope | None:
    if raw_scope is None:
        return None
    if not isinstance(raw_scope, dict):
        raise ValueError("requested_scope must be an object")
    corpus = str(raw_scope.get("corpus", "")).strip()
    collection = str(raw_scope.get("collection", "")).strip()
    if not corpus or not collection:
        raise ValueError("requested_scope requires corpus and collection")
    return KnowledgeScope(corpus=corpus, collection=collection)


def _parse_requested_capability(raw_capability: object) -> str | None:
    if raw_capability is None:
        return None
    capability = str(raw_capability).strip()
    return capability or None


def _parse_optional_string(raw_value: object) -> str | None:
    if raw_value is None:
        return None
    value = str(raw_value).strip()
    return value or None


def _parse_follow_redirects(raw_value: object) -> bool:
    if raw_value is None:
        return True
    if isinstance(raw_value, bool):
        return raw_value
    raise ValueError("follow_redirects must be a boolean")
