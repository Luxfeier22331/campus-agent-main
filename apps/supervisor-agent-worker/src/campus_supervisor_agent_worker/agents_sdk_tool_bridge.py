from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from campus_supervisor_agent_worker.tool_function_schema import (
    provider_function_schema_for_tool,
)
from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpec,
    ToolSpecRegistry,
    default_tool_spec_registry,
)

AGENTS_SDK_TOOL_BRIDGE_SCHEMA_VERSION = "agents-sdk-tool-bridge-v1"
AGENTS_SDK_TOOL_RUNTIME_POLICY_VERSION = "agents-sdk-tool-runtime-policy-v1"
AGENTS_SDK_TOOL_RESULT_PROJECTION = "repo_bounded"
AGENTS_SDK_TOOL_FAIL_CLOSE_REASON = "sdk_tool_not_admitted"
DEFAULT_AGENTS_SDK_TOOL_TIMEOUT_SECONDS = 1.0
DEFAULT_AGENTS_SDK_TOOL_MAX_RESULT_BYTES = 8192
PROVIDER_RUNTIME_POSTURES = frozenset(
    {
        "provider_argument_completion_pilot",
        "provider_loop_pilot",
        "provider_loop_open",
    }
)
SDK_ADAPTER_RUNTIME_POSTURES = frozenset(
    {
        "sdk_adapter_admitted",
    }
)


class AgentsSdkToolBridgeError(ValueError):
    def __init__(self, reason: str, message: str) -> None:
        super().__init__(f"{reason}: {message}")
        self.reason = reason
        self.message = message


@dataclass(frozen=True, slots=True)
class AgentsSdkToolDescriptor:
    schema_version: str
    name: str
    description: str
    parameters: dict[str, Any]
    owner_agent: str
    capability: str
    payload_kind: str
    payload_schema_ref: str
    result_schema_ref: str
    runtime_posture: str
    read_only: bool
    function_schema_strict: bool
    function_schema: dict[str, Any]
    runtime_policy: dict[str, object]


def build_agents_sdk_tool_descriptors(
    allowed_tools: tuple[str, ...],
    *,
    registry: ToolSpecRegistry | None = None,
) -> tuple[AgentsSdkToolDescriptor, ...]:
    if not allowed_tools:
        raise _bridge_error(
            "allowed_tools_missing",
            "Agents SDK tool bridge requires Go allowed_tools",
        )

    tool_registry = registry or default_tool_spec_registry()
    seen: set[str] = set()
    descriptors: list[AgentsSdkToolDescriptor] = []
    for raw_name in allowed_tools:
        tool_name = _required_tool_name(raw_name)
        if tool_name in seen:
            raise _bridge_error("duplicate_allowed_tool", f"duplicate allowed tool: {tool_name}")
        seen.add(tool_name)
        tool = tool_registry.tool_by_name(tool_name)
        if tool is None:
            raise _bridge_error("unknown_tool", f"allowed tool is not in ToolSpec: {tool_name}")
        _validate_tool_admitted_for_sdk_bridge(tool)
        function_schema = _validated_function_schema(tool)
        descriptors.append(_descriptor_from_tool(tool, function_schema))
    return tuple(descriptors)


def _validate_tool_admitted_for_sdk_bridge(tool: ToolSpec) -> None:
    if not tool.active:
        raise _bridge_error("tool_inactive", f"ToolSpec tool is inactive: {tool.name}")
    if tool.surface != "structured_handoff":
        raise _bridge_error(
            "unsupported_tool_surface",
            f"SDK tool bridge only accepts structured_handoff tools: {tool.name}",
        )
    if not tool.read_only:
        raise _bridge_error(
            "tool_not_read_only", f"SDK tool bridge requires read_only: {tool.name}"
        )
    if not tool.function_schema.available:
        raise _bridge_error(
            "function_schema_missing",
            f"ToolSpec function schema is unavailable: {tool.name}",
        )
    if not tool.function_schema.strict:
        raise _bridge_error(
            "function_schema_not_strict",
            f"ToolSpec function schema is not strict: {tool.name}",
        )
    if tool.runtime_posture not in SDK_ADAPTER_RUNTIME_POSTURES:
        raise _bridge_error(
            "runtime_posture_not_admitted",
            "SDK tool bridge requires an SDK adapter runtime posture for "
            f"{tool.name}: {tool.runtime_posture}",
        )


def _validated_function_schema(tool: ToolSpec) -> dict[str, Any]:
    schema = provider_function_schema_for_tool(tool)
    if schema.get("type") != "function":
        raise _bridge_error("function_schema_drift", f"{tool.name} schema type is not function")
    if schema.get("name") != tool.name:
        raise _bridge_error("function_schema_drift", f"{tool.name} schema name mismatch")
    if schema.get("description") != tool.description:
        raise _bridge_error("function_schema_drift", f"{tool.name} schema description mismatch")
    if schema.get("strict") is not True:
        raise _bridge_error("function_schema_drift", f"{tool.name} schema is not strict")
    parameters = schema.get("parameters")
    if not isinstance(parameters, dict) or parameters.get("type") != "object":
        raise _bridge_error("function_schema_drift", f"{tool.name} schema parameters mismatch")
    return deepcopy(schema)


def _descriptor_from_tool(
    tool: ToolSpec,
    function_schema: dict[str, Any],
) -> AgentsSdkToolDescriptor:
    parameters = function_schema["parameters"]
    if not isinstance(parameters, dict):
        raise _bridge_error("function_schema_drift", f"{tool.name} schema parameters mismatch")
    return AgentsSdkToolDescriptor(
        schema_version=AGENTS_SDK_TOOL_BRIDGE_SCHEMA_VERSION,
        name=tool.name,
        description=tool.description,
        parameters=deepcopy(parameters),
        owner_agent=tool.owner_agent,
        capability=tool.capability,
        payload_kind=tool.payload_kind,
        payload_schema_ref=tool.payload_schema_ref,
        result_schema_ref=tool.result_schema_ref,
        runtime_posture=tool.runtime_posture,
        read_only=tool.read_only,
        function_schema_strict=tool.function_schema.strict,
        function_schema=function_schema,
        runtime_policy=_runtime_policy(),
    )


def _runtime_policy() -> dict[str, object]:
    return {
        "schema_version": AGENTS_SDK_TOOL_RUNTIME_POLICY_VERSION,
        "read_only": True,
        "timeout_seconds": DEFAULT_AGENTS_SDK_TOOL_TIMEOUT_SECONDS,
        "max_result_bytes": DEFAULT_AGENTS_SDK_TOOL_MAX_RESULT_BYTES,
        "result_projection": AGENTS_SDK_TOOL_RESULT_PROJECTION,
        "fail_close_reason": AGENTS_SDK_TOOL_FAIL_CLOSE_REASON,
    }


def _required_tool_name(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise _bridge_error("invalid_allowed_tool", "allowed tool name must be non-empty")
    return normalized


def _bridge_error(reason: str, message: str) -> AgentsSdkToolBridgeError:
    return AgentsSdkToolBridgeError(reason, message)


__all__ = [
    "AGENTS_SDK_TOOL_BRIDGE_SCHEMA_VERSION",
    "AGENTS_SDK_TOOL_FAIL_CLOSE_REASON",
    "AGENTS_SDK_TOOL_RESULT_PROJECTION",
    "AGENTS_SDK_TOOL_RUNTIME_POLICY_VERSION",
    "AgentsSdkToolBridgeError",
    "AgentsSdkToolDescriptor",
    "build_agents_sdk_tool_descriptors",
]
