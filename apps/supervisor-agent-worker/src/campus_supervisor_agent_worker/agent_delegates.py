from __future__ import annotations

import httpx
from campus_contracts import (
    AgentObservability,
    AgentRequest,
    AgentResponse,
    ErrorInfo,
)
from campus_navigation_agent import delegate_to_navigation_agent
from campus_notice_agent import NoticeHTTPQueryService
from campus_notice_agent.notice_get_runtime import run_notice_get_internal_request
from campus_notice_agent.sdk_tool_executor import execute_notice_sdk_tool
from campus_rag_agent.service import delegate_to_rag_agent
from campus_retrieval_core import build_jsonl_retrieval_observation_sink
from campus_services_agent import (
    CampusServicesHTTPQueryService,
)
from campus_services_agent.sdk_tool_executor import execute_campus_services_sdk_tool
from campus_shared import PromptRuntimeHTTPSettings, PromptRuntimeProviderConfig

from campus_supervisor_agent_worker.agent_dispatch import (
    AgentDelegate,
    ExecutionCancelledError,
    dispatch_agent_request,
)
from campus_supervisor_agent_worker.agents_sdk_instruction_profiles import (
    instruction_profile_for_request,
)
from campus_supervisor_agent_worker.agents_sdk_tool_bridge import (
    AgentsSdkToolBridgeError,
    build_agents_sdk_tool_descriptors,
)
from campus_supervisor_agent_worker.agents_sdk_trace_projection import (
    build_agents_sdk_trace_projection,
    elapsed_agents_sdk_latency_ms,
    start_agents_sdk_trace_timer,
)
from campus_supervisor_agent_worker.cancel_flags import CancelFlagStore
from campus_supervisor_agent_worker.openai_agents_runtime import (
    OpenAIAgentsNativeRuntime,
    OpenAIAgentsRuntimeError,
    OpenAIAgentsToolInvocation,
)
from campus_supervisor_agent_worker.openai_agents_runtime_projection import (
    OPENAI_AGENTS_RUNTIME_ERROR_SCHEMA_VERSION,
    OpenAIAgentsRuntimeProjectionError,
    OpenAIAgentsToolExecutionRecord,
    bounded_tool_result_projection,
    response_from_native_runtime_result,
    runtime_error_response,
)
from campus_supervisor_agent_worker.prompt_executor import ProviderBackedRagPromptExecutor
from campus_supervisor_agent_worker.rag_agents_sdk_openai_runner import (
    OpenAIRagAgentsSdkRunner,
)
from campus_supervisor_agent_worker.retrieval_observation_bridge import (
    build_retrieval_runtime_event_sink,
    build_runtime_event_jsonl_emitter,
    compose_retrieval_observation_sinks,
)
from campus_supervisor_agent_worker.settings import ApiSettings
from campus_supervisor_agent_worker.tool_spec_registry import default_tool_spec_registry


def bind_agent_handler(
    settings: ApiSettings,
    *,
    agent_handler,
    rag_prompt_executor: ProviderBackedRagPromptExecutor | None,
    cancel_flags: CancelFlagStore,
    prompt_http_client: httpx.Client | None = None,
):
    if agent_handler is not dispatch_agent_request:
        return _wrap_with_cancel_checks(agent_handler, cancel_flags)
    campus_services_query_service = _build_campus_services_query_service(settings)
    notice_query_service = _build_notice_query_service(settings)
    agent_delegates = _build_agent_delegates(
        settings=settings,
        rag_prompt_executor=rag_prompt_executor,
        campus_services_query_service=campus_services_query_service,
        notice_query_service=notice_query_service,
        openai_agents_runtime=_build_openai_agents_runtime(settings),
        rag_openai_runtime=_build_rag_openai_runtime(settings),
    )

    return lambda request, runtime_agent_request: dispatch_agent_request(
        runtime_agent_request,
        agent_delegates=agent_delegates,
        cancellation_checker=lambda: cancel_flags.is_cancel_requested(request.request_id),
    )


