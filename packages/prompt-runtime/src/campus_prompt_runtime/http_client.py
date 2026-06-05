from __future__ import annotations

import httpx

from .config import PromptRuntimeProviderConfig


def build_prompt_runtime_http_client(
    provider_config: PromptRuntimeProviderConfig,
) -> httpx.Client:
    return httpx.Client(
        base_url=provider_config.base_url.rstrip("/"),
        timeout=provider_config.http_settings.to_httpx_timeout(),
        limits=provider_config.http_settings.to_httpx_limits(),
        trust_env=False,
    )
