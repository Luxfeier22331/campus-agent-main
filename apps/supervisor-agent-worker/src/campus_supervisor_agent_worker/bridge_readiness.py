from __future__ import annotations

from collections.abc import Callable, Mapping

from campus_supervisor_agent_worker.agents_sdk_runtime_policy import (
    agents_sdk_runtime_status,
)
from campus_supervisor_agent_worker.bridge_auth import require_bridge_auth
from campus_supervisor_agent_worker.http_types import HttpResponse
from campus_supervisor_agent_worker.prompt_stack import PromptRuntimeSettings
from campus_supervisor_agent_worker.settings import ApiSettings

RuntimeStatusProvider = Callable[[], Mapping[str, Mapping[str, object]]]


def healthz(settings: ApiSettings) -> HttpResponse:
    return HttpResponse(status_code=200, json_body={"status": "ok", "app_name": settings.app_name})


def handle_bridge_healthz(headers: Mapping[str, str], settings: ApiSettings) -> HttpResponse:
    bridge_auth_error = require_bridge_auth(headers, settings)
    if bridge_auth_error is not None:
        return bridge_auth_error
    return healthz(settings)


def readyz(
    settings: ApiSettings,
    *,
    prompt_runtime: PromptRuntimeSettings | None = None,
    runtime_status_provider: RuntimeStatusProvider | None = None,
) -> HttpResponse:
    runtime_prompt = prompt_runtime or resolve_prompt_runtime_settings(settings)
    runtime_status = dict(runtime_status_provider() if runtime_status_provider else {})
    prompt_http_pool = dict(
        runtime_status.get("prompt_http_pool")
        or default_prompt_http_pool_status(settings=settings, admitted=runtime_prompt.admitted)
    )
    agents_sdk_runtime = dict(
        runtime_status.get("agents_sdk_runtime")
        or default_agents_sdk_runtime_status(settings=settings, admitted=runtime_prompt.admitted)
    )
    agents_sdk_runtime_degraded = bool(agents_sdk_runtime.get("enabled")) and not bool(
        agents_sdk_runtime.get("admitted")
    )
    degraded = (
        not runtime_prompt.admitted
        or not bool(prompt_http_pool.get("healthy", True))
        or agents_sdk_runtime_degraded
    )
    return HttpResponse(
        status_code=503 if degraded else 200,
        json_body={
            "status": "degraded" if degraded else "ready",
            "runtime_provider": settings.runtime_provider,
            "supervisor_model": settings.supervisor_prompt_model,
            "agent_model": settings.agent_prompt_model,
            "prompt_runtime": {
                "provider": runtime_prompt.provider,
                "transport": runtime_prompt.transport,
                "developer_invariants_id": runtime_prompt.developer_invariants_id,
                "developer_invariants_version": runtime_prompt.developer_invariants_version,
                "strict_structured_outputs": runtime_prompt.strict_structured_outputs,
                "supervisor_model": runtime_prompt.supervisor_prompt_model,
                "agent_model": runtime_prompt.agent_prompt_model,
                "admitted": runtime_prompt.admitted,
                "admission_reason": runtime_prompt.admission_reason,
            },
            "prompt_http_pool": prompt_http_pool,
            "agents_sdk_runtime": agents_sdk_runtime,
            "worker_runtime": runtime_status.get("worker_runtime")
            or {"role": "semantic_worker", "cancel_flag_store": "available"},
        },
    )


def handle_bridge_readyz(
    headers: Mapping[str, str],
    settings: ApiSettings,
    *,
    prompt_runtime: PromptRuntimeSettings | None = None,
    runtime_status_provider: RuntimeStatusProvider | None = None,
) -> HttpResponse:
    bridge_auth_error = require_bridge_auth(headers, settings)
    if bridge_auth_error is not None:
        return bridge_auth_error
    return readyz(
        settings,
        prompt_runtime=prompt_runtime,
        runtime_status_provider=runtime_status_provider,
    )


def resolve_prompt_runtime_settings(settings: ApiSettings) -> PromptRuntimeSettings:
    prompt_runtime_provider = settings.prompt_runtime_provider or settings.runtime_provider
    if not prompt_runtime_provider:
        admission_reason = "provider_not_configured"
    elif not settings.prompt_strict_structured_outputs:
        admission_reason = "strict_structured_outputs_disabled"
    elif not settings.agent_prompt_model.strip():
        admission_reason = "prompt_models_not_configured"
    elif not settings.prompt_runtime_api_key.strip():
        admission_reason = "api_key_not_configured"
    elif settings.prompt_runtime_transport != "responses":
        admission_reason = "transport must be 'responses'"
    elif not settings.prompt_runtime_base_url.strip():
        admission_reason = "base_url must not be empty"
    else:
        admission_reason = ""
    return PromptRuntimeSettings(
        provider=prompt_runtime_provider,
        transport=settings.prompt_runtime_transport,
        supervisor_prompt_model=settings.supervisor_prompt_model,
        agent_prompt_model=settings.agent_prompt_model,
        strict_structured_outputs=settings.prompt_strict_structured_outputs,
        admitted=not admission_reason,
        admission_reason=admission_reason,
    )


def default_prompt_http_pool_status(
    *,
    settings: ApiSettings,
    admitted: bool,
) -> dict[str, object]:
    return {
        "healthy": admitted,
        "configured": admitted,
        "base_url": settings.prompt_runtime_base_url,
        "max_connections": settings.prompt_runtime_max_connections,
        "max_keepalive_connections": settings.prompt_runtime_max_keepalive_connections,
        "keepalive_expiry_seconds": settings.prompt_runtime_keepalive_expiry_seconds,
    }


def default_agents_sdk_runtime_status(
    *,
    settings: ApiSettings,
    admitted: bool,
) -> dict[str, object]:
    return agents_sdk_runtime_status(
        enabled=settings.agents_sdk_runtime_enabled,
        prompt_runtime_provider=settings.prompt_runtime_provider or settings.runtime_provider,
        prompt_runtime_admitted=admitted,
        agent_model=settings.agent_prompt_model,
    )
