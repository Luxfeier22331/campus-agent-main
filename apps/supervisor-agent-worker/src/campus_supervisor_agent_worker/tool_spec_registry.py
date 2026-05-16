from __future__ import annotations

import importlib
import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from campus_contracts import AgentRequest

TOOL_SPEC_SCHEMA_VERSION = "tool-spec-registry-v2"
DEFAULT_TOOL_SPEC_PATH = Path("configs/runtime/tools.v2.json")


class ToolSpecRegistryError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ToolFunctionSchemaSpec:
    available: bool
    strict: bool


@dataclass(frozen=True, slots=True)
class ToolSpec:
    name: str
    owner_agent: str
    capability: str
    payload_kind: str
    payload_schema_ref: str
    result_schema_ref: str
    backend: str
    surface: str
    read_only: bool
    active: bool
    function_schema: ToolFunctionSchemaSpec
    runtime_posture: str
    description: str


@dataclass(frozen=True, slots=True)
class ToolSpecAdmission:
    payload_kind: str
    expected_allowed_tools: tuple[str, ...]
    tool: ToolSpec


@dataclass(frozen=True, slots=True)
class ToolSpecRegistry:
    schema_version: str
    registry_version: str
    tools: tuple[ToolSpec, ...]

    def validate(self) -> None:
        if self.schema_version != TOOL_SPEC_SCHEMA_VERSION:
            raise ToolSpecRegistryError(
                "tool spec schema_version must be "
                f"{TOOL_SPEC_SCHEMA_VERSION}, got {self.schema_version!r}"
            )
        if not self.registry_version.strip():
            raise ToolSpecRegistryError("tool spec registry_version must be a non-empty string")
        if not self.tools:
            raise ToolSpecRegistryError("tool spec tools must be a non-empty list")
        _validate_tools(self.tools)

    def tool_by_name(self, name: str) -> ToolSpec | None:
        for tool in self.tools:
            if tool.name == name:
                return tool
        return None

    def agent_facing_tools(self) -> tuple[ToolSpec, ...]:
        return tuple(
            tool for tool in self.tools if tool.active and tool.surface == "structured_handoff"
        )

    def agent_facing_tool_names_for_target(self, target: str) -> tuple[str, ...]:
        return tuple(tool.name for tool in self.agent_facing_tools() if tool.owner_agent == target)

    def callable_schema_tools(self) -> tuple[ToolSpec, ...]:
        return tuple(
            tool
            for tool in self.tools
            if tool.active
            and tool.function_schema.available
            and (
                tool.surface == "structured_handoff"
                or (
                    tool.surface == "agent_internal"
                    and tool.runtime_posture == "sdk_internal_admitted"
                )
            )
        )

    def provider_callable_internal_functions(self) -> tuple[ToolSpec, ...]:
        return tuple(
            tool
            for tool in self.tools
            if tool.active
            and tool.surface == "agent_internal"
            and tool.runtime_posture == "sdk_internal_admitted"
            and tool.function_schema.available
        )

    def internal_functions(self) -> tuple[ToolSpec, ...]:
        return tuple(
            tool
            for tool in self.tools
            if tool.active
            and tool.surface == "agent_internal"
            and tool.runtime_posture == "internal_function"
            and not tool.function_schema.available
        )

    def payload_class_for_tool(self, name: str) -> type[object]:
        tool = self.tool_by_name(name)
        if tool is None:
            raise ToolSpecRegistryError(f"unknown ToolSpec tool: {name}")
        return _resolve_class(tool.payload_schema_ref)

    def payload_kinds_for_target(self, target: str) -> tuple[str, ...]:
        seen: set[str] = set()
        result: list[str] = []
        for tool in self.tools:
            if tool.owner_agent != target:
                continue
            if tool.payload_kind in seen:
                continue
            seen.add(tool.payload_kind)
            result.append(tool.payload_kind)
        return tuple(result)

    def payload_kind_belongs_to_target(self, target: str, payload_kind: str) -> bool:
        return payload_kind in self.payload_kinds_for_target(target)

    def payload_kind_for_request(self, target: str, payload: object) -> str:
        return self.admission_for_payload(target, payload).payload_kind

    def expected_allowed_tools_for_request(self, request: AgentRequest) -> tuple[str, ...]:
        return self.admission_for_request(request).expected_allowed_tools

    def expected_allowed_tools_for_payload(self, target: str, payload: object) -> tuple[str, ...]:
        return self.admission_for_payload(target, payload).expected_allowed_tools

    def admission_for_request(self, request: AgentRequest) -> ToolSpecAdmission:
        return self.admission_for_payload(request.target, request.payload)

    def validate_allowed_tools_for_request(self, request: AgentRequest) -> ToolSpecAdmission:
        admission = self.admission_for_request(request)
        if request.allowed_tools != admission.expected_allowed_tools:
            raise ToolSpecRegistryError(
                "AgentRequest.allowed_tools must match ToolSpec admission for "
                f"target={request.target} payload={request.payload.__class__.__name__}: "
                f"got {request.allowed_tools!r}, want {admission.expected_allowed_tools!r}"
            )
        return admission

    def admission_for_payload(self, target: str, payload: object) -> ToolSpecAdmission:
        matching_inactive: list[str] = []
        for tool in self.tools:
            if tool.owner_agent != target:
                continue
            payload_class = _resolve_class(tool.payload_schema_ref)
            if not isinstance(payload, payload_class):
                continue
            if not tool.active:
                matching_inactive.append(tool.name)
                continue
            if tool.surface == "structured_handoff":
                return ToolSpecAdmission(
                    payload_kind=tool.payload_kind,
                    expected_allowed_tools=(tool.name,),
                    tool=tool,
                )
            if tool.surface == "agent_internal":
                return ToolSpecAdmission(
                    payload_kind=tool.payload_kind,
                    expected_allowed_tools=(),
                    tool=tool,
                )
        if matching_inactive:
            raise ToolSpecRegistryError(
                "ToolSpec match is inactive for target="
                f"{target} payload={payload.__class__.__name__}: {matching_inactive}"
            )
        raise ToolSpecRegistryError(
            "AgentRequest target/payload pair is outside the ToolSpec boundary: "
            f"target={target} payload={payload.__class__.__name__}"
        )


