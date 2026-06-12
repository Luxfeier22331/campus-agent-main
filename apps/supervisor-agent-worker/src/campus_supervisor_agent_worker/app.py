from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from campus_contracts import CapabilityResponse, ErrorInfo

from campus_supervisor_agent_worker.agent_runtime import (
    AgentWorkerRuntime,
    PromptHTTPPoolRuntime,
    build_prompt_runtime_assets,
)
from campus_supervisor_agent_worker.agents_sdk_runtime_policy import (
    agents_sdk_runtime_status,
)
from campus_supervisor_agent_worker.api import build_bridge_routes
from campus_supervisor_agent_worker.cancel_flags import CancelFlagStore
from campus_supervisor_agent_worker.capability_delegates import (
    AgentRuntimeBuildError,
    QueryServiceRuntimeError,
    bind_capability_handler,
)
from campus_supervisor_agent_worker.capability_dispatch import dispatch_capability_request
from campus_supervisor_agent_worker.http_types import HttpResponse, HttpRoute
from campus_supervisor_agent_worker.retrieval_observation_bridge import (
    build_runtime_event_emitter_status,
)
from campus_supervisor_agent_worker.settings import ApiSettings


@dataclass(slots=True)
class SupervisorAgentWorkerApp:
    name: str
    runtime: AgentWorkerRuntime
    routes: tuple[HttpRoute, ...]
    prompt_http_pool: PromptHTTPPoolRuntime
    cancel_flags: CancelFlagStore
    settings: ApiSettings
    runtime_assembly_status: dict[str, object]

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
            "agents_sdk_runtime": _agents_sdk_runtime_status(
                settings=self.settings,
                prompt_runtime_admitted=self.runtime.prompt_runtime.admitted,
            ),
            "worker_runtime": {
                "role": "semantic_worker",
                "cancel_flag_store": "available",
                "runtime_assembly": dict(self.runtime_assembly_status),
                "runtime_event_emitter": build_runtime_event_emitter_status(
                    otel_enabled=self.settings.otel_enabled,
                    traces_endpoint=self.settings.otel_exporter_otlp_traces_endpoint,
                    metrics_endpoint=self.settings.otel_exporter_otlp_metrics_endpoint,
                    logs_endpoint=self.settings.otel_exporter_otlp_logs_endpoint,
                ),
            },
        }

    def close(self) -> None:
        self.prompt_http_pool.close()


def create_bridge_app(
    *,
    settings: ApiSettings | None = None,
    capability_handler=dispatch_capability_request,
) -> SupervisorAgentWorkerApp:
    return _create_runtime_app(
        settings=settings,
        capability_handler=capability_handler,
    )


def _create_runtime_app(
    *,
    settings: ApiSettings | None = None,
    capability_handler=dispatch_capability_request,
) -> SupervisorAgentWorkerApp:
    runtime_settings = settings or ApiSettings.from_env()
    (
        prompt_runtime,
        prompt_http_pool,
        rag_prompt_executor,
    ) = build_prompt_runtime_assets(runtime_settings)
    cancel_flags = CancelFlagStore()
    runtime_assembly_status: dict[str, object] = {
        "healthy": True,
        "failure_class": "",
        "failure_detail": "",
    }
    try:
        bound_capability_handler = bind_capability_handler(
            runtime_settings,
            capability_handler=capability_handler,
            rag_prompt_executor=rag_prompt_executor,
            cancel_flags=cancel_flags,
            prompt_http_client=prompt_http_pool.client,
        )
    except (AgentRuntimeBuildError, QueryServiceRuntimeError) as exc:
        failure_class = exc.__class__.__name__
        failure_detail = str(exc)
        runtime_assembly_status = {
            "healthy": False,
            "failure_class": failure_class,
            "failure_detail": failure_detail,
        }

        def _runtime_unavailable_handler(
            _request,
            runtime_capability_request,
            *,
            _failure_detail: str = failure_detail,
        ):
            return CapabilityResponse(
                capability=runtime_capability_request.capability,
                status="error",
                confidence="low",
                error=ErrorInfo(
                    code="worker_runtime_unavailable",
                    message=_failure_detail,
                ),
            )

        bound_capability_handler = _runtime_unavailable_handler
    routes = build_bridge_routes(
        runtime_settings,
        capability_handler=bound_capability_handler,
        prompt_runtime=prompt_runtime,
        runtime_status_provider=lambda: {
            "prompt_http_pool": prompt_http_pool.status(admitted=prompt_runtime.admitted),
            "agents_sdk_runtime": _agents_sdk_runtime_status(
                settings=runtime_settings,
                prompt_runtime_admitted=prompt_runtime.admitted,
            ),
            "worker_runtime": {
                "role": "semantic_worker",
                "cancel_flag_store": "available",
                "runtime_assembly": dict(runtime_assembly_status),
                "runtime_event_emitter": build_runtime_event_emitter_status(
                    otel_enabled=runtime_settings.otel_enabled,
                    traces_endpoint=runtime_settings.otel_exporter_otlp_traces_endpoint,
                    metrics_endpoint=runtime_settings.otel_exporter_otlp_metrics_endpoint,
                    logs_endpoint=runtime_settings.otel_exporter_otlp_logs_endpoint,
                ),
            },
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
        settings=runtime_settings,
        runtime_assembly_status=runtime_assembly_status,
    )


def _agents_sdk_runtime_status(
    *,
    settings: ApiSettings,
    prompt_runtime_admitted: bool,
) -> dict[str, object]:
    return agents_sdk_runtime_status(
        enabled=settings.agents_sdk_runtime_enabled,
        prompt_runtime_provider=settings.prompt_runtime_provider,
        prompt_runtime_admitted=prompt_runtime_admitted,
        prompt_runtime_api_key_configured=bool(settings.prompt_runtime_api_key.strip()),
        agent_model=settings.agent_prompt_model,
    )