def _build_agent_delegates(
    *,
    settings: ApiSettings,
    rag_prompt_executor: ProviderBackedRagPromptExecutor | None,
    campus_services_query_service: CampusServicesHTTPQueryService | None,
    notice_query_service: NoticeHTTPQueryService | None,
    openai_agents_runtime: OpenAIAgentsNativeRuntime | None = None,
    rag_openai_runtime=None,
) -> dict[str, AgentDelegate]:
    retrieval_jsonl_observation_sink = (
        build_jsonl_retrieval_observation_sink(settings.retrieval_observation_jsonl_path)
        if settings.retrieval_observation_jsonl_path
        else None
    )
    retrieval_runtime_event_sink = (
        build_retrieval_runtime_event_sink(
            build_runtime_event_jsonl_emitter(settings.retrieval_runtime_event_jsonl_path)
        )
        if settings.retrieval_runtime_event_jsonl_path
        else None
    )
    retrieval_observation_sink = compose_retrieval_observation_sinks(
        retrieval_jsonl_observation_sink,
        retrieval_runtime_event_sink,
    )
    agent_delegates: dict[str, AgentDelegate] = {
        "rag-agent": lambda agent_request: delegate_to_rag_agent(
            agent_request,
            prompt_executor=rag_prompt_executor,
            retrieval_observation_sink=retrieval_observation_sink,
            include_retrieval_observation_query_text=(
                settings.retrieval_observation_include_query_text
            ),
            rag_sdk_runner=rag_openai_runtime,
        ),
        "navigation-agent": delegate_to_navigation_agent,
        "campus-services-agent": _sdk_required_missing_query_service_delegate,
        "notice-agent": _notice_missing_query_service_delegate,
    }
    if campus_services_query_service is not None:
        agent_delegates["campus-services-agent"] = lambda agent_request: (
            _execute_campus_services_agent_request(
                agent_request,
                settings=settings,
                query_service=campus_services_query_service,
                openai_agents_runtime=openai_agents_runtime,
            )
        )
    if notice_query_service is not None:
        agent_delegates["notice-agent"] = lambda agent_request: _execute_notice_agent_request(
            agent_request,
            settings=settings,
            query_service=notice_query_service,
            openai_agents_runtime=openai_agents_runtime,
        )
    return agent_delegates


def _execute_notice_agent_request(
    agent_request: AgentRequest,
    *,
    settings: ApiSettings,
    query_service: NoticeHTTPQueryService,
    openai_agents_runtime: OpenAIAgentsNativeRuntime | None,
):
    if _is_sdk_admitted_structured_request(agent_request):
        return _run_structured_native_runtime(
            agent_request,
            settings=settings,
            runtime=openai_agents_runtime,
            execute_tool=lambda invocation: execute_notice_sdk_tool(
                invocation,
                agent_request=agent_request,
                query_service=query_service,
            ),
        )
    return run_notice_get_internal_request(
        agent_request,
        query_service=query_service,
    )


def _execute_campus_services_agent_request(
    agent_request: AgentRequest,
    *,
    settings: ApiSettings,
    query_service: CampusServicesHTTPQueryService,
    openai_agents_runtime: OpenAIAgentsNativeRuntime | None,
):
    if _is_sdk_admitted_structured_request(agent_request):
        return _run_structured_native_runtime(
            agent_request,
            settings=settings,
            runtime=openai_agents_runtime,
            execute_tool=lambda invocation: execute_campus_services_sdk_tool(
                invocation,
                agent_request=agent_request,
                query_service=query_service,
            ),
        )
    return _agents_sdk_admission_error_response(
        agent_request,
        failure_class="request_not_admitted",
        message="campus-services-agent structured execution requires SDK admission",
        bridge_reason="request_not_admitted",
    )


def _is_sdk_admitted_structured_request(agent_request: AgentRequest) -> bool:
    if len(agent_request.allowed_tools) != 1:
        return False
    tool_name = agent_request.allowed_tools[0]
    tool = default_tool_spec_registry().tool_by_name(tool_name)
    if tool is None:
        return False
    return (
        tool.active
        and tool.surface == "structured_handoff"
        and tool.owner_agent == agent_request.target
        and tool.runtime_posture == "sdk_adapter_admitted"
    )


def _sdk_required_missing_query_service_delegate(agent_request: AgentRequest) -> AgentResponse:
    return _agents_sdk_admission_error_response(
        agent_request,
        failure_class="query_service_unavailable",
        message="SDK-admitted structured tool requires an internal query service",
        bridge_reason="query_service_unavailable",
    )


def _notice_missing_query_service_delegate(agent_request: AgentRequest) -> AgentResponse:
    if _is_sdk_admitted_structured_request(agent_request):
        return _agents_sdk_admission_error_response(
            agent_request,
            failure_class="query_service_unavailable",
            message="SDK-admitted structured tool requires an internal query service",
            bridge_reason="query_service_unavailable",
        )
    return run_notice_get_internal_request(agent_request, query_service=None)


