from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass

from campus_contracts import AgentRequest, AgentResponse, ErrorInfo, SupervisorRequest

from campus_supervisor_agent_worker.agent_dispatch import (
    AgentDispatchError,
    ExecutionCancelledError,
    dispatch_agent_request,
)
from campus_supervisor_agent_worker.bridge_auth import error_response, require_bridge_auth
from campus_supervisor_agent_worker.bridge_parse_utils import parse_optional_string, require_string
from campus_supervisor_agent_worker.bridge_readiness import (
    RuntimeStatusProvider,
    handle_bridge_healthz,
    handle_bridge_readyz,
)
from campus_supervisor_agent_worker.bridge_v6_parser import (
    parse_bridge_supervisor_envelope,
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
            "/internal/bridge/semantic/execution",
            lambda headers, body: handle_bridge_semantic_execution(
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
    runtime_agent_request: AgentRequest,
) -> AgentResponse:
    _ = request
    return dispatch_agent_request(runtime_agent_request)


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


def handle_bridge_semantic_execution(
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
        work_item = _parse_semantic_execution_work_item(payload)
        envelope = parse_bridge_supervisor_envelope(work_item.execution)
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
    runtime_agent_request = _bind_semantic_work_item_to_agent_request(
        runtime_agent_request,
        work_item,
    )

    runtime_cancel_flags = cancel_flags or CancelFlagStore()
    runtime_cancel_flags.prune_stale(max_age_seconds=settings.cancel_flag_ttl_seconds)
    runtime_cancel_flags.register(request)
    try:
        if runtime_cancel_flags.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Execution was cancelled.")
        response = agent_handler(request, runtime_agent_request)
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

    return _bridge_response(200, asdict(response), kind="semantic_agent_response")


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
    try:
        request_id = require_string(payload.get("request_id"), field_name="request_id")
        reason = parse_optional_string(payload.get("reason"), field_name="reason") or ""
    except ValueError as exc:
        return error_response(
            400,
            ErrorInfo(code="invalid_request", message=str(exc)),
        )
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


@dataclass(frozen=True, slots=True)
class SemanticExecutionWorkItem:
    run_id: str
    step_execution_id: str
    step_id: str
    lane: str
    worker_id: str
    attempt: int
    execution: dict[str, object]


def _parse_semantic_execution_work_item(payload: Mapping[str, object]) -> SemanticExecutionWorkItem:
    bridge_version = require_string(payload.get("bridge_version"), field_name="bridge_version")
    if bridge_version != "semantic_bridge_execution_v1":
        raise ValueError("bridge_version must be semantic_bridge_execution_v1")
    run_id = require_string(payload.get("run_id"), field_name="run_id")
    step_execution_id = require_string(
        payload.get("step_execution_id"),
        field_name="step_execution_id",
    )
    step_id = require_string(payload.get("step_id"), field_name="step_id")
    lane = require_string(payload.get("lane"), field_name="lane")
    worker_id = require_string(payload.get("worker_id"), field_name="worker_id")
    raw_attempt = payload.get("attempt")
    if not isinstance(raw_attempt, int) or raw_attempt < 1:
        raise ValueError("attempt must be a positive integer")
    raw_execution = payload.get("execution")
    if not isinstance(raw_execution, dict):
        raise ValueError("execution must be an object")
    return SemanticExecutionWorkItem(
        run_id=run_id,
        step_execution_id=step_execution_id,
        step_id=step_id,
        lane=lane,
        worker_id=worker_id,
        attempt=raw_attempt,
        execution=raw_execution,
    )


def _bind_semantic_work_item_to_agent_request(
    runtime_agent_request: AgentRequest,
    work_item: SemanticExecutionWorkItem,
) -> AgentRequest:
    workflow_context = runtime_agent_request.workflow_context
    return AgentRequest(
        target=runtime_agent_request.target,
        user_goal=runtime_agent_request.user_goal,
        conversation_id=runtime_agent_request.conversation_id,
        request_id=runtime_agent_request.request_id,
        safety_identifier=runtime_agent_request.safety_identifier,
        trace=runtime_agent_request.trace,
        actor=runtime_agent_request.actor,
        context=runtime_agent_request.context,
        payload=runtime_agent_request.payload,
        allowed_tools=runtime_agent_request.allowed_tools,
        workflow_context=type(workflow_context)(
            schema_version=workflow_context.schema_version,
            visibility=workflow_context.visibility,
            workflow_run_ref=work_item.run_id,
            step_id=work_item.step_id,
            agent_id=workflow_context.agent_id,
            target=workflow_context.target,
            required_projection_kind=workflow_context.required_projection_kind,
            expected_output_artifacts=workflow_context.expected_output_artifacts,
            projection_refs=workflow_context.projection_refs,
        ),
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
