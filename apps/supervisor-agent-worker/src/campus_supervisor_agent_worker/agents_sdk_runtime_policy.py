from __future__ import annotations

import importlib.util

DEFAULT_AGENTS_SDK_RUNTIME_POSTURE = "domain_agent_adapter_pilot"


def agents_sdk_runtime_status(
    *,
    enabled: bool,
    allowed_targets: tuple[str, ...],
    allowed_tools: tuple[str, ...],
    prompt_runtime_provider: str,
    agent_model: str,
    prompt_runtime_admitted: bool = True,
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
        agent_model=agent_model,
        allowed_targets=allowed_targets,
        allowed_tools=allowed_tools,
    )
    admitted = enabled and admission_reason == "admitted"
    return {
        "enabled": enabled,
        "admitted": admitted,
        "admission_reason": admission_reason,
        "allowed_targets": list(allowed_targets),
        "allowed_tools": list(allowed_tools),
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
    agent_model: str,
    allowed_targets: tuple[str, ...],
    allowed_tools: tuple[str, ...],
) -> str:
    if not enabled:
        return "disabled"
    if not sdk_available:
        return "dependency_missing"
    if not prompt_runtime_provider.strip() or not prompt_runtime_admitted:
        return "provider_config_missing"
    if not agent_model.strip():
        return "model_missing"
    if not allowed_targets:
        return "allowed_target_missing"
    if not allowed_tools:
        return "allowed_tool_missing"
    if "campus_notice_get" in allowed_tools:
        return "unsupported_allowed_tool"
    return "admitted"


def _is_agents_sdk_dependency_available() -> bool:
    return importlib.util.find_spec("agents") is not None


__all__ = [
    "DEFAULT_AGENTS_SDK_RUNTIME_POSTURE",
    "agents_sdk_runtime_status",
]
