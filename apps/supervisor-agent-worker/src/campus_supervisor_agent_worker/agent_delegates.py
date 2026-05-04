from __future__ import annotations

from collections.abc import Callable, Mapping

import httpx
from campus_contracts import AgentRequest
from campus_contracts import CampusNoticeDiscoverPayload
from campus_navigation_agent import delegate_to_navigation_agent
from campus_notice_agent import NoticeHTTPQueryService, delegate_to_notice_agent
from campus_notice_agent.query_service import NoticeAccessContext, NoticeDiscoverQuery
from campus_rag_agent.service import delegate_to_rag_agent
from campus_retrieval_core import build_jsonl_retrieval_observation_sink
from campus_services_agent import CampusServicesHTTPQueryService, delegate_to_campus_services_agent
from campus_shared import PromptRuntimeHTTPSettings, PromptRuntimeProviderConfig

from campus_supervisor_agent_worker.agent_dispatch import (
    AgentDelegate,
    ExecutionCancelledError,
    dispatch_agent_request,
)
from campus_supervisor_agent_worker.agents_sdk_runner import (
    AgentsSdkRunner,
    AgentsSdkToolExecutionRequest,
    run_agents_sdk_runner_shell,
)
from campus_supervisor_agent_worker.cancel_flags import CancelFlagStore
from campus_supervisor_agent_worker.prompt_executor import ProviderBackedRagPromptExecutor
from campus_supervisor_agent_worker.retrieval_observation_bridge import (
    build_retrieval_runtime_event_sink,
    build_runtime_event_jsonl_emitter,
    compose_retrieval_observation_sinks,
)
from campus_supervisor_agent_worker.settings import ApiSettings

ProviderFunctionToolProvider = Callable[[object], Mapping[str, object]]


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
        provider_tool_provider=_build_provider_tool_provider(
            settings,
            http_client=prompt_http_client,
        ),
        agents_sdk_runner=_build_agents_sdk_runner(settings),
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
    provider_tool_provider: ProviderFunctionToolProvider | None = None,
    agents_sdk_runner: AgentsSdkRunner | None = None,
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
        ),
        "navigation-agent": delegate_to_navigation_agent,
        "campus-services-agent": delegate_to_campus_services_agent,
        "notice-agent": delegate_to_notice_agent,
    }
    if campus_services_query_service is not None:
        agent_delegates["campus-services-agent"] = lambda agent_request: (
            delegate_to_campus_services_agent(
                agent_request,
                query_service=campus_services_query_service,
            )
        )
    if notice_query_service is not None:
        agent_delegates["notice-agent"] = lambda agent_request: _delegate_to_notice_agent(
            agent_request,
            settings=settings,
            query_service=notice_query_service,
            provider_tool_provider=provider_tool_provider,
            agents_sdk_runner=agents_sdk_runner,
        )
    return agent_delegates


def _delegate_to_notice_agent(
    agent_request: AgentRequest,
    *,
    settings: ApiSettings,
    query_service: NoticeHTTPQueryService,
    provider_tool_provider: ProviderFunctionToolProvider | None,
    agents_sdk_runner: AgentsSdkRunner | None,
):
    _ = provider_tool_provider
    if _should_route_notice_discover_to_agents_sdk(
        agent_request,
        settings=settings,
        agents_sdk_runner=agents_sdk_runner,
    ):
        return run_agents_sdk_runner_shell(
            agent_request,
            runner=agents_sdk_runner,
            enabled=True,
            execute_tool=lambda execution: _execute_notice_discover_tool(
                execution,
                agent_request=agent_request,
                query_service=query_service,
            ),
            require_tool_execution=True,
        )
    return delegate_to_notice_agent(
        agent_request,
        query_service=query_service,
    )


def _should_route_notice_discover_to_agents_sdk(
    agent_request: AgentRequest,
    *,
    settings: ApiSettings,
    agents_sdk_runner: AgentsSdkRunner | None,
) -> bool:
    return (
        settings.agents_sdk_runtime_enabled
        and agents_sdk_runner is not None
        and agent_request.target in settings.agents_sdk_runtime_allowed_targets
        and isinstance(agent_request.payload, CampusNoticeDiscoverPayload)
        and agent_request.allowed_tools == ("campus_notice_discover",)
        and settings.agents_sdk_runtime_allowed_tools == ("campus_notice_discover",)
    )


