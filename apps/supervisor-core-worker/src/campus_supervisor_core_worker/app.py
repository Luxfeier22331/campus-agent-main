from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace

import httpx
from campus_notice_agent import NoticeHTTPQueryService, delegate_to_notice_agent
from campus_services_agent import CampusServicesHTTPQueryService, delegate_to_campus_services_agent
from campus_shared import (
    PromptRuntimeHTTPSettings,
    PromptRuntimeProviderConfig,
    build_prompt_runtime_http_client,
)
from campus_supervisor_core import ExecutionCancelledError, SupervisorAgent, handle_request

from campus_supervisor_core_worker.api import (
    ExecutionCancelRegistry,
    HttpResponse,
    HttpRoute,
    build_bridge_routes,
)
from campus_supervisor_core_worker.prompt_executor import (
    ProviderBackedRagPromptExecutor,
    ProviderBackedSupervisorPromptExecutor,
)
from campus_supervisor_core_worker.prompt_stack import PromptRuntimeSettings
from campus_supervisor_core_worker.settings import ApiSettings


@dataclass(frozen=True, slots=True)
class AgentOSRuntime:
    provider: str = ""
    supervisor_model: str = ""
    specialist_model: str = ""
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
class SupervisorApiApp:
    name: str
    runtime: AgentOSRuntime
    routes: tuple[HttpRoute, ...]
    prompt_http_pool: PromptHTTPPoolRuntime
    cancel_registry: ExecutionCancelRegistry

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

    def flush_audit(self, *, timeout_seconds: float = 1.0) -> bool:
        _ = timeout_seconds
        return True

    def close(self) -> None:
        self.prompt_http_pool.close()


def create_bridge_app(
    *,
    settings: ApiSettings | None = None,
    supervisor_handler=handle_request,
) -> SupervisorApiApp:
    return _create_runtime_app(
        settings=settings,
        supervisor_handler=supervisor_handler,
    )


def _create_runtime_app(
    *,
    settings: ApiSettings | None = None,
    supervisor_handler=handle_request,
) -> SupervisorApiApp:
    runtime_settings = settings or ApiSettings.from_env()
    (
        prompt_runtime,
        prompt_http_pool,
        supervisor_prompt_executor,
        rag_prompt_executor,
    ) = _build_prompt_runtime_assets(runtime_settings)
    cancel_registry = ExecutionCancelRegistry()
    bound_supervisor_handler = _bind_supervisor_handler(
        runtime_settings,
        supervisor_handler=supervisor_handler,
        supervisor_prompt_executor=supervisor_prompt_executor,
        rag_prompt_executor=rag_prompt_executor,
        cancel_registry=cancel_registry,
    )
    routes = build_bridge_routes(
        runtime_settings,
        supervisor_handler=bound_supervisor_handler,
        prompt_runtime=prompt_runtime,
        runtime_status_provider=lambda: {
            "prompt_http_pool": prompt_http_pool.status(admitted=prompt_runtime.admitted),
            "worker_runtime": {"role": "semantic_worker", "cancel_flag_store": "available"},
        },
        cancel_registry=cancel_registry,
    )
    return SupervisorApiApp(
        name=runtime_settings.app_name,
        runtime=AgentOSRuntime(
            provider=runtime_settings.runtime_provider,
            supervisor_model=runtime_settings.supervisor_prompt_model,
            specialist_model=runtime_settings.specialist_prompt_model,
            prompt_runtime=prompt_runtime,
        ),
        routes=routes,
        prompt_http_pool=prompt_http_pool,
        cancel_registry=cancel_registry,
    )


def _bind_supervisor_handler(
    settings: ApiSettings,
    *,
    supervisor_handler,
    supervisor_prompt_executor: ProviderBackedSupervisorPromptExecutor | None,
    rag_prompt_executor: ProviderBackedRagPromptExecutor | None,
    cancel_registry: ExecutionCancelRegistry,
):
    if supervisor_handler is not handle_request:
        return _wrap_with_cancel_checks(supervisor_handler, cancel_registry)
    campus_services_query_service = _build_campus_services_query_service(settings)
    notice_query_service = _build_notice_query_service(settings)
    if campus_services_query_service is not None or notice_query_service is not None:

        def handle_with_structured_query_services(request, preplanned_routing_decision=None):
            agent = SupervisorAgent(
                supervisor_prompt_executor=supervisor_prompt_executor,
                rag_prompt_executor=rag_prompt_executor,
                cancellation_checker=lambda: cancel_registry.is_cancel_requested(
                    request.request_id
                ),
                preplanned_routing_decision=preplanned_routing_decision,
            )
            assert agent.specialist_delegates is not None
            if campus_services_query_service is not None:
                agent.specialist_delegates["campus-services-agent"] = lambda specialist_request: (
                    delegate_to_campus_services_agent(
                        specialist_request,
                        query_service=campus_services_query_service,
                    )
                )
            if notice_query_service is not None:
                agent.specialist_delegates["notice-agent"] = lambda specialist_request: (
                    delegate_to_notice_agent(
                        specialist_request,
                        query_service=notice_query_service,
                    )
                )
            return agent.handle(request)

        return handle_with_structured_query_services
    if supervisor_prompt_executor is not None and rag_prompt_executor is not None:
        return lambda request, preplanned_routing_decision=None: handle_request(
            request,
            supervisor_prompt_executor=supervisor_prompt_executor,
            rag_prompt_executor=rag_prompt_executor,
            cancellation_checker=lambda: cancel_registry.is_cancel_requested(request.request_id),
            preplanned_routing_decision=preplanned_routing_decision,
        )
    return lambda request, preplanned_routing_decision=None: handle_request(
        request,
        cancellation_checker=lambda: cancel_registry.is_cancel_requested(request.request_id),
        preplanned_routing_decision=preplanned_routing_decision,
    )


def _wrap_with_cancel_checks(supervisor_handler, cancel_registry: ExecutionCancelRegistry):
    def guarded_supervisor_handler(request, preplanned_routing_decision=None):
        _ = preplanned_routing_decision
        if cancel_registry.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Supervisor execution was cancelled.")
        response = supervisor_handler(request)
        if cancel_registry.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Supervisor execution was cancelled.")
        return response

    return guarded_supervisor_handler


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
    ProviderBackedSupervisorPromptExecutor | None,
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
        specialist_prompt_model=settings.specialist_prompt_model,
        strict_structured_outputs=settings.prompt_strict_structured_outputs,
    )
    if not provider:
        return (
            replace(prompt_runtime, admission_reason="provider_not_configured"),
            prompt_http_pool,
            None,
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
            None,
        )
    if not settings.supervisor_prompt_model.strip() or not settings.specialist_prompt_model.strip():
        return (
            replace(prompt_runtime, admission_reason="prompt_models_not_configured"),
            prompt_http_pool,
            None,
            None,
        )
    if not settings.prompt_runtime_api_key.strip():
        return (
            replace(prompt_runtime, admission_reason="api_key_not_configured"),
            prompt_http_pool,
            None,
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
            None,
        )
    prompt_http_pool.client = build_prompt_runtime_http_client(provider_config)
    return (
        replace(prompt_runtime, admitted=True),
        prompt_http_pool,
        ProviderBackedSupervisorPromptExecutor(
            provider_config=provider_config,
            model_name=settings.supervisor_prompt_model,
            http_client=prompt_http_pool.client,
        ),
        ProviderBackedRagPromptExecutor(
            provider_config=provider_config,
            model_name=settings.specialist_prompt_model,
            http_client=prompt_http_pool.client,
        ),
    )
