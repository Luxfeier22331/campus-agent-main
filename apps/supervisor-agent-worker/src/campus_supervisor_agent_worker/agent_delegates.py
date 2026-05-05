from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import asdict

import httpx
from campus_calendar_agent import (
    AcademicCalendarQuery,
    CalendarAccessContext,
    CalendarHTTPQueryService,
    delegate_to_calendar_agent,
)
from campus_contracts import (
    AcademicCalendarLookupPayload,
    AgentRequest,
    CampusNoticeDiscoverPayload,
    ContactDirectoryLookupPayload,
    ServiceGuideLookupPayload,
)
from campus_navigation_agent import delegate_to_navigation_agent
from campus_notice_agent import NoticeHTTPQueryService, delegate_to_notice_agent
from campus_notice_agent.query_service import NoticeAccessContext, NoticeDiscoverQuery
from campus_rag_agent.service import delegate_to_rag_agent
from campus_retrieval_core import build_jsonl_retrieval_observation_sink
from campus_services_agent import (
    CampusServicesAccessContext,
    CampusServicesHTTPQueryService,
    ContactDirectoryQuery,
    ServiceGuideQuery,
    delegate_to_campus_services_agent,
)
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
from campus_supervisor_agent_worker.tool_spec_registry import default_tool_spec_registry

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
    calendar_query_service = _build_calendar_query_service(settings)
    notice_query_service = _build_notice_query_service(settings)
    agent_delegates = _build_agent_delegates(
        settings=settings,
        rag_prompt_executor=rag_prompt_executor,
        campus_services_query_service=campus_services_query_service,
        calendar_query_service=calendar_query_service,
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
    calendar_query_service: CalendarHTTPQueryService | None = None,
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
        "calendar-agent": delegate_to_calendar_agent,
        "notice-agent": delegate_to_notice_agent,
    }
    if campus_services_query_service is not None:
        agent_delegates["campus-services-agent"] = lambda agent_request: (
            _delegate_to_campus_services_agent(
                agent_request,
                settings=settings,
                query_service=campus_services_query_service,
                agents_sdk_runner=agents_sdk_runner,
            )
        )
    if calendar_query_service is not None:
        agent_delegates["calendar-agent"] = lambda agent_request: _delegate_to_calendar_agent(
            agent_request,
            settings=settings,
            query_service=calendar_query_service,
            agents_sdk_runner=agents_sdk_runner,
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
    if _should_route_to_agents_sdk(
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


def _delegate_to_campus_services_agent(
    agent_request: AgentRequest,
    *,
    settings: ApiSettings,
    query_service: CampusServicesHTTPQueryService,
    agents_sdk_runner: AgentsSdkRunner | None,
):
    if _should_route_to_agents_sdk(
        agent_request,
        settings=settings,
        agents_sdk_runner=agents_sdk_runner,
    ):
        return run_agents_sdk_runner_shell(
            agent_request,
            runner=agents_sdk_runner,
            enabled=True,
            execute_tool=lambda execution: _execute_campus_services_tool(
                execution,
                agent_request=agent_request,
                query_service=query_service,
            ),
            require_tool_execution=True,
        )
    return delegate_to_campus_services_agent(
        agent_request,
        query_service=query_service,
    )


def _delegate_to_calendar_agent(
    agent_request: AgentRequest,
    *,
    settings: ApiSettings,
    query_service: CalendarHTTPQueryService,
    agents_sdk_runner: AgentsSdkRunner | None,
):
    if _should_route_to_agents_sdk(
        agent_request,
        settings=settings,
        agents_sdk_runner=agents_sdk_runner,
    ):
        return run_agents_sdk_runner_shell(
            agent_request,
            runner=agents_sdk_runner,
            enabled=True,
            execute_tool=lambda execution: _execute_calendar_tool(
                execution,
                agent_request=agent_request,
                query_service=query_service,
            ),
            require_tool_execution=True,
        )
    return delegate_to_calendar_agent(
        agent_request,
        query_service=query_service,
    )


def _should_route_to_agents_sdk(
    agent_request: AgentRequest,
    *,
    settings: ApiSettings,
    agents_sdk_runner: AgentsSdkRunner | None,
) -> bool:
    if not settings.agents_sdk_runtime_enabled or agents_sdk_runner is None:
        return False
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


def _execute_campus_services_tool(
    execution: AgentsSdkToolExecutionRequest,
    *,
    agent_request: AgentRequest,
    query_service: CampusServicesHTTPQueryService,
) -> dict[str, object]:
    if execution.name == "service_guide_lookup":
        payload = ServiceGuideLookupPayload(**execution.arguments)
        result = query_service.lookup_service_guide(
            ServiceGuideQuery(
                payload=payload,
                access_context=_campus_services_access_context(agent_request),
            )
        )
        return _bounded_sdk_tool_result(
            result,
            query_key="service_query",
            query_value=result.service_query,
        )
    if execution.name == "contact_directory_lookup":
        payload = ContactDirectoryLookupPayload(**execution.arguments)
        result = query_service.lookup_contact_directory(
            ContactDirectoryQuery(
                payload=payload,
                access_context=_campus_services_access_context(agent_request),
            )
        )
        return _bounded_sdk_tool_result(
            result,
            query_key="query_text",
            query_value=result.query_text,
        )
    raise ValueError(f"campus-services-agent cannot execute SDK tool: {execution.name}")


def _execute_calendar_tool(
    execution: AgentsSdkToolExecutionRequest,
    *,
    agent_request: AgentRequest,
    query_service: CalendarHTTPQueryService,
) -> dict[str, object]:
    if execution.name != "academic_calendar_lookup":
        raise ValueError(f"calendar-agent cannot execute SDK tool: {execution.name}")
    payload = AcademicCalendarLookupPayload(**execution.arguments)
    result = query_service.lookup_academic_calendar(
        AcademicCalendarQuery(
            payload=payload,
            access_context=CalendarAccessContext(
                actor=agent_request.actor,
                authorization=agent_request.context.authorization,
            ),
        )
    )
    return _bounded_sdk_tool_result(
        result,
        query_key="query_text",
        query_value=result.query_text,
    )


def _campus_services_access_context(agent_request: AgentRequest) -> CampusServicesAccessContext:
    return CampusServicesAccessContext(
        actor=agent_request.actor,
        authorization=agent_request.context.authorization,
    )


def _bounded_sdk_tool_result(
    result: object,
    *,
    query_key: str,
    query_value: str,
) -> dict[str, object]:
    payload = asdict(result)
    bounded: dict[str, object] = {
        "status": "completed",
        "outcome": str(payload.get("outcome") or ""),
        query_key: query_value,
        "source_ref_count": _source_ref_count_from_payload(payload),
    }
    for key in (
        "guide_focus",
        "contact_focus",
        "resolved_date",
        "academic_year_label",
        "term_label",
        "week_index",
        "day_kind",
        "class_day_pattern",
        "is_makeup_class",
        "holiday_name",
        "queried_time_anchor",
        "effective_from",
        "effective_until",
    ):
        value = payload.get(key)
        if value not in {None, "", ()}:
            bounded[key] = value
    return bounded


def _source_ref_count_from_payload(payload: object) -> int:
    refs: set[str] = set()

    def collect(value: object) -> None:
        if isinstance(value, str):
            return
        if isinstance(value, Mapping):
            for key, item in value.items():
                if str(key).endswith("source_refs") and isinstance(item, tuple | list):
                    refs.update(str(ref).strip() for ref in item if str(ref).strip())
                    continue
                collect(item)
            return
        if isinstance(value, tuple | list):
            for item in value:
                collect(item)

    collect(payload)
    return len(refs)


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


def _build_calendar_query_service(
    settings: ApiSettings,
) -> CalendarHTTPQueryService | None:
    if not settings.internal_query_base_url or not settings.internal_query_shared_secret:
        return None
    return CalendarHTTPQueryService(
        base_url=settings.internal_query_base_url,
        shared_secret=settings.internal_query_shared_secret,
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
        or not settings.internal_query_base_url
        or not settings.internal_query_shared_secret
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
