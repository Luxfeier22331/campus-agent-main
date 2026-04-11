from __future__ import annotations

from dataclasses import dataclass, field, replace
from functools import partial
from typing import Mapping

from campus_shared import PromptRuntimeProviderConfig
from campus_supervisor_api.prompt_executor import (
    ProviderBackedRagPromptExecutor,
    ProviderBackedSupervisorPromptExecutor,
)
from campus_supervisor_core import handle_request

from campus_supervisor_api.api import HttpResponse, HttpRoute, build_routes
from campus_supervisor_api.prompt_stack import PromptRuntimeSettings
from campus_supervisor_api.settings import ApiSettings


@dataclass(frozen=True, slots=True)
class AgentOSRuntime:
    provider: str = ""
    supervisor_model: str = ""
    specialist_model: str = ""
    prompt_runtime: PromptRuntimeSettings = field(default_factory=PromptRuntimeSettings)


@dataclass(slots=True)
class SupervisorApiApp:
    name: str
    runtime: AgentOSRuntime
    routes: tuple[HttpRoute, ...]

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
        return HttpResponse(status_code=404, json_body={"error": {"code": "not_found", "message": "Route not found."}})


def create_app(
    *,
    settings: ApiSettings | None = None,
    supervisor_handler=handle_request,
) -> SupervisorApiApp:
    runtime_settings = settings or ApiSettings.from_env()
    prompt_runtime, supervisor_prompt_executor, rag_prompt_executor = (
        _build_prompt_runtime_assets(runtime_settings)
    )
    bound_supervisor_handler = supervisor_handler
    if (
        supervisor_handler is handle_request
        and supervisor_prompt_executor is not None
        and rag_prompt_executor is not None
    ):
        bound_supervisor_handler = partial(
            handle_request,
            supervisor_prompt_executor=supervisor_prompt_executor,
            rag_prompt_executor=rag_prompt_executor,
        )
    return SupervisorApiApp(
        name=runtime_settings.app_name,
        runtime=AgentOSRuntime(
            provider=runtime_settings.runtime_provider,
            supervisor_model=runtime_settings.agno_supervisor_model,
            specialist_model=runtime_settings.agno_specialist_model,
            prompt_runtime=prompt_runtime,
        ),
        routes=build_routes(
            runtime_settings,
            supervisor_handler=bound_supervisor_handler,
        ),
    )


def _build_prompt_runtime_assets(
    settings: ApiSettings,
) -> tuple[
    PromptRuntimeSettings,
    ProviderBackedSupervisorPromptExecutor | None,
    ProviderBackedRagPromptExecutor | None,
]:
    provider = settings.prompt_runtime_provider or settings.runtime_provider
    prompt_runtime = PromptRuntimeSettings(
        provider=provider,
        transport=settings.prompt_runtime_transport,
        supervisor_prompt_model=settings.agno_supervisor_model,
        specialist_prompt_model=settings.agno_specialist_model,
        strict_structured_outputs=settings.prompt_strict_structured_outputs,
    )
    if not provider:
        return (
            replace(prompt_runtime, admission_reason="provider_not_configured"),
            None,
            None,
        )
    if not settings.prompt_strict_structured_outputs:
        return (
            replace(
                prompt_runtime,
                admission_reason="strict_structured_outputs_disabled",
            ),
            None,
            None,
        )
    if not settings.agno_supervisor_model.strip() or not settings.agno_specialist_model.strip():
        return (
            replace(prompt_runtime, admission_reason="prompt_models_not_configured"),
            None,
            None,
        )
    if not settings.prompt_runtime_api_key.strip():
        return (
            replace(prompt_runtime, admission_reason="api_key_not_configured"),
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
        )
    except ValueError as exc:
        return (
            replace(prompt_runtime, admission_reason=str(exc)),
            None,
            None,
        )
    return (
        replace(prompt_runtime, admitted=True),
        ProviderBackedSupervisorPromptExecutor(
            provider_config=provider_config,
            model_name=settings.agno_supervisor_model,
        ),
        ProviderBackedRagPromptExecutor(
            provider_config=provider_config,
            model_name=settings.agno_specialist_model,
        ),
    )
