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

from campus_supervisor_agent_worker.notice_tool_projection import bounded_notice_get_projection
from campus_supervisor_agent_worker.provider_function_calling import (
    ProviderFunctionToolAdmissionError,
    ProviderFunctionToolProvider,
    ProviderFunctionToolRequest,
    plan_required_provider_function_call,
    run_required_provider_tool_loop,
)
from campus_supervisor_agent_worker.provider_tool_runtime_policy import (
    DEFAULT_PROVIDER_TOOL_RUNTIME_ALLOWED_TOOLS,
)


class ProviderToolRuntimeAdmissionError(ValueError):
    def __init__(self, failure_class: str, message: str) -> None:
        super().__init__(f"{failure_class}: {message}")
        self.failure_class = failure_class
        self.message = message


def run_notice_get_provider_tool_adapter(
    request: AgentRequest,
    *,
    provider: ProviderFunctionToolProvider,
    query_service: NoticeQueryService,
    enabled: bool,
    finalize_with_provider: bool = False,
) -> AgentResponse:
    if not enabled:
        return _runtime_error_response(
            "runtime_disabled",
            "provider-native notice get tool runtime is disabled",
        )
    try:
        _validate_notice_get_request(request)
        if finalize_with_provider:
            return _run_notice_get_provider_tool_loop(
                request,
                provider=provider,
                query_service=query_service,
            )
        provider_call = plan_required_provider_function_call(
            user_goal=request.user_goal,
            allowed_tools=request.allowed_tools,
            provider=provider,
        )
        response = _execute_notice_get_tool_call(
            request,
            provider_arguments=provider_call.arguments,
            query_service=query_service,
            model_tool_call_ref=provider_call.call_id,
        )
        return _response_with_provider_projection(
            response,
            model_tool_call_ref=provider_call.call_id,
            model_response_ref=provider_call.response_id,
            tool_output_submitted=False,
            argument_keys=tuple(sorted(provider_call.arguments)),
            tool_execution_count=1,
        )
    except ProviderFunctionToolAdmissionError as exc:
        return _runtime_error_response(_classify_provider_call_error(exc), str(exc))
    except ProviderToolRuntimeAdmissionError as exc:
        return _runtime_error_response(exc.failure_class, exc.message)
    except ValueError as exc:
        return _runtime_error_response("provider_bad_arguments", str(exc))


def _run_notice_get_provider_tool_loop(
    request: AgentRequest,
    *,
    provider: ProviderFunctionToolProvider,
    query_service: NoticeQueryService,
) -> AgentResponse:
    captured_response: AgentResponse | None = None

    def execute_tool(tool_name: str, arguments: dict[str, object]) -> dict[str, object]:
        nonlocal captured_response
        if tool_name != "campus_notice_get":
            raise ProviderFunctionToolAdmissionError(
                f"provider returned disallowed tool call: {tool_name}"
            )
        captured_response = _execute_notice_get_tool_call(
            request,
            provider_arguments=arguments,
            query_service=query_service,
            model_tool_call_ref="",
        )
        return bounded_notice_get_projection(captured_response)

    loop_result = run_required_provider_tool_loop(
        user_goal=request.user_goal,
        allowed_tools=request.allowed_tools,
        provider=provider,
        execute_tool=execute_tool,
    )
    if captured_response is None:
        raise ProviderToolRuntimeAdmissionError(
            "tool_result_projection_failed",
            "notice get provider tool loop did not execute the tool",
        )
    return _response_with_provider_projection(
        replace(captured_response, answer_text=loop_result.final_answer_text),
        model_tool_call_ref=loop_result.tool_call.call_id,
        model_response_ref=loop_result.model_response_ref,
        tool_output_submitted=True,
        argument_keys=tuple(sorted(loop_result.tool_call.arguments)),
        tool_execution_count=1,
    )


