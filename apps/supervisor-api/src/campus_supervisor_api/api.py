from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Callable, Mapping
from uuid import uuid4

from campus_contracts import (
    ErrorInfo,
    KnowledgeScope,
    RagRequestPayload,
    SpecialistRequest,
    SpecialistResponse,
    TraceContext,
)
from campus_supervisor_core import handle_request

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


SupervisorHandler = Callable[[SpecialistRequest], SpecialistResponse]


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
    try:
        actor = map_actor_context(headers, settings)
    except ApiAuthError as exc:
        return error_response(exc.status_code, ErrorInfo(code=exc.code, message=exc.message))

    payload = body or {}
    user_goal = str(payload.get("user_goal", ""))
    trace_id = str(headers.get("x-trace-id") or uuid4())
    request = SpecialistRequest(
        target="rag-specialist",
        user_goal=user_goal,
        conversation_id=str(payload.get("conversation_id", "bootstrap-conversation")),
        request_id=str(payload.get("request_id", "")),
        trace=TraceContext(trace_id=trace_id),
        actor=actor,
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
        ),
    )
    response = supervisor_handler(request)
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
            "runtime_provider": "agno",
            "supervisor_model": settings.agno_supervisor_model,
            "specialist_model": settings.agno_specialist_model,
        },
    )


def error_response(status_code: int, error: ErrorInfo) -> HttpResponse:
    return HttpResponse(status_code=status_code, json_body={"error": asdict(error)})
