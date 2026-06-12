from __future__ import annotations

import importlib.util

DEFAULT_AGENTS_SDK_RUNTIME_POSTURE = "domain_capability_adapter_admitted"


def agents_sdk_runtime_status(
    *,
    enabled: bool,
    prompt_runtime_provider: str,
    agent_model: str,
    prompt_runtime_admitted: bool = True,
    prompt_runtime_api_key_configured: bool = True,
    sdk_available: bool | None = None,
) -> dict[str, object]:
    dependency_available = (
        _is_agents_sdk_dependency_available() if sdk_available is None else sdk_available
    )
    admission_reason = _agents_sdk_runtime_admission_reason(
        enabled=enabled,
        sdk_available=dependency_available,
        prompt_runtime_provider=prompt_runtime_provider,
        prompt_runtime_admitted=prompt_runtime_admitted,
        prompt_runtime_api_key_configured=prompt_runtime_api_key_configured,
        agent_model=agent_model,
    )
    admitted = enabled and admission_reason == "admitted"
    return {
        "enabled": enabled,
        "admitted": admitted,
        "admission_reason": admission_reason,
        "runtime_enabled": enabled,
        "runtime_admitted": admitted,
        "runtime_posture": DEFAULT_AGENTS_SDK_RUNTIME_POSTURE,
    }


def _agents_sdk_runtime_admission_reason(
    *,
    enabled: bool,
    sdk_available: bool,
    prompt_runtime_provider: str,
    prompt_runtime_admitted: bool,
    prompt_runtime_api_key_configured: bool,
    agent_model: str,
) -> str:
    if not enabled:
        return "disabled"
    if not sdk_available:
        return "dependency_missing"
    if not prompt_runtime_provider.strip() or not prompt_runtime_admitted:
        return "provider_config_missing"
    if not prompt_runtime_api_key_configured:
        return "provider_key_missing"
    if not agent_model.strip():
        return "model_missing"
    return "admitted"


def _is_agents_sdk_dependency_available() -> bool:
    return importlib.util.find_spec("agents") is not None


__all__ = [
    "DEFAULT_AGENTS_SDK_RUNTIME_POSTURE",
    "agents_sdk_runtime_status",
]
