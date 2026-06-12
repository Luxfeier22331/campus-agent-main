from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from campus_contracts import ALLOWED_CAPABILITY_IDS, ALLOWED_REQUESTED_CAPABILITIES

CAPABILITY_SPEC_SCHEMA_VERSION = "capability-spec-registry-v1"
DEFAULT_CAPABILITY_SPEC_PATH = Path("configs/runtime/capabilities.v1.json")


class CapabilitySpecRegistryError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class CapabilitySpec:
    capability_id: str
    owner_package: str
    worker_role: str
    runtime_adapter: str
    active: bool
    opening_gate: str
    allowed_structured_handoff_tools: tuple[str, ...]
    context_projection_kinds: tuple[str, ...]
    description: str


@dataclass(frozen=True, slots=True)
class CapabilitySpecRegistry:
    schema_version: str
    registry_version: str
    capabilities: tuple[CapabilitySpec, ...]

    def capability_by_id(self, capability_id: str) -> CapabilitySpec | None:
        for capability in self.capabilities:
            if capability.capability_id == capability_id:
                return capability
        return None

    def known_capability_ids(self) -> tuple[str, ...]:
        return tuple(capability.capability_id for capability in self.capabilities)

    def active_capability_ids(self) -> tuple[str, ...]:
        return tuple(
            capability.capability_id for capability in self.capabilities if capability.active
        )


def load_capability_spec_registry(path: str | Path | None = None) -> CapabilitySpecRegistry:
    registry_path = _resolve_capability_spec_path(path)
    raw = _load_json(registry_path)
    if raw.get("schema_version") != CAPABILITY_SPEC_SCHEMA_VERSION:
        raise CapabilitySpecRegistryError(
            "capability spec schema_version must be "
            f"{CAPABILITY_SPEC_SCHEMA_VERSION}, got {raw.get('schema_version')!r}"
        )
    registry_version = _required_string(raw.get("registry_version"), "registry_version")
    raw_capabilities = raw.get("capabilities")
    if not isinstance(raw_capabilities, list) or not raw_capabilities:
        raise CapabilitySpecRegistryError(
            "capability spec capabilities must be a non-empty list"
        )
    capabilities = tuple(_parse_capability(item) for item in raw_capabilities)
    _validate_capabilities(capabilities)
    return CapabilitySpecRegistry(
        schema_version=CAPABILITY_SPEC_SCHEMA_VERSION,
        registry_version=registry_version,
        capabilities=capabilities,
    )


@lru_cache(maxsize=1)
def default_capability_spec_registry() -> CapabilitySpecRegistry:
    return load_capability_spec_registry()


def _parse_capability(value: object) -> CapabilitySpec:
    item = _mapping(value, "capability")
    return CapabilitySpec(
        capability_id=_required_string(item.get("id"), "id"),
        owner_package=_required_string(item.get("owner_package"), "owner_package"),
        worker_role=_required_string(item.get("worker_role"), "worker_role"),
        runtime_adapter=_required_string(item.get("runtime_adapter"), "runtime_adapter"),
        active=bool(item.get("active")),
        opening_gate=_required_string(item.get("opening_gate"), "opening_gate"),
        allowed_structured_handoff_tools=_string_tuple(
            item.get("allowed_structured_tools"),
            "allowed_structured_tools",
        ),
        context_projection_kinds=_string_tuple(
            item.get("context_projection_kinds"),
            "context_projection_kinds",
        ),
        description=_required_string(item.get("description"), "description"),
    )


def _validate_capabilities(capabilities: tuple[CapabilitySpec, ...]) -> None:
    seen: set[str] = set()
    for capability in capabilities:
        if capability.capability_id in seen:
            raise CapabilitySpecRegistryError(
                f"duplicate CapabilitySpec id: {capability.capability_id}"
            )
        seen.add(capability.capability_id)
        if capability.capability_id not in ALLOWED_CAPABILITY_IDS:
            raise CapabilitySpecRegistryError(
                f"unsupported CapabilitySpec id: {capability.capability_id}"
            )
        if capability.capability_id not in ALLOWED_REQUESTED_CAPABILITIES:
            raise CapabilitySpecRegistryError(
                f"{capability.capability_id} capability is unsupported"
            )
        if capability.runtime_adapter != "temporal_activity_worker":
            raise CapabilitySpecRegistryError(
                f"{capability.capability_id} runtime_adapter is unsupported: "
                f"{capability.runtime_adapter}"
            )
        if not capability.worker_role.startswith("activity-worker-"):
            raise CapabilitySpecRegistryError(
                f"{capability.capability_id} worker_role is unsupported: "
                f"{capability.worker_role}"
            )
        if capability.opening_gate not in {"open", "closed"}:
            raise CapabilitySpecRegistryError(
                f"{capability.capability_id} opening_gate is unsupported: "
                f"{capability.opening_gate}"
            )
        if capability.capability_id == "knowledge" and capability.allowed_structured_handoff_tools:
            raise CapabilitySpecRegistryError("knowledge must not expose structured handoff tools")
        if (
            capability.capability_id == "notice"
            and "campus_notice_get" in capability.allowed_structured_handoff_tools
        ):
            raise CapabilitySpecRegistryError(
                "notice must not expose campus_notice_get as structured handoff tool"
            )
        if capability.opening_gate == "closed" and capability.active:
            raise CapabilitySpecRegistryError(
                f"{capability.capability_id} closed opening_gate cannot be active"
            )


def _resolve_capability_spec_path(path: str | Path | None) -> Path:
    if path is not None:
        return Path(path)
    env_path = os.environ.get("EXECUTION_CONTROL_CAPABILITY_SPEC_PATH", "").strip()
    if env_path:
        return Path(env_path)
    root = _repo_root()
    return root / DEFAULT_CAPABILITY_SPEC_PATH


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / DEFAULT_CAPABILITY_SPEC_PATH).exists():
            return parent
    raise CapabilitySpecRegistryError(
        "repo root with configs/runtime/capabilities.v1.json was not found"
    )


def _load_json(path: Path) -> dict[str, object]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CapabilitySpecRegistryError(f"capability spec registry not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise CapabilitySpecRegistryError(
            f"capability spec registry is not valid JSON: {path}"
        ) from exc
    if not isinstance(raw, dict):
        raise CapabilitySpecRegistryError("capability spec registry root must be an object")
    return raw


def _mapping(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise CapabilitySpecRegistryError(f"{field_name} must be an object")
    return value


def _required_string(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CapabilitySpecRegistryError(f"{field_name} must be a non-empty string")
    return value.strip()


def _string_tuple(value: object, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise CapabilitySpecRegistryError(f"{field_name} must be a list")
    result: list[str] = []
    for item in value:
        result.append(_required_string(item, field_name))
    return tuple(result)
