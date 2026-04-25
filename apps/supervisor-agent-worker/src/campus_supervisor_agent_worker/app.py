from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace

import httpx
from campus_navigation_agent import delegate_to_navigation_agent
from campus_notice_agent import NoticeHTTPQueryService, delegate_to_notice_agent
from campus_rag_agent.service import delegate_to_rag_agent
from campus_services_agent import CampusServicesHTTPQueryService, delegate_to_campus_services_agent
from campus_shared import (
    PromptRuntimeHTTPSettings,
    PromptRuntimeProviderConfig,
    build_prompt_runtime_http_client,
)

from campus_supervisor_agent_worker.agent_dispatch import (
    AgentDelegate,
    ExecutionCancelledError,
    dispatch_agent_request,
)
from campus_supervisor_agent_worker.api import (
    CancelFlagStore,
    HttpResponse,
    HttpRoute,
    build_bridge_routes,
)
from campus_supervisor_agent_worker.prompt_executor import (
    ProviderBackedRagPromptExecutor,
)
from campus_supervisor_agent_worker.prompt_stack import PromptRuntimeSettings
from campus_supervisor_agent_worker.settings import ApiSettings


@dataclass(frozen=True, slots=True)
class AgentWorkerRuntime:
    provider: str = ""
    supervisor_model: str = ""
    agent_model: str = ""
    prompt_runtime: PromptRuntimeSettings = field(default_factory=PromptRuntimeSettings)


@dataclass(slots=True)
class PromptHTTPPoolRuntime:
    settings: PromptRuntimeHTTPSettings
    base_url: str
    client: httpx.Client | None = None

    def status(self, *, admitted: bool) -> dict[str, object]:
        configured = admitted and self.client is not None
        return {
            "healthy": configured,
            "configured": configured,
            "base_url": self.base_url,
            "max_connections": self.settings.max_connections,
            "max_keepalive_connections": self.settings.max_keepalive_connections,
            "keepalive_expiry_seconds": self.settings.keepalive_expiry_seconds,
        }

    def close(self) -> None:
        if self.client is not None:
            self.client.close()


@dataclass(slots=True)
class SupervisorAgentWorkerApp:
    name: str
    runtime: AgentWorkerRuntime
    routes: tuple[HttpRoute, ...]
    prompt_http_pool: PromptHTTPPoolRuntime
    cancel_flags: CancelFlagStore

    def handle(
        self,
        method: str,
        path: str,
        *,
        headers: Mapping[str, str] | None = None,
        json_body: dict[str, object] | None = None,
    ) -> HttpResponse:
        normalized_headers = {key.lower(): value for key, value in (headers or {}).items()}
        for route in self.routes:
            if route.method == method.upper() and route.path == path:
                return route.handler(normalized_headers, json_body)
        return HttpResponse(
            status_code=404,
            json_body={"error": {"code": "not_found", "message": "Route not found."}},
        )

    def runtime_status(self) -> dict[str, dict[str, object]]:
        return {
            "prompt_http_pool": self.prompt_http_pool.status(
                admitted=self.runtime.prompt_runtime.admitted
            ),
            "worker_runtime": {"role": "semantic_worker", "cancel_flag_store": "available"},
        }

    def close(self) -> None:
        self.prompt_http_pool.close()


def create_bridge_app(
    *,
    settings: ApiSettings | None = None,
    agent_handler=dispatch_agent_request,
) -> SupervisorAgentWorkerApp:
    return _create_runtime_app(
        settings=settings,
        agent_handler=agent_handler,
    )


def _create_runtime_app(
    *,
    settings: ApiSettings | None = None,
    agent_handler=dispatch_agent_request,
) -> SupervisorAgentWorkerApp:
    runtime_settings = settings or ApiSettings.from_env()
    (
        prompt_runtime,
        prompt_http_pool,
        rag_prompt_executor,
    ) = _build_prompt_runtime_assets(runtime_settings)
    cancel_flags = CancelFlagStore()
    bound_agent_handler = _bind_agent_handler(
        runtime_settings,
        agent_handler=agent_handler,
        rag_prompt_executor=rag_prompt_executor,
        cancel_flags=cancel_flags,
    )
    routes = build_bridge_routes(
        runtime_settings,
        agent_handler=bound_agent_handler,
        prompt_runtime=prompt_runtime,
        runtime_status_provider=lambda: {
            "prompt_http_pool": prompt_http_pool.status(admitted=prompt_runtime.admitted),
            "worker_runtime": {"role": "semantic_worker", "cancel_flag_store": "available"},
        },
        cancel_flags=cancel_flags,
    )
    return SupervisorAgentWorkerApp(
        name=runtime_settings.app_name,
        runtime=AgentWorkerRuntime(
            provider=runtime_settings.runtime_provider,
            supervisor_model=runtime_settings.supervisor_prompt_model,
            agent_model=runtime_settings.agent_prompt_model,
            prompt_runtime=prompt_runtime,
        ),
        routes=routes,
        prompt_http_pool=prompt_http_pool,
        cancel_flags=cancel_flags,
    )


