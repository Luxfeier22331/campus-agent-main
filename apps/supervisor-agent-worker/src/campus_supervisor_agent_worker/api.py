from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import asdict

from campus_contracts import AgentRequest, AgentResponse, ErrorInfo, SupervisorRequest

from campus_supervisor_agent_worker.agent_dispatch import (
    AgentDispatchError,
    ExecutionCancelledError,
    dispatch_agent_request,
)
from campus_supervisor_agent_worker.api_request_parsing import (
    parse_bridge_supervisor_envelope,
)
from campus_supervisor_agent_worker.bridge_auth import error_response, require_bridge_auth
from campus_supervisor_agent_worker.bridge_readiness import (
    RuntimeStatusProvider,
    handle_bridge_healthz,
    handle_bridge_readyz,
)
from campus_supervisor_agent_worker.cancel_flags import CancelFlagStore
from campus_supervisor_agent_worker.http_types import HttpResponse, HttpRoute
from campus_supervisor_agent_worker.prompt_stack import PromptRuntimeSettings
from campus_supervisor_agent_worker.settings import ApiSettings

AgentHandler = Callable[
    [AgentRequest],
    AgentResponse,
]
AgentEnvelopeHandler = Callable[
    [SupervisorRequest, AgentRequest],
    AgentResponse,
]


def build_bridge_routes(
    settings: ApiSettings,
    *,
    agent_handler: AgentEnvelopeHandler | None = None,
    prompt_runtime: PromptRuntimeSettings | None = None,
    runtime_status_provider: RuntimeStatusProvider | None = None,
    cancel_flags: CancelFlagStore | None = None,
) -> tuple[HttpRoute, ...]:
    runtime_cancel_flags = cancel_flags or CancelFlagStore()
    runtime_agent_handler = agent_handler or _default_agent_envelope_handler
    return (
        HttpRoute(
            "POST",
            "/internal/bridge/supervisor/answer",
            lambda headers, body: handle_bridge_answer(
                headers,
                body,
                settings,
                runtime_agent_handler,
                cancel_flags=runtime_cancel_flags,
            ),
        ),
        HttpRoute(
            "POST",
            "/internal/bridge/execution/cancel",
            lambda headers, body: handle_bridge_cancel(
                headers,
                body,
                settings,
                cancel_flags=runtime_cancel_flags,
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


def _default_agent_envelope_handler(
    request: SupervisorRequest,
    preplanned_agent_request: AgentRequest,
) -> AgentResponse:
    _ = request
    return dispatch_agent_request(preplanned_agent_request)


def handle_bridge_answer(
    headers: Mapping[str, str],
    body: dict[str, object] | None,
    settings: ApiSettings,
    agent_handler: AgentEnvelopeHandler,
    *,
    cancel_flags: CancelFlagStore | None = None,
) -> HttpResponse:
    bridge_auth_error = require_bridge_auth(headers, settings)
    if bridge_auth_error is not None:
        return bridge_auth_error

    payload = body or {}
    try:
        envelope = parse_bridge_supervisor_envelope(payload)
    except ValueError as exc:
        return _bridge_response(
            400,
            {"error": asdict(ErrorInfo(code="invalid_request", message=str(exc)))},
            kind="bridge_invalid_request",
        )
    request = envelope.request
    runtime_agent_request = envelope.agent_request
    if runtime_agent_request is None:
        return _bridge_response(
            400,
            {
                "error": asdict(
                    ErrorInfo(
                        code="invalid_request",
                        message="runtime_decisions.handoff.agent_request is required.",
                    )
                )
            },
            kind="bridge_invalid_request",
        )

    runtime_cancel_flags = cancel_flags or CancelFlagStore()
    runtime_cancel_flags.prune_stale(max_age_seconds=settings.cancel_flag_ttl_seconds)
    runtime_cancel_flags.register(request)
    try:
        if runtime_cancel_flags.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Execution was cancelled.")
        response = agent_handler(
            request,
            runtime_agent_request,
        )
        if runtime_cancel_flags.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Execution was cancelled.")
    except ExecutionCancelledError as exc:
        return _bridge_response(
            exc.http_status_code,
            {"error": asdict(exc.to_error_info())},
            kind="supervisor_error",
        )
    except AgentDispatchError as exc:
        return _bridge_response(
            exc.http_status_code,
            {"error": asdict(exc.to_error_info())},
            kind="supervisor_error",
        )
    finally:
        runtime_cancel_flags.complete(request.request_id)

    return _bridge_response(200, asdict(response), kind="agent_response")


def handle_bridge_cancel(
    headers: Mapping[str, str],
    body: dict[str, object] | None,
    settings: ApiSettings,
    *,
    cancel_flags: CancelFlagStore,
) -> HttpResponse:
    bridge_auth_error = require_bridge_auth(headers, settings)
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
    record = cancel_flags.cancel(request_id, reason)
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
