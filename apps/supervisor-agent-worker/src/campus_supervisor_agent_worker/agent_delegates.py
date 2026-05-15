from __future__ import annotations

import httpx
from campus_navigation_agent import delegate_to_navigation_agent
from campus_notice_agent import NoticeHTTPQueryService
from campus_rag_agent.service import delegate_to_rag_agent
from campus_retrieval_core import build_jsonl_retrieval_observation_sink
from campus_services_agent import (
    CampusServicesHTTPQueryService,
)
from campus_shared import PromptRuntimeHTTPSettings, PromptRuntimeProviderConfig

from campus_supervisor_agent_worker.admitted_agent_execution import AdmittedAgentExecutor
from campus_supervisor_agent_worker.agent_dispatch import (
    AdmissionAwareAgentDelegate,
    AgentDelegate,
    ExecutionCancelledError,
    dispatch_agent_request,
)
from campus_supervisor_agent_worker.cancel_flags import CancelFlagStore
from campus_supervisor_agent_worker.openai_agents_rag_runtime import (
    OpenAIAgentsRagRuntime,
)
from campus_supervisor_agent_worker.openai_agents_runtime import OpenAIAgentsNativeRuntime
from campus_supervisor_agent_worker.prompt_executor import ProviderBackedRagPromptExecutor
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


class AgentRuntimeBuildError(ValueError):
    pass


class QueryServiceRuntimeError(ValueError):
    pass


def _require_structured_query_runtime(
    settings: ApiSettings,
    *,
    runtime_name: str,
) -> None:
    if not settings.internal_query_base_url:
        raise QueryServiceRuntimeError(f"{runtime_name} misconfigured: query_base_url_not_configured")
    if not settings.internal_query_shared_secret:
        raise QueryServiceRuntimeError(
            f"{runtime_name} misconfigured: query_shared_secret_not_configured"
        )


def _runtime_config_error(runtime_name: str, reason: str) -> AgentRuntimeBuildError:
    return AgentRuntimeBuildError(f"{runtime_name} misconfigured: {reason}")


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
    agent_delegates: dict[str, AgentDelegate | AdmissionAwareAgentDelegate] = {
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
        "campus-services-agent": AdmissionAwareAgentDelegate(
            handler=admitted_agent_executor.execute
        ),
        "notice-agent": AdmissionAwareAgentDelegate(handler=admitted_agent_executor.execute),
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
    _require_structured_query_runtime(settings, runtime_name="campus_services_query_service")
    return CampusServicesHTTPQueryService(
        base_url=settings.internal_query_base_url,
        shared_secret=settings.internal_query_shared_secret,
        timeout_seconds=settings.structured_query_timeout_seconds,
    )


def _build_notice_query_service(
    settings: ApiSettings,
) -> NoticeHTTPQueryService | None:
    _require_structured_query_runtime(settings, runtime_name="notice_query_service")
    return NoticeHTTPQueryService(
        base_url=settings.internal_query_base_url,
        shared_secret=settings.internal_query_shared_secret,
        timeout_seconds=settings.structured_query_timeout_seconds,
    )


def _build_openai_agents_runtime(settings: ApiSettings) -> OpenAIAgentsNativeRuntime | None:
    if not settings.agents_sdk_runtime_enabled:
        return None
    provider = settings.prompt_runtime_provider
    if not provider:
        raise _runtime_config_error("openai_agents_runtime", "provider_not_configured")
    if not settings.prompt_runtime_api_key:
        raise _runtime_config_error("openai_agents_runtime", "api_key_not_configured")
    if not settings.agent_prompt_model:
        raise _runtime_config_error("openai_agents_runtime", "agent_model_not_configured")
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
    except ValueError as exc:
        raise _runtime_config_error("openai_agents_runtime", str(exc)) from exc
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
        return None
    provider = settings.prompt_runtime_provider
    model_name = _resolve_rag_agents_sdk_model_name(settings)
    if not provider:
        raise _runtime_config_error("rag_openai_runtime", "provider_not_configured")
    if not settings.prompt_runtime_api_key:
        raise _runtime_config_error("rag_openai_runtime", "api_key_not_configured")
    if not model_name:
        raise _runtime_config_error("rag_openai_runtime", "model_not_configured")
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
    except ValueError as exc:
        raise _runtime_config_error("rag_openai_runtime", str(exc)) from exc
    return OpenAIAgentsRagRuntime(
        provider_config=provider_config,
        model_name=model_name,
        tool_execution_session=tool_execution_session,
    )


def _resolve_rag_agents_sdk_model_name(settings: ApiSettings) -> str:
    return (settings.agent_prompt_model or settings.prompt_runtime_model).strip()