def _execute_notice_discover_tool(
    execution: AgentsSdkToolExecutionRequest,
    *,
    agent_request: AgentRequest,
    query_service: NoticeHTTPQueryService,
) -> dict[str, object]:
    if execution.name != "campus_notice_discover":
        raise ValueError(f"notice-agent cannot execute SDK tool: {execution.name}")
    payload = CampusNoticeDiscoverPayload(**execution.arguments)
    result = query_service.discover_notice(
        NoticeDiscoverQuery(
            payload=payload,
            access_context=NoticeAccessContext(
                actor=agent_request.actor,
                authorization=agent_request.context.authorization,
            ),
        )
    )
    cards = tuple(result.notice_cards)
    return {
        "status": "completed",
        "outcome": result.outcome,
        "query_text": result.query_text,
        "notice_card_count": len(cards),
        "titles": [card.title for card in cards],
        "source_urls": [card.source_url for card in cards],
        "source_ref_count": len({card.source_url for card in cards if card.source_url.strip()}),
    }


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
    if not settings.structured_query_base_url or not settings.structured_query_shared_secret:
        return None
    return CampusServicesHTTPQueryService(
        base_url=settings.structured_query_base_url,
        shared_secret=settings.structured_query_shared_secret,
        timeout_seconds=settings.structured_query_timeout_seconds,
    )


def _build_notice_query_service(
    settings: ApiSettings,
) -> NoticeHTTPQueryService | None:
    if not settings.structured_query_base_url or not settings.structured_query_shared_secret:
        return None
    return NoticeHTTPQueryService(
        base_url=settings.structured_query_base_url,
        shared_secret=settings.structured_query_shared_secret,
        timeout_seconds=settings.structured_query_timeout_seconds,
    )


def _build_provider_tool_provider(
    settings: ApiSettings,
    *,
    http_client: httpx.Client | None,
) -> ProviderFunctionToolProvider | None:
    if not settings.provider_tool_runtime_enabled:
        return None
    if not settings.provider_tool_runtime_allowed_tools:
        return None
    provider = settings.prompt_runtime_provider or settings.runtime_provider
    if (
        not provider
        or not settings.prompt_runtime_api_key
        or not settings.agent_prompt_model
        or not settings.structured_query_base_url
        or not settings.structured_query_shared_secret
    ):
        return None
    http_settings = PromptRuntimeHTTPSettings(
        connect_timeout_seconds=settings.prompt_runtime_connect_timeout_seconds,
        read_timeout_seconds=settings.prompt_runtime_read_timeout_seconds,
        write_timeout_seconds=settings.prompt_runtime_write_timeout_seconds,
        pool_timeout_seconds=settings.prompt_runtime_pool_timeout_seconds,
        max_connections=settings.prompt_runtime_max_connections,
        max_keepalive_connections=settings.prompt_runtime_max_keepalive_connections,
        keepalive_expiry_seconds=settings.prompt_runtime_keepalive_expiry_seconds,
    )
    try:
        from campus_supervisor_agent_worker.provider_function_calling import (
            ResponsesFunctionToolProvider,
        )

        provider_config = PromptRuntimeProviderConfig(
            provider=provider,
            transport=settings.prompt_runtime_transport,  # type: ignore[arg-type]
            api_key=settings.prompt_runtime_api_key,
            base_url=settings.prompt_runtime_base_url,
            reasoning_effort=settings.prompt_runtime_reasoning_effort,
            max_output_tokens=settings.prompt_runtime_max_output_tokens,
            http_settings=http_settings,
        )
    except ValueError:
        return None
    return ResponsesFunctionToolProvider(
        provider_config=provider_config,
        model_name=settings.agent_prompt_model,
        http_client=http_client,
    )


def _build_agents_sdk_runner(settings: ApiSettings) -> AgentsSdkRunner | None:
    if not settings.agents_sdk_runtime_enabled:
        return None
    if settings.agents_sdk_runtime_allowed_targets != ("notice-agent",):
        return None
    if settings.agents_sdk_runtime_allowed_tools != ("campus_notice_discover",):
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
    try:
        from campus_supervisor_agent_worker.agents_sdk_openai_runner import OpenAIAgentsSdkRunner
    except ImportError:
        return None
    return OpenAIAgentsSdkRunner(
        provider_config=provider_config,
        model_name=settings.agent_prompt_model,
    )
