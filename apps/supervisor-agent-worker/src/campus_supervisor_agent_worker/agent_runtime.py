from __future__ import annotations

from dataclasses import dataclass, field, replace

import httpx
from campus_shared import (
    PromptRuntimeHTTPSettings,
    PromptRuntimeProviderConfig,
    build_prompt_runtime_http_client,
)

from campus_supervisor_agent_worker.prompt_executor import ProviderBackedRagPromptExecutor
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


def build_prompt_runtime_assets(
    settings: ApiSettings,
) -> tuple[
    PromptRuntimeSettings,
    PromptHTTPPoolRuntime,
    ProviderBackedRagPromptExecutor | None,
]:
    provider = settings.prompt_runtime_provider
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