def _agents_sdk_admission_error_response(
    agent_request: AgentRequest,
    *,
    failure_class: str,
    message: str,
    bridge_reason: str,
) -> AgentResponse:
    selected_tool = agent_request.allowed_tools[0] if agent_request.allowed_tools else ""
    return AgentResponse(
        target=agent_request.target,
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="agents_sdk_runtime_failed",
            message=message,
            retryable=False,
        ),
        agent_observability=AgentObservability(
            selected_tool=selected_tool,
            tool_attempted=False,
            tool_outcome=failure_class,
            failure_class=failure_class,
            fail_close_reason=failure_class,
            result_outcome=failure_class,
            source_ref_count=0,
            access_decision="not_evaluated",
            safe_details={
                "openai_agents_runtime_error": {
                    "schema_version": OPENAI_AGENTS_RUNTIME_ERROR_SCHEMA_VERSION,
                    "failure_class": failure_class,
                    "retryable": False,
                    "bridge_reason": bridge_reason,
                },
                "agents_sdk_trace_projection": build_agents_sdk_trace_projection(
                    target=agent_request.target,
                    selected_tool=selected_tool,
                    runtime_posture=_runtime_posture_for_request(agent_request),
                    tool_call_count=0,
                    tool_execution_count=0,
                    tool_argument_keys=(),
                    tool_outcome=failure_class,
                    result_outcome=failure_class,
                    failure_class=failure_class,
                    retryable=False,
                    tool_attempted=False,
                    latency_ms=0,
                    model_response_ref="",
                    workflow_run_ref=agent_request.workflow_context.workflow_run_ref,
                    step_id=agent_request.workflow_context.step_id,
                    agent_id=agent_request.workflow_context.agent_id,
                    step_status="error",
                    terminal_reason=failure_class,
                    fail_close_reason=failure_class,
                    input_projection_refs=agent_request.workflow_context.projection_refs,
                ),
            },
        ),
    )


def _runtime_posture_for_request(agent_request: AgentRequest) -> str:
    if len(agent_request.allowed_tools) != 1:
        return ""
    tool = default_tool_spec_registry().tool_by_name(agent_request.allowed_tools[0])
    if tool is None:
        return ""
    return tool.runtime_posture


def _run_structured_native_runtime(
    agent_request: AgentRequest,
    *,
    settings: ApiSettings,
    runtime: OpenAIAgentsNativeRuntime | None,
    execute_tool,
) -> AgentResponse:
    started_ns = start_agents_sdk_trace_timer()
    tool_execution_records: list[OpenAIAgentsToolExecutionRecord] = []
    if not settings.agents_sdk_runtime_enabled:
        return runtime_error_response(
            agent_request,
            "runtime_disabled",
            "OpenAI Agents native runtime is disabled",
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
        )
    if runtime is None:
        return runtime_error_response(
            agent_request,
            "runtime_unavailable",
            "OpenAI Agents native runtime is unavailable for an SDK-admitted structured tool",
            bridge_reason="runner_unavailable",
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            runtime_posture=_runtime_posture_for_request(agent_request),
        )
    try:
        descriptor = build_agents_sdk_tool_descriptors(agent_request.allowed_tools)[0]
        profile = instruction_profile_for_request(agent_request)

        def execute_and_record(invocation: OpenAIAgentsToolInvocation):
            raw_result = execute_tool(invocation)
            bounded_result = bounded_tool_result_projection(raw_result)
            tool_execution_records.append(
                OpenAIAgentsToolExecutionRecord(
                    name=invocation.name,
                    call_id=invocation.call_id,
                    arguments=dict(invocation.arguments),
                    argument_keys=tuple(sorted(invocation.arguments)),
                    result_projection=bounded_result,
                )
            )
            return raw_result

        result = runtime.run_agent(
            agent_request=agent_request,
            instruction_profile=profile,
            tool_descriptors=(descriptor,),
            execute_tool=execute_and_record,
        )
        return response_from_native_runtime_result(
            agent_request,
            result,
            descriptor=descriptor,
            tool_execution_records=tuple(tool_execution_records),
            require_tool_execution=True,
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            instruction_profile_id=profile.profile_id,
            result_usage_mode=profile.result_usage_mode,
            surface_execution_mode=profile.surface_execution_mode,
        )
    except AgentsSdkToolBridgeError as exc:
        return runtime_error_response(
            agent_request,
            "sdk_tool_not_admitted",
            str(exc),
            bridge_reason=exc.reason,
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            runtime_posture=_runtime_posture_for_request(agent_request),
        )
    except (OpenAIAgentsRuntimeError, OpenAIAgentsRuntimeProjectionError) as exc:
        return runtime_error_response(
            agent_request,
            exc.failure_class,
            exc.message,
            retryable=exc.retryable,
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            runtime_posture=_runtime_posture_for_request(agent_request),
            tool_execution_count=len(tool_execution_records),
        )
    except TimeoutError as exc:
        return runtime_error_response(
            agent_request,
            "sdk_timeout",
            str(exc) or "OpenAI Agents native runtime timed out",
            retryable=True,
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            runtime_posture=_runtime_posture_for_request(agent_request),
            tool_execution_count=len(tool_execution_records),
        )
    except Exception as exc:
        return runtime_error_response(
            agent_request,
            "sdk_runner_failed",
            f"OpenAI Agents native runtime failed: {exc}",
            retryable=True,
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            runtime_posture=_runtime_posture_for_request(agent_request),
            tool_execution_count=len(tool_execution_records),
        )


