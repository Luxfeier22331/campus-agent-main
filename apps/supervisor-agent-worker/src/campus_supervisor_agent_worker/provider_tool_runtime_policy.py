from __future__ import annotations

DEFAULT_PROVIDER_TOOL_RUNTIME_ALLOWED_TOOLS: tuple[str, ...] = ()
DEFAULT_PROVIDER_TOOL_RUNTIME_POSTURE = "closed"


def provider_tool_runtime_status(
    *,
    enabled: bool,
    allowed_tools: tuple[str, ...] = DEFAULT_PROVIDER_TOOL_RUNTIME_ALLOWED_TOOLS,
    prompt_runtime_admitted: bool = False,
    structured_query_configured: bool = False,
) -> dict[str, object]:
    admission_reason = _provider_tool_runtime_admission_reason(
        enabled=enabled,
        prompt_runtime_admitted=prompt_runtime_admitted,
        structured_query_configured=structured_query_configured,
        allowed_tools=allowed_tools,
    )
    return {
        "enabled": enabled,
        "admitted": enabled and not admission_reason,
        "admission_reason": admission_reason,
        "allowed_tools": list(allowed_tools),
        "schema_available": False,
        "runtime_enabled": enabled,
        "runtime_admitted": enabled and not admission_reason,
        "runtime_posture": DEFAULT_PROVIDER_TOOL_RUNTIME_POSTURE,
    }


def _provider_tool_runtime_admission_reason(
    *,
    enabled: bool,
    prompt_runtime_admitted: bool,
    structured_query_configured: bool,
    allowed_tools: tuple[str, ...],
) -> str:
    if not enabled:
        return "disabled"
    if allowed_tools != DEFAULT_PROVIDER_TOOL_RUNTIME_ALLOWED_TOOLS:
        return "unsupported_allowed_tools"
    return "runtime_closed"
    if not prompt_runtime_admitted:
        return "prompt_runtime_not_admitted"
    if not structured_query_configured:
        return "structured_query_service_not_configured"


__all__ = [
    "DEFAULT_PROVIDER_TOOL_RUNTIME_ALLOWED_TOOLS",
    "DEFAULT_PROVIDER_TOOL_RUNTIME_POSTURE",
    "provider_tool_runtime_status",
]
