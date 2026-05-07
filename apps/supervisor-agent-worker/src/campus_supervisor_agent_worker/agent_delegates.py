from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import asdict

import httpx
from campus_contracts import (
    AcademicCalendarLookupPayload,
    AgentRequest,
    CampusNoticeDiscoverPayload,
    ContactDirectoryLookupPayload,
    ServiceGuideLookupPayload,
    ServiceStatusLookupPayload,
    TransportScheduleLookupPayload,
)
from campus_navigation_agent import delegate_to_navigation_agent
from campus_notice_agent import NoticeHTTPQueryService, delegate_to_notice_agent
from campus_notice_agent.query_service import NoticeAccessContext, NoticeDiscoverQuery
from campus_rag_agent.service import delegate_to_rag_agent
from campus_retrieval_core import build_jsonl_retrieval_observation_sink
from campus_services_agent import (
    AcademicCalendarQuery,
    CampusServicesAccessContext,
    CampusServicesHTTPQueryService,
    ContactDirectoryQuery,
    ServiceGuideQuery,
    ServiceStatusQuery,
    TransportScheduleQuery,
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
        rag_sdk_runner=_build_rag_agents_sdk_runner(settings),
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
    rag_sdk_runner=None,
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
            rag_sdk_runner=rag_sdk_runner,
            rag_sdk_rollout_mode=("candidate" if rag_sdk_runner is not None else "closed"),
        ),
        "navigation-agent": delegate_to_navigation_agent,
        "campus-services-agent": delegate_to_campus_services_agent,
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
    if execution.name == "service_status_lookup":
        payload = ServiceStatusLookupPayload(**execution.arguments)
        result = query_service.lookup_service_status(
            ServiceStatusQuery(
                payload=payload,
                access_context=_campus_services_access_context(agent_request),
            )
        )
        return _bounded_sdk_tool_result(
            result,
            query_key="subject_query",
            query_value=result.subject_query,
        )
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
    if execution.name == "transport_schedule_lookup":
        payload = TransportScheduleLookupPayload(**execution.arguments)
        result = query_service.lookup_transport_schedule(
            TransportScheduleQuery(
                payload=payload,
                access_context=_campus_services_access_context(agent_request),
            )
        )
        return _bounded_sdk_tool_result(
            result,
            query_key="query_text",
            query_value=result.query_text,
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
    if execution.name == "academic_calendar_lookup":
        payload = AcademicCalendarLookupPayload(**execution.arguments)
        result = query_service.lookup_academic_calendar(
            AcademicCalendarQuery(
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
        "resolved_subject",
        "observed_status",
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
        "intent",
        "service_status",
        "requested_service_date",
    ):
        value = payload.get(key)
        if _has_scalar_sdk_value(value):
            bounded[key] = value
    for key in (
        "source_refs",
        "related_notice_refs",
        "override_source_refs",
    ):
        value = payload.get(key)
        if isinstance(value, tuple | list):
            normalized = [str(item).strip() for item in value if str(item).strip()]
            if normalized:
                bounded[key] = normalized

    if isinstance(payload.get("resolved_service"), Mapping):
        display_name = str(payload["resolved_service"].get("display_name") or "").strip()
        if display_name:
            bounded["resolved_service"] = {"display_name": display_name}
    if isinstance(payload.get("resolved_contact"), Mapping):
        display_name = str(payload["resolved_contact"].get("display_name") or "").strip()
        if display_name:
            bounded["resolved_contact"] = {"display_name": display_name}

    if query_key == "service_query":
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="guide_sections",
            fields=("section_id", "section_type", "title", "content", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="procedure_groups",
            fields=("group_id", "title", "source_refs"),
            nested_list_fields={
                "steps": ("content", "source_refs"),
            },
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="required_materials",
            fields=("name", "required", "note", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="entry_refs",
            fields=("label", "entry_type", "location_ref", "url", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="office_hours",
            fields=("label", "day_pattern", "time_range", "effective_note", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="contact_refs",
            fields=("label", "department", "phone", "email", "source_refs"),
        )
        eligibility_notes = payload.get("eligibility_notes")
        if isinstance(eligibility_notes, tuple | list):
            normalized_notes = [
                str(item).strip() for item in eligibility_notes if str(item).strip()
            ]
            if normalized_notes:
                bounded["eligibility_notes"] = normalized_notes[:6]
    if query_key == "query_text":
        contact_focus = str(payload.get("contact_focus") or "").strip()
        if contact_focus:
            bounded["contact_focus"] = contact_focus
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="contact_points",
            fields=("channel_type", "label", "value", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="location_refs",
            fields=("label", "location_ref", "address_text", "source_refs"),
        )
        _copy_nested_sdk_result_list(
            payload,
            bounded,
            key="office_hours",
            fields=("label", "day_pattern", "time_range", "effective_note", "source_refs"),
        )
    return bounded


def _copy_nested_sdk_result_list(
    payload: Mapping[str, object],
    bounded: dict[str, object],
    *,
    key: str,
    fields: tuple[str, ...],
    nested_list_fields: Mapping[str, tuple[str, ...]] | None = None,
) -> None:
    raw_value = payload.get(key)
    if not isinstance(raw_value, tuple | list):
        return
    items: list[dict[str, object]] = []
    for entry in raw_value[:8]:
        if not isinstance(entry, Mapping):
            continue
        item: dict[str, object] = {}
        for field_name in fields:
            value = entry.get(field_name)
            if value is None:
                continue
            if field_name == "source_refs" and isinstance(value, tuple | list):
                refs = [str(ref).strip() for ref in value if str(ref).strip()]
                if refs:
                    item[field_name] = refs
                continue
            if isinstance(value, str):
                normalized = value.strip()
                if normalized:
                    item[field_name] = normalized
                continue
            if isinstance(value, bool | int | float):
                item[field_name] = value
        if nested_list_fields:
            for nested_key, nested_fields in nested_list_fields.items():
                nested_value = entry.get(nested_key)
                if not isinstance(nested_value, tuple | list):
                    continue
                nested_items: list[dict[str, object]] = []
                for nested_entry in nested_value[:12]:
                    if not isinstance(nested_entry, Mapping):
                        continue
                    nested_item: dict[str, object] = {}
                    for nested_field in nested_fields:
                        nested_field_value = nested_entry.get(nested_field)
                        if nested_field_value is None:
                            continue
                        if nested_field == "source_refs" and isinstance(
                            nested_field_value, tuple | list
                        ):
                            refs = [
                                str(ref).strip() for ref in nested_field_value if str(ref).strip()
                            ]
                            if refs:
                                nested_item[nested_field] = refs
                            continue
                        if isinstance(nested_field_value, str):
                            normalized = nested_field_value.strip()
                            if normalized:
                                nested_item[nested_field] = normalized
                            continue
                        if isinstance(nested_field_value, bool | int | float):
                            nested_item[nested_field] = nested_field_value
                    if nested_item:
                        nested_items.append(nested_item)
                if nested_items:
                    item[nested_key] = nested_items
        if item:
            items.append(item)
    if items:
        bounded[key] = items


def _has_scalar_sdk_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, tuple | list):
        return len(value) > 0
    if isinstance(value, Mapping):
        return len(value) > 0
    return True


def _source_ref_count_from_payload(payload: object) -> int:
    refs: set[str] = set()

    def collect(value: object) -> None:
        if isinstance(value, str):
            return
        if isinstance(value, Mapping):
            for key, item in value.items():
                normalized_key = str(key)
                if normalized_key == "source_ref" and isinstance(item, str) and item.strip():
                    refs.add(item.strip())
                    continue
                if normalized_key.endswith(("source_refs", "notice_refs")) and isinstance(
                    item, tuple | list
                ):
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
    if provider == "mock-runtime":
        if not settings.agent_prompt_model:
            return None
        from campus_supervisor_agent_worker.agents_sdk_mock_runner import MockAgentsSdkRunner

        return MockAgentsSdkRunner()
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


def _build_rag_agents_sdk_runner(settings: ApiSettings):
    if not settings.agents_sdk_runtime_enabled:
        return None
    provider = settings.prompt_runtime_provider or settings.runtime_provider
    model_name = _resolve_rag_agents_sdk_model_name(settings)
    if provider == "mock-runtime":
        if not model_name:
            return None
        from campus_supervisor_agent_worker.rag_agents_sdk_mock_runner import (
            MockRagAgentsSdkRunner,
        )

        return MockRagAgentsSdkRunner()
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
    try:
        from campus_supervisor_agent_worker.rag_agents_sdk_openai_runner import (
            OpenAIRagAgentsSdkRunner,
        )
    except ImportError:
        return None
    return OpenAIRagAgentsSdkRunner(
        provider_config=provider_config,
        model_name=model_name,
    )


def _resolve_rag_agents_sdk_model_name(settings: ApiSettings) -> str:
    return (settings.agent_prompt_model or settings.prompt_runtime_model).strip()
