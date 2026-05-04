from __future__ import annotations

import importlib.util

from campus_supervisor_agent_worker.agent_spec_registry import (
    AgentSpecRegistry,
    default_agent_spec_registry,
)
from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpecRegistry,
    default_tool_spec_registry,
)

DEFAULT_AGENTS_SDK_RUNTIME_POSTURE = "domain_agent_adapter_candidate"
SDK_ADAPTER_TOOL_RUNTIME_POSTURES = frozenset(
    {
        "sdk_adapter_candidate",
        "sdk_adapter_admitted",
    }
)


def agents_sdk_runtime_status(
    *,
    enabled: bool,
    allowed_targets: tuple[str, ...],
    allowed_tools: tuple[str, ...],
    prompt_runtime_provider: str,
    agent_model: str,
    prompt_runtime_admitted: bool = True,
    sdk_available: bool | None = None,
    agent_registry: AgentSpecRegistry | None = None,
    tool_registry: ToolSpecRegistry | None = None,
) -> dict[str, object]:
    dependency_available = (
        _is_agents_sdk_dependency_available() if sdk_available is None else sdk_available
    )
    resolved_agent_registry = agent_registry or default_agent_spec_registry()
    resolved_tool_registry = tool_registry or default_tool_spec_registry()
    pair_status = _agents_sdk_pair_status(
        allowed_targets=allowed_targets,
        allowed_tools=allowed_tools,
        agent_registry=resolved_agent_registry,
        tool_registry=resolved_tool_registry,
    )
    admission_reason = _agents_sdk_runtime_admission_reason(
        enabled=enabled,
        sdk_available=dependency_available,
        prompt_runtime_provider=prompt_runtime_provider,
        prompt_runtime_admitted=prompt_runtime_admitted,
        agent_model=agent_model,
        allowed_targets=allowed_targets,
        allowed_tools=allowed_tools,
        blocked_pairs=pair_status["blocked_pairs"],
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
        "admitted_pairs": pair_status["admitted_pairs"] if admitted else [],
        "blocked_pairs": pair_status["blocked_pairs"] if enabled else [],
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
    blocked_pairs: list[dict[str, object]],
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
    if blocked_pairs:
        return str(blocked_pairs[0]["reason"])
    return "admitted"


def _is_agents_sdk_dependency_available() -> bool:
    return importlib.util.find_spec("agents") is not None


def _agents_sdk_pair_status(
    *,
    allowed_targets: tuple[str, ...],
    allowed_tools: tuple[str, ...],
    agent_registry: AgentSpecRegistry,
    tool_registry: ToolSpecRegistry,
) -> dict[str, list[dict[str, object]]]:
    admitted_pairs: list[dict[str, object]] = []
    blocked_pairs: list[dict[str, object]] = []
    for target in allowed_targets:
        agent = agent_registry.agent_by_id(target)
        target_tools = allowed_tools or ("",)
        if agent is None:
            for tool_name in target_tools:
                blocked_pairs.append(
                    {
                        "target": target,
                        "tool": tool_name,
                        "reason": "unknown_target",
                        "tool_runtime_posture": "",
                    }
                )
            continue
        if not agent.active or agent.opening_gate != "open":
            for tool_name in target_tools:
                blocked_pairs.append(
                    {
                        "target": target,
                        "tool": tool_name,
                        "reason": "target_not_open",
                        "tool_runtime_posture": "",
                    }
                )
            continue
        for tool_name in target_tools:
            tool = tool_registry.tool_by_name(tool_name)
            tool_posture = tool.runtime_posture if tool is not None else ""
            if tool_name == "campus_notice_get":
                blocked_pairs.append(
                    {
                        "target": target,
                        "tool": tool_name,
                        "reason": "unsupported_allowed_tool",
                        "tool_runtime_posture": tool_posture,
                    }
                )
                continue
            if tool is None:
                blocked_pairs.append(
                    {
                        "target": target,
                        "tool": tool_name,
                        "reason": "unknown_tool",
                        "tool_runtime_posture": "",
                    }
                )
                continue
            if tool.owner_agent != target or tool.name not in agent.allowed_structured_handoff_tools:
                blocked_pairs.append(
                    {
                        "target": target,
                        "tool": tool_name,
                        "reason": "tool_not_allowed_for_target",
                        "tool_runtime_posture": tool_posture,
                    }
                )
                continue
            if not tool.active or tool.surface != "structured_handoff":
                blocked_pairs.append(
                    {
                        "target": target,
                        "tool": tool_name,
                        "reason": "tool_not_structured_handoff",
                        "tool_runtime_posture": tool_posture,
                    }
                )
                continue
            if tool_posture not in SDK_ADAPTER_TOOL_RUNTIME_POSTURES:
                blocked_pairs.append(
                    {
                        "target": target,
                        "tool": tool_name,
                        "reason": "tool_not_sdk_candidate",
                        "tool_runtime_posture": tool_posture,
                    }
                )
                continue
            admitted_pairs.append(
                {
                    "target": target,
                    "tool": tool_name,
                    "tool_runtime_posture": tool_posture,
                }
            )
    return {"admitted_pairs": admitted_pairs, "blocked_pairs": blocked_pairs}


__all__ = [
    "DEFAULT_AGENTS_SDK_RUNTIME_POSTURE",
    "SDK_ADAPTER_TOOL_RUNTIME_POSTURES",
    "agents_sdk_runtime_status",
]
