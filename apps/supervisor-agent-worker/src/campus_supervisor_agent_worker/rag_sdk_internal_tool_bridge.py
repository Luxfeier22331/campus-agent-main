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

RAG_SDK_INTERNAL_TOOL_RUNTIME_POSTURE = "sdk_internal_admitted"


class RagSdkInternalToolBridgeError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class RagSdkInternalToolDescriptor:
    name: str
    description: str
    parameters: dict[str, Any]
    strict: bool
    runtime_posture: str


def build_rag_sdk_internal_tool_descriptor(
    tool_name: str = "retrieve_evidence",
    *,
    registry: ToolSpecRegistry | None = None,
) -> RagSdkInternalToolDescriptor:
    tool_registry = registry or default_tool_spec_registry()
    tool = tool_registry.tool_by_name(tool_name)
    if tool is None:
        raise RagSdkInternalToolBridgeError(f"unknown RAG SDK internal tool: {tool_name}")
    _validate_rag_sdk_internal_tool(tool)
    schema = provider_function_schema_for_tool(tool)
    parameters = schema.get("parameters")
    if schema.get("type") != "function" or not isinstance(parameters, dict):
        raise RagSdkInternalToolBridgeError(f"{tool.name} function schema is malformed")
    if schema.get("name") != tool.name:
        raise RagSdkInternalToolBridgeError(f"{tool.name} function schema name mismatch")
    if schema.get("strict") is not True:
        raise RagSdkInternalToolBridgeError(f"{tool.name} function schema must be strict")
    return RagSdkInternalToolDescriptor(
        name=tool.name,
        description=tool.description,
        parameters=deepcopy(parameters),
        strict=tool.function_schema.strict,
        runtime_posture=tool.runtime_posture,
    )


def _validate_rag_sdk_internal_tool(tool: ToolSpec) -> None:
    if tool.surface != "agent_internal":
        raise RagSdkInternalToolBridgeError(f"{tool.name} must remain agent_internal")
    if tool.owner_agent != "rag-agent":
        raise RagSdkInternalToolBridgeError(f"{tool.name} owner_agent must be rag-agent")
    if tool.runtime_posture != RAG_SDK_INTERNAL_TOOL_RUNTIME_POSTURE:
        raise RagSdkInternalToolBridgeError(
            f"{tool.name} runtime_posture must be {RAG_SDK_INTERNAL_TOOL_RUNTIME_POSTURE}"
        )
    if not tool.active or not tool.read_only:
        raise RagSdkInternalToolBridgeError(f"{tool.name} must be active and read_only")
    if not tool.function_schema.available or not tool.function_schema.strict:
        raise RagSdkInternalToolBridgeError(f"{tool.name} must expose a strict function schema")


__all__ = [
    "RAG_SDK_INTERNAL_TOOL_RUNTIME_POSTURE",
    "RagSdkInternalToolBridgeError",
    "RagSdkInternalToolDescriptor",
    "build_rag_sdk_internal_tool_descriptor",
]