def load_tool_spec_registry(path: str | Path | None = None) -> ToolSpecRegistry:
    registry_path = _resolve_tool_spec_path(path)
    raw = _load_json(registry_path)
    raw_tools = raw.get("tools")
    tools = tuple(_parse_tool(item) for item in raw_tools or [])
    registry = ToolSpecRegistry(
        schema_version=TOOL_SPEC_SCHEMA_VERSION,
        registry_version=_required_string(raw.get("registry_version"), "registry_version"),
        tools=tools,
    )
    if raw.get("schema_version") != TOOL_SPEC_SCHEMA_VERSION:
        registry = ToolSpecRegistry(
            schema_version=str(raw.get("schema_version") or ""),
            registry_version=registry.registry_version,
            tools=registry.tools,
        )
    registry.validate()
    return registry


@lru_cache(maxsize=1)
def default_tool_spec_registry() -> ToolSpecRegistry:
    return load_tool_spec_registry()


def _parse_tool(value: object) -> ToolSpec:
    item = _mapping(value, "tool")
    function_schema = _mapping(item.get("function_schema"), "function_schema")
    return ToolSpec(
        name=_required_string(item.get("name"), "name"),
        owner_agent=_required_string(item.get("owner_agent"), "owner_agent"),
        capability=_required_string(item.get("capability"), "capability"),
        payload_kind=_required_string(item.get("payload_kind"), "payload_kind"),
        payload_schema_ref=_required_string(item.get("payload_schema_ref"), "payload_schema_ref"),
        result_schema_ref=_required_string(item.get("result_schema_ref"), "result_schema_ref"),
        backend=_required_string(item.get("backend"), "backend"),
        surface=_required_string(item.get("surface"), "surface"),
        read_only=bool(item.get("read_only")),
        active=bool(item.get("active")),
        function_schema=ToolFunctionSchemaSpec(
            available=bool(function_schema.get("available", function_schema.get("enabled"))),
            strict=bool(function_schema.get("strict")),
        ),
        runtime_posture=_runtime_posture(item),
        description=_required_string(item.get("description"), "description"),
    )


