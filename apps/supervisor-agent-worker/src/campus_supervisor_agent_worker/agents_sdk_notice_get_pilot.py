from __future__ import annotations

from campus_contracts import AgentObservability, AgentRequest, AgentResponse, ErrorInfo
from campus_notice_agent.query_service import NoticeQueryService

from campus_supervisor_agent_worker.agents_sdk_runner import (
    AgentsSdkRunner,
    run_agents_sdk_runner_shell,
)

AGENTS_SDK_NOTICE_GET_PILOT_SCHEMA_VERSION = "agents-sdk-notice-get-pilot-v1"
AGENTS_SDK_NOTICE_GET_PILOT_ERROR_SCHEMA_VERSION = "agents-sdk-notice-get-pilot-error-v1"


def run_notice_get_agents_sdk_pilot_adapter(
    request: AgentRequest,
    *,
    runner: AgentsSdkRunner,
    query_service: NoticeQueryService,
    enabled: bool,
) -> AgentResponse:
    _ = query_service
    if not enabled:
        return run_agents_sdk_runner_shell(
            request,
            runner=runner,
            enabled=False,
        )
    return _runtime_error_response(
        request,
        "runtime_closed",
        "Agents SDK notice get pilot is closed for internal notice resolve",
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
            selected_tool="",
            tool_attempted=False,
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


__all__ = [
    "AGENTS_SDK_NOTICE_GET_PILOT_SCHEMA_VERSION",
    "run_notice_get_agents_sdk_pilot_adapter",
]