def _bind_agent_handler(
    settings: ApiSettings,
    *,
    agent_handler,
    rag_prompt_executor: ProviderBackedRagPromptExecutor | None,
    cancel_flags: CancelFlagStore,
):
    if agent_handler is not dispatch_agent_request:
        return _wrap_with_cancel_checks(agent_handler, cancel_flags)
    campus_services_query_service = _build_campus_services_query_service(settings)
    notice_query_service = _build_notice_query_service(settings)
    agent_delegates = _build_agent_delegates(
        rag_prompt_executor=rag_prompt_executor,
        campus_services_query_service=campus_services_query_service,
        notice_query_service=notice_query_service,
    )

    return lambda request, preplanned_agent_request: dispatch_agent_request(
        preplanned_agent_request,
        agent_delegates=agent_delegates,
        cancellation_checker=lambda: cancel_flags.is_cancel_requested(request.request_id),
    )


def _build_agent_delegates(
    *,
    rag_prompt_executor: ProviderBackedRagPromptExecutor | None,
    campus_services_query_service: CampusServicesHTTPQueryService | None,
    notice_query_service: NoticeHTTPQueryService | None,
) -> dict[str, AgentDelegate]:
    agent_delegates: dict[str, AgentDelegate] = {
        "rag-agent": lambda agent_request: delegate_to_rag_agent(
            agent_request,
            prompt_executor=rag_prompt_executor,
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
        agent_delegates["notice-agent"] = lambda agent_request: delegate_to_notice_agent(
            agent_request,
            query_service=notice_query_service,
        )
    return agent_delegates


def _wrap_with_cancel_checks(agent_handler, cancel_flags: CancelFlagStore):
    def guarded_agent_handler(
        request,
        preplanned_agent_request,
    ):
        if cancel_flags.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Execution was cancelled.")
        response = agent_handler(preplanned_agent_request)
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


def _build_prompt_runtime_assets(
    settings: ApiSettings,
) -> tuple[
    PromptRuntimeSettings,
    PromptHTTPPoolRuntime,
    ProviderBackedRagPromptExecutor | None,
]:
    provider = settings.prompt_runtime_provider or settings.runtime_provider
    http_settings = PromptRuntimeHTTPSettings(
        connect_timeout_seconds=settings.prompt_runtime_connect_timeout_seconds,
        read_timeout_seconds=settings.prompt_runtime_read_timeout_seconds,
        write_timeout_seconds=settings.prompt_runtime_write_timeout_seconds,
        pool_timeout_seconds=settings.prompt_runtime_pool_timeout_seconds,
        max_connections=settings.prompt_runtime_max_connections,
        max_keepalive_connections=settings.prompt_runtime_max_keepalive_connections,
        keepalive_expiry_seconds=settings.prompt_runtime_keepalive_expiry_seconds,
    )
    prompt_http_pool = PromptHTTPPoolRuntime(
        settings=http_settings,
        base_url=settings.prompt_runtime_base_url,
    )
    prompt_runtime = PromptRuntimeSettings(
        provider=provider,
        transport=settings.prompt_runtime_transport,
        supervisor_prompt_model=settings.supervisor_prompt_model,
        agent_prompt_model=settings.agent_prompt_model,
        strict_structured_outputs=settings.prompt_strict_structured_outputs,
    )
    if not provider:
        return (
            replace(prompt_runtime, admission_reason="provider_not_configured"),
            prompt_http_pool,
            None,
        )
    if not settings.prompt_strict_structured_outputs:
        return (
            replace(
                prompt_runtime,
                admission_reason="strict_structured_outputs_disabled",
            ),
            prompt_http_pool,
            None,
        )
    if not settings.agent_prompt_model.strip():
        return (
            replace(prompt_runtime, admission_reason="prompt_models_not_configured"),
            prompt_http_pool,
            None,
        )
    if not settings.prompt_runtime_api_key.strip():
        return (
            replace(prompt_runtime, admission_reason="api_key_not_configured"),
            prompt_http_pool,
            None,
        )
    try:
        provider_config = PromptRuntimeProviderConfig(
            provider=provider,
            transport=settings.prompt_runtime_transport,  # type: ignore[arg-type]
            api_key=settings.prompt_runtime_api_key,
            base_url=settings.prompt_runtime_base_url,
            reasoning_effort=settings.prompt_runtime_reasoning_effort,
            max_output_tokens=settings.prompt_runtime_max_output_tokens,
            http_settings=http_settings,
        )
    except ValueError as exc:
        return (
            replace(prompt_runtime, admission_reason=str(exc)),
            prompt_http_pool,
            None,
        )
    prompt_http_pool.client = build_prompt_runtime_http_client(provider_config)
    return (
        replace(prompt_runtime, admitted=True),
        prompt_http_pool,
        ProviderBackedRagPromptExecutor(
            provider_config=provider_config,
            model_name=settings.agent_prompt_model,
            http_client=prompt_http_pool.client,
        ),
    )