def _validate_tools(tools: tuple[ToolSpec, ...]) -> None:
    seen: set[str] = set()
    for tool in tools:
        if tool.name in seen:
            raise ToolSpecRegistryError(f"duplicate ToolSpec tool name: {tool.name}")
        seen.add(tool.name)
        _resolve_class(tool.payload_schema_ref)
        _resolve_class(tool.result_schema_ref)
        if (
            tool.function_schema.available
            and tool.surface != "structured_handoff"
            and (
                tool.surface != "agent_internal" or tool.runtime_posture != "sdk_internal_admitted"
            )
        ):
            raise ToolSpecRegistryError(
                f"{tool.name} function_schema can only be available for "
                "structured_handoff or sdk_internal_admitted agent_internal tools"
            )
        if tool.function_schema.available and not tool.function_schema.strict:
            raise ToolSpecRegistryError(
                f"{tool.name} function_schema.strict must be true when available"
            )
        if tool.active and not tool.read_only:
            raise ToolSpecRegistryError(f"{tool.name} active tools must be read_only")
        if tool.runtime_posture not in {
            "closed",
            "typed_handoff_only",
            "sdk_adapter_admitted",
            "sdk_internal_admitted",
            "internal_function",
        }:
            raise ToolSpecRegistryError(
                f"{tool.name} runtime_posture is unsupported: {tool.runtime_posture}"
            )
        if tool.runtime_posture == "sdk_internal_admitted" and tool.surface != "agent_internal":
            raise ToolSpecRegistryError(
                f"{tool.name} sdk_internal_admitted posture requires agent_internal surface"
            )
        if tool.runtime_posture == "internal_function" and tool.surface != "agent_internal":
            raise ToolSpecRegistryError(
                f"{tool.name} internal_function posture requires agent_internal surface"
            )
        if tool.runtime_posture == "internal_function" and tool.function_schema.available:
            raise ToolSpecRegistryError(
                f"{tool.name} internal_function posture must not expose function_schema"
            )
        if tool.runtime_posture.startswith("sdk_") and not tool.function_schema.available:
            raise ToolSpecRegistryError(
                f"{tool.name} runtime posture requires function_schema.available"
            )


@lru_cache(maxsize=128)
def _resolve_class(dotted_path: str) -> type[object]:
    module_name, _, class_name = dotted_path.rpartition(".")
    if not module_name or not class_name:
        raise ToolSpecRegistryError(f"invalid schema ref: {dotted_path}")
    module = importlib.import_module(module_name)
    value = getattr(module, class_name, None)
    if not isinstance(value, type):
        raise ToolSpecRegistryError(f"schema ref does not resolve to a class: {dotted_path}")
    return value


def _resolve_tool_spec_path(path: str | Path | None) -> Path:
    if path is not None:
        return Path(path)
    env_path = os.environ.get("SUPERVISOR_API_TOOL_SPEC_PATH", "").strip()
    if env_path:
        return Path(env_path)
    root = _repo_root()
    return root / DEFAULT_TOOL_SPEC_PATH


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / DEFAULT_TOOL_SPEC_PATH).exists():
            return parent
    raise ToolSpecRegistryError("repo root with configs/runtime/tools.v2.json was not found")


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return _mapping(payload, str(path))


def _mapping(value: object, field_name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ToolSpecRegistryError(f"{field_name} must be an object")
    return dict(value)


def _runtime_posture(item: dict[str, Any]) -> str:
    return _required_string(item.get("runtime_posture"), "runtime_posture")


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ToolSpecRegistryError(f"{field_name} must be a non-empty string")
    return normalized


__all__ = [
    "DEFAULT_TOOL_SPEC_PATH",
    "TOOL_SPEC_SCHEMA_VERSION",
    "ToolFunctionSchemaSpec",
    "ToolSpec",
    "ToolSpecAdmission",
    "ToolSpecRegistry",
    "ToolSpecRegistryError",
    "default_tool_spec_registry",
    "load_tool_spec_registry",
]
