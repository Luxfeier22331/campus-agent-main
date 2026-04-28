from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from campus_supervisor_agent_worker.agent_delegates import bind_agent_handler
from campus_supervisor_agent_worker.agent_dispatch import dispatch_agent_request
from campus_supervisor_agent_worker.agent_runtime import (
    AgentWorkerRuntime,
    PromptHTTPPoolRuntime,
    build_prompt_runtime_assets,
)
from campus_supervisor_agent_worker.api import build_bridge_routes
from campus_supervisor_agent_worker.cancel_flags import CancelFlagStore
from campus_supervisor_agent_worker.http_types import HttpResponse, HttpRoute
from campus_supervisor_agent_worker.settings import ApiSettings


@dataclass(slots=True)
class SupervisorAgentWorkerApp:
    name: str
    runtime: AgentWorkerRuntime
    routes: tuple[HttpRoute, ...]
    prompt_http_pool: PromptHTTPPoolRuntime
    cancel_flags: CancelFlagStore
    settings: ApiSettings

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
    ) = build_prompt_runtime_assets(runtime_settings)
    cancel_flags = CancelFlagStore()
    bound_agent_handler = bind_agent_handler(
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
        settings=runtime_settings,
    )
