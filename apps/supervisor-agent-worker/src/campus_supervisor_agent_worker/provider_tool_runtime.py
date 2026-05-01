from __future__ import annotations

from campus_contracts import AgentObservability, AgentRequest, AgentResponse, ErrorInfo
from campus_notice_agent.query_service import NoticeQueryService

from campus_supervisor_agent_worker.provider_function_calling import (
    ProviderFunctionToolProvider,
    ProviderFunctionToolRequest,
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
    _ = provider, query_service, finalize_with_provider
    if not enabled:
        return _runtime_error_response(
            request,
            "runtime_disabled",
            "provider-native notice get tool runtime is disabled",
        )
    return _runtime_error_response(
        request,
        "runtime_closed",
        "provider-native notice get tool runtime is closed for internal notice resolve",
    )


def _runtime_error_response(
    request: AgentRequest,
    failure_class: str,
    message: str,
) -> AgentResponse:
    return AgentResponse(
        target=request.target,
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="provider_tool_runtime_failed",
            message=message,
            retryable=False,
        ),
        agent_observability=AgentObservability(
            selected_tool="",
            tool_attempted=False,
            tool_outcome=failure_class,
            failure_class=failure_class,
            result_outcome=failure_class,
            source_ref_count=0,
            access_decision="not_evaluated",
            safe_details={
                "provider_tool_runtime_error": {
                    "schema_version": "provider-tool-runtime-error-v1",
                    "failure_class": failure_class,
                    "retryable": False,
                }
            },
        ),
    )


__all__ = [
    "DEFAULT_PROVIDER_TOOL_RUNTIME_ALLOWED_TOOLS",
    "ProviderFunctionToolProvider",
    "ProviderFunctionToolRequest",
    "ProviderToolRuntimeAdmissionError",
    "run_notice_get_provider_tool_adapter",
]