def _wrap_with_cancel_checks(agent_handler, cancel_flags: CancelFlagStore):
    def guarded_agent_handler(
        request,
        runtime_agent_request,
    ):
        if cancel_flags.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Execution was cancelled.")
        response = agent_handler(runtime_agent_request)
        if cancel_flags.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Execution was cancelled.")
        return response

    return guarded_agent_handler


def _build_campus_services_query_service(
    settings: ApiSettings,
) -> CampusServicesHTTPQueryService | None:
    if not settings.internal_query_base_url or not settings.internal_query_shared_secret:
        return None
    return CampusServicesHTTPQueryService(
        base_url=settings.internal_query_base_url,
        shared_secret=settings.internal_query_shared_secret,
        timeout_seconds=settings.structured_query_timeout_seconds,
    )


def _build_notice_query_service(
    settings: ApiSettings,
) -> NoticeHTTPQueryService | None:
    if not settings.internal_query_base_url or not settings.internal_query_shared_secret:
        return None
    return NoticeHTTPQueryService(
        base_url=settings.internal_query_base_url,
        shared_secret=settings.internal_query_shared_secret,
        timeout_seconds=settings.structured_query_timeout_seconds,
    )


def _build_openai_agents_runtime(settings: ApiSettings) -> OpenAIAgentsNativeRuntime | None:
    if not settings.agents_sdk_runtime_enabled:
        return None
    provider = settings.prompt_runtime_provider or settings.runtime_provider
    if not provider or not settings.prompt_runtime_api_key or not settings.agent_prompt_model:
        return None
    try:
        provider_config = PromptRuntimeProviderConfig(
            provider=provider,
            transport=settings.prompt_runtime_transport,  # type: ignore[arg-type]
            api_key=settings.prompt_runtime_api_key,
            base_url=settings.prompt_runtime_base_url,
            reasoning_effort=settings.prompt_runtime_reasoning_effort,
            max_output_tokens=settings.prompt_runtime_max_output_tokens,
            http_settings=PromptRuntimeHTTPSettings(
                connect_timeout_seconds=settings.prompt_runtime_connect_timeout_seconds,
                read_timeout_seconds=settings.prompt_runtime_read_timeout_seconds,
                write_timeout_seconds=settings.prompt_runtime_write_timeout_seconds,
                pool_timeout_seconds=settings.prompt_runtime_pool_timeout_seconds,
                max_connections=settings.prompt_runtime_max_connections,
                max_keepalive_connections=settings.prompt_runtime_max_keepalive_connections,
                keepalive_expiry_seconds=settings.prompt_runtime_keepalive_expiry_seconds,
            ),
        )
    except ValueError:
        return None
    return OpenAIAgentsNativeRuntime(
        provider_config=provider_config,
        model_name=settings.agent_prompt_model,
    )


def _build_rag_openai_runtime(settings: ApiSettings):
    if not settings.agents_sdk_runtime_enabled:
        return None
    provider = settings.prompt_runtime_provider or settings.runtime_provider
    model_name = _resolve_rag_agents_sdk_model_name(settings)
    if not provider or not settings.prompt_runtime_api_key or not model_name:
        return None
    try:
        provider_config = PromptRuntimeProviderConfig(
            provider=provider,
            transport=settings.prompt_runtime_transport,  # type: ignore[arg-type]
            api_key=settings.prompt_runtime_api_key,
            base_url=settings.prompt_runtime_base_url,
            reasoning_effort=settings.prompt_runtime_reasoning_effort,
            max_output_tokens=settings.prompt_runtime_max_output_tokens,
            http_settings=PromptRuntimeHTTPSettings(
                connect_timeout_seconds=settings.prompt_runtime_connect_timeout_seconds,
                read_timeout_seconds=settings.prompt_runtime_read_timeout_seconds,
                write_timeout_seconds=settings.prompt_runtime_write_timeout_seconds,
                pool_timeout_seconds=settings.prompt_runtime_pool_timeout_seconds,
                max_connections=settings.prompt_runtime_max_connections,
                max_keepalive_connections=settings.prompt_runtime_max_keepalive_connections,
                keepalive_expiry_seconds=settings.prompt_runtime_keepalive_expiry_seconds,
            ),
        )
    except ValueError:
        return None
    return OpenAIRagAgentsSdkRunner(
        provider_config=provider_config,
        model_name=model_name,
    )


def _resolve_rag_agents_sdk_model_name(settings: ApiSettings) -> str:
    return (settings.agent_prompt_model or settings.prompt_runtime_model).strip()
