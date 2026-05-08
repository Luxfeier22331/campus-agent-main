from __future__ import annotations

import httpx
from campus_navigation_agent import delegate_to_navigation_agent
from campus_notice_agent import NoticeHTTPQueryService
from campus_rag_agent.rag_sdk_output import RagSdkAnswerOutput
from campus_rag_agent.rag_sdk_trace import build_rag_sdk_trace_projection
from campus_rag_agent.service import delegate_to_rag_agent
from campus_retrieval_core import build_jsonl_retrieval_observation_sink
from campus_services_agent import (
    CampusServicesHTTPQueryService,
)
from campus_shared import PromptRuntimeHTTPSettings, PromptRuntimeProviderConfig

from campus_supervisor_agent_worker.admitted_agent_execution import AdmittedAgentExecutor
from campus_supervisor_agent_worker.agent_dispatch import (
    AgentDelegate,
    ExecutionCancelledError,
    dispatch_agent_request,
)
from campus_supervisor_agent_worker.cancel_flags import CancelFlagStore
from campus_supervisor_agent_worker.openai_agents_runtime import OpenAIAgentsNativeRuntime
from campus_supervisor_agent_worker.prompt_executor import ProviderBackedRagPromptExecutor
from campus_supervisor_agent_worker.rag_agents_sdk_openai_runner import (
    OpenAIRagAgentsSdkRunner,
)
from campus_supervisor_agent_worker.retrieval_observation_bridge import (
    build_retrieval_runtime_event_sink,
    build_runtime_event_jsonl_emitter,
    build_runtime_event_otlp_emitter,
    compose_retrieval_observation_sinks,
)
from campus_supervisor_agent_worker.settings import ApiSettings
from campus_supervisor_agent_worker.tool_execution import (
    ToolExecutionSession,
    build_default_tool_execution_session,
)


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
    tool_execution_session = build_default_tool_execution_session(
        campus_services_query_service=campus_services_query_service,
        notice_query_service=notice_query_service,
    )
    agent_delegates = _build_agent_delegates(
        settings=settings,
        rag_prompt_executor=rag_prompt_executor,
        campus_services_query_service=campus_services_query_service,
        notice_query_service=notice_query_service,
        openai_agents_runtime=_build_openai_agents_runtime(settings),
        rag_openai_runtime=_build_rag_openai_runtime(
            settings,
            tool_execution_session=tool_execution_session,
        ),
        tool_execution_session=tool_execution_session,
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
    tool_execution_session: ToolExecutionSession | None = None,
) -> dict[str, AgentDelegate]:
    execution_session = tool_execution_session or build_default_tool_execution_session(
        campus_services_query_service=campus_services_query_service,
        notice_query_service=notice_query_service,
    )
    tool_registry = execution_session.tool_registry
    admitted_agent_executor = AdmittedAgentExecutor(
        settings=settings,
        runtime=openai_agents_runtime,
        tool_execution_session=execution_session,
        tool_registry=tool_registry,
    )
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
    retrieval_runtime_otlp_sink = (
        build_retrieval_runtime_event_sink(
            build_runtime_event_otlp_emitter(
                enabled=settings.otel_enabled,
                service_name=settings.otel_service_name,
                allowed_attributes_version=settings.otel_allowed_attributes_version,
                traces_endpoint=settings.otel_exporter_otlp_traces_endpoint,
                metrics_endpoint=settings.otel_exporter_otlp_metrics_endpoint,
                logs_endpoint=settings.otel_exporter_otlp_logs_endpoint,
                export_timeout_seconds=settings.otel_export_timeout_seconds,
                export_interval_seconds=settings.otel_export_interval_seconds,
                headers=settings.otel_exporter_otlp_headers,
            )
        )
        if settings.otel_enabled
        else None
    )
    retrieval_observation_sink = compose_retrieval_observation_sinks(
        retrieval_jsonl_observation_sink,
        retrieval_runtime_event_sink,
        retrieval_runtime_otlp_sink,
    )
    effective_rag_runtime = rag_openai_runtime or _build_unavailable_rag_sdk_runner()
    agent_delegates: dict[str, AgentDelegate] = {
        "rag-agent": lambda agent_request: delegate_to_rag_agent(
            agent_request,
            prompt_executor=rag_prompt_executor,
            retrieval_observation_sink=retrieval_observation_sink,
            include_retrieval_observation_query_text=(
                settings.retrieval_observation_include_query_text
            ),
            rag_sdk_runner=effective_rag_runtime,
        ),
        "navigation-agent": delegate_to_navigation_agent,
        "campus-services-agent": admitted_agent_executor.execute,
        "notice-agent": admitted_agent_executor.execute,
    }
    return agent_delegates


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


def _build_rag_openai_runtime(
    settings: ApiSettings,
    *,
    tool_execution_session: ToolExecutionSession | None = None,
):
    if not settings.agents_sdk_runtime_enabled:
        return _build_unavailable_rag_sdk_runner(detail="agents_sdk_runtime_disabled")
    provider = settings.prompt_runtime_provider or settings.runtime_provider
    model_name = _resolve_rag_agents_sdk_model_name(settings)
    if not provider or not settings.prompt_runtime_api_key or not model_name:
        return _build_unavailable_rag_sdk_runner()
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
        return _build_unavailable_rag_sdk_runner(detail="invalid_prompt_runtime_provider_config")
    return OpenAIRagAgentsSdkRunner(
        provider_config=provider_config,
        model_name=model_name,
        tool_execution_session=tool_execution_session,
    )


def _resolve_rag_agents_sdk_model_name(settings: ApiSettings) -> str:
    return (settings.agent_prompt_model or settings.prompt_runtime_model).strip()


def _build_unavailable_rag_sdk_runner(*, detail: str = "RAG SDK runner is unavailable"):
    from campus_rag_agent.rag_sdk_models import RagSdkRunResult

    def runner(_request):
        return RagSdkRunResult(
            output=RagSdkAnswerOutput(
                answer_text="",
                answer_kind="unsupported",
                semantic_outcome="unsupported_by_evidence",
                confidence="low",
                unsupported_reason="rag_sdk_runtime_unavailable",
            ),
            trace_projection=build_rag_sdk_trace_projection(
                runtime="openai_agents_sdk",
                tool_names=(),
                failure_class="rag_sdk_runtime_unavailable",
            ),
            failure_class="rag_sdk_runtime_unavailable",
            failure_detail=detail,
        )

    return runner
