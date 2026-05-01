from __future__ import annotations

from dataclasses import replace

from campus_contracts import (
    AgentObservability,
    AgentRequest,
    AgentResponse,
    CampusNoticeGetPayload,
    ErrorInfo,
)
from campus_notice_agent.query_service import NoticeQueryService
from campus_notice_agent.service import delegate_to_notice_agent

from campus_supervisor_agent_worker.agents_sdk_runner import (
    AgentsSdkRunner,
    AgentsSdkRunnerError,
    AgentsSdkToolExecutionRequest,
    run_agents_sdk_runner_shell,
)
from campus_supervisor_agent_worker.notice_tool_projection import bounded_notice_get_projection

AGENTS_SDK_NOTICE_GET_PILOT_SCHEMA_VERSION = "agents-sdk-notice-get-pilot-v1"
AGENTS_SDK_NOTICE_GET_PILOT_ERROR_SCHEMA_VERSION = "agents-sdk-notice-get-pilot-error-v1"


def run_notice_get_agents_sdk_pilot_adapter(
    request: AgentRequest,
    *,
    runner: AgentsSdkRunner,
    query_service: NoticeQueryService,
    enabled: bool,
) -> AgentResponse:
    if not enabled:
        return run_agents_sdk_runner_shell(
            request,
            runner=runner,
            enabled=False,
        )
    try:
        _validate_notice_get_request(request)
    except AgentsSdkRunnerError as exc:
        return _runtime_error_response(request, exc.failure_class, exc.message)

    captured_response: AgentResponse | None = None

    def execute_tool(execution: AgentsSdkToolExecutionRequest) -> dict[str, object]:
        nonlocal captured_response
        if execution.name != "campus_notice_get":
            raise AgentsSdkRunnerError(
                "sdk_wrong_tool",
                f"Agents SDK notice get pilot cannot execute tool: {execution.name}",
            )
        payload = CampusNoticeGetPayload(
            notice_id=_required_string(execution.arguments.get("notice_id"), "notice_id"),
            source_family=_optional_string(execution.arguments.get("source_family")),
        )
        captured_response = delegate_to_notice_agent(
            AgentRequest(
                target="notice-agent",
                user_goal=request.user_goal,
                conversation_id=request.conversation_id,
                request_id=request.request_id,
                safety_identifier=request.safety_identifier,
                trace=replace(request.trace, tool_call_id=execution.call_id),
                actor=request.actor,
                context=request.context,
                payload=payload,
                allowed_tools=("campus_notice_get",),
            ),
            query_service=query_service,
        )
        if captured_response.status == "error":
            message = (
                captured_response.error.message
                if captured_response.error is not None
                else "notice get tool execution failed"
            )
            raise AgentsSdkRunnerError(
                "sdk_tool_execution_failed",
                message,
                retryable=True,
            )
        return bounded_notice_get_projection(captured_response)

    shell_response = run_agents_sdk_runner_shell(
        request,
        runner=runner,
        enabled=True,
        execute_tool=execute_tool,
        require_tool_execution=True,
    )
    if shell_response.status != "completed":
        return shell_response
    if captured_response is None:
        return _runtime_error_response(
            request,
            "sdk_tool_not_executed",
            "Agents SDK notice get pilot did not execute the repo-owned tool",
        )
    return _response_with_notice_result(
        shell_response,
        captured_response=captured_response,
    )


def _validate_notice_get_request(request: AgentRequest) -> None:
    if request.target != "notice-agent":
        raise AgentsSdkRunnerError(
            "request_not_admitted",
            "Agents SDK notice get pilot requires notice-agent target",
        )
    if not isinstance(request.payload, CampusNoticeGetPayload):
        raise AgentsSdkRunnerError(
            "request_not_admitted",
            "Agents SDK notice get pilot requires CampusNoticeGetPayload",
        )
    if request.allowed_tools != ("campus_notice_get",):
        raise AgentsSdkRunnerError(
            "request_not_admitted",
            "Agents SDK notice get pilot requires allowed_tools=('campus_notice_get',), "
            f"got {request.allowed_tools!r}",
        )


def _response_with_notice_result(
    shell_response: AgentResponse,
    *,
    captured_response: AgentResponse,
) -> AgentResponse:
    shell_observability = shell_response.agent_observability or AgentObservability()
    notice_observability = captured_response.agent_observability or AgentObservability()
    safe_details = dict(notice_observability.safe_details)
    safe_details.update(shell_observability.safe_details)
    safe_details["agents_sdk_notice_get_pilot"] = {
        "schema_version": AGENTS_SDK_NOTICE_GET_PILOT_SCHEMA_VERSION,
        "tool_response_status": captured_response.status,
        "tool_response_confidence": captured_response.confidence,
        "tool_result_outcome": notice_observability.result_outcome,
        "source_ref_count": notice_observability.source_ref_count or 0,
    }
    response_status = (
        captured_response.status
        if captured_response.status != "completed"
        else shell_response.status
    )
    return replace(
        shell_response,
        status=response_status,
        confidence=captured_response.confidence,
        result=captured_response.result,
        agent_observability=replace(
            shell_observability,
            source_ref_count=notice_observability.source_ref_count,
            result_outcome=notice_observability.result_outcome,
            access_decision=notice_observability.access_decision,
            safe_details=safe_details,
        ),
    )


def _runtime_error_response(
    request: AgentRequest,
    failure_class: str,
    message: str,
    *,
    retryable: bool = False,
) -> AgentResponse:
    return AgentResponse(
        target=request.target,
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="agents_sdk_notice_get_pilot_failed",
            message=message,
            retryable=retryable,
        ),
        agent_observability=AgentObservability(
            selected_tool="campus_notice_get",
            tool_attempted=failure_class != "request_not_admitted",
            tool_outcome=failure_class,
            failure_class=failure_class,
            fail_close_reason=failure_class,
            result_outcome=failure_class,
            source_ref_count=0,
            access_decision="not_evaluated",
            safe_details={
                "agents_sdk_notice_get_pilot_error": {
                    "schema_version": AGENTS_SDK_NOTICE_GET_PILOT_ERROR_SCHEMA_VERSION,
                    "failure_class": failure_class,
                    "retryable": retryable,
                }
            },
        ),
    )


def _required_string(value: object, field_name: str) -> str:
    normalized = _optional_string(value)
    if not normalized:
        raise AgentsSdkRunnerError(
            "sdk_bad_arguments",
            f"Agents SDK notice get pilot argument {field_name} is required",
        )
    return normalized


def _optional_string(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


__all__ = [
    "AGENTS_SDK_NOTICE_GET_PILOT_SCHEMA_VERSION",
    "run_notice_get_agents_sdk_pilot_adapter",
]