def _execute_notice_get_tool_call(
    request: AgentRequest,
    *,
    provider_arguments: dict[str, object],
    query_service: NoticeQueryService,
    model_tool_call_ref: str,
) -> AgentResponse:
    payload = CampusNoticeGetPayload(
        notice_id=_required_string(provider_arguments.get("notice_id"), "notice_id"),
        source_family=_optional_string(provider_arguments.get("source_family")),
    )
    return delegate_to_notice_agent(
        AgentRequest(
            target="notice-agent",
            user_goal=request.user_goal,
            conversation_id=request.conversation_id,
            request_id=request.request_id,
            safety_identifier=request.safety_identifier,
            trace=replace(request.trace, tool_call_id=model_tool_call_ref),
            actor=request.actor,
            context=request.context,
            payload=payload,
            allowed_tools=request.allowed_tools,
        ),
        query_service=query_service,
    )


def _validate_notice_get_request(request: AgentRequest) -> None:
    if request.target != "notice-agent":
        raise ProviderToolRuntimeAdmissionError(
            "request_not_admitted",
            "notice get provider runtime requires notice-agent target",
        )
    if not isinstance(request.payload, CampusNoticeGetPayload):
        raise ProviderToolRuntimeAdmissionError(
            "request_not_admitted",
            "notice get provider runtime requires CampusNoticeGetPayload",
        )
    if request.allowed_tools != ("campus_notice_get",):
        raise ProviderToolRuntimeAdmissionError(
            "request_not_admitted",
            "notice get provider runtime requires allowed_tools=('campus_notice_get',), "
            f"got {request.allowed_tools!r}",
        )


def _classify_provider_call_error(error: ProviderFunctionToolAdmissionError) -> str:
    message = str(error)
    if "required function call" in message:
        return "provider_no_tool_call"
    if "disallowed tool call" in message:
        return "provider_wrong_tool"
    if "arguments" in message:
        return "provider_bad_arguments"
    if "request failed" in message:
        return "provider_request_failed"
    return "provider_call_failed"


def _response_with_provider_projection(
    response: AgentResponse,
    *,
    model_tool_call_ref: str,
    model_response_ref: str,
    tool_output_submitted: bool,
    argument_keys: tuple[str, ...] = (),
    tool_execution_count: int = 0,
) -> AgentResponse:
    observability = response.agent_observability or AgentObservability()
    safe_details = dict(observability.safe_details)
    safe_details["provider_tool_call_projection"] = {
        "schema_version": "provider-tool-call-projection-v1",
        "tool_call_id_source": "repo",
        "model_tool_call_ref": model_tool_call_ref,
        "model_response_ref": model_response_ref,
        "tool_output_submitted": tool_output_submitted,
        "argument_keys": list(argument_keys),
        "tool_execution_count": tool_execution_count,
    }
    return replace(
        response,
        agent_observability=replace(observability, safe_details=safe_details),
    )


def _runtime_error_response(failure_class: str, message: str) -> AgentResponse:
    retryable = failure_class in {"provider_request_failed", "provider_call_failed"}
    return AgentResponse(
        target="notice-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="provider_tool_runtime_failed",
            message=message,
            retryable=retryable,
        ),
        agent_observability=AgentObservability(
            selected_tool="campus_notice_get",
            tool_attempted=failure_class != "runtime_disabled",
            tool_outcome=failure_class,
            failure_class=failure_class,
            result_outcome=failure_class,
            source_ref_count=0,
            access_decision="not_evaluated",
            safe_details={
                "provider_tool_runtime_error": {
                    "schema_version": "provider-tool-runtime-error-v1",
                    "failure_class": failure_class,
                    "retryable": retryable,
                }
            },
        ),
    )


def _required_string(value: object, field_name: str) -> str:
    normalized = _optional_string(value)
    if not normalized:
        raise ValueError(f"provider tool argument {field_name} is required")
    return normalized


def _optional_string(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


__all__ = [
    "DEFAULT_PROVIDER_TOOL_RUNTIME_ALLOWED_TOOLS",
    "ProviderFunctionToolProvider",
    "ProviderFunctionToolRequest",
    "ProviderToolRuntimeAdmissionError",
    "run_notice_get_provider_tool_adapter",
]
