from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from campus_contracts import ALLOWED_AGENT_TARGETS, ALLOWED_REQUESTED_CAPABILITIES

AGENT_SPEC_SCHEMA_VERSION = "agent-spec-registry-v2"
DEFAULT_AGENT_SPEC_PATH = Path("configs/runtime/agents.v2.json")


class AgentSpecRegistryError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class AgentSpec:
    agent_id: str
    capability: str
    owner_package: str
    runtime_adapter: str
    active: bool
    opening_gate: str
    allowed_structured_handoff_tools: tuple[str, ...]
    context_projection_kinds: tuple[str, ...]
    description: str


@dataclass(frozen=True, slots=True)
class AgentSpecRegistry:
    schema_version: str
    registry_version: str
    agents: tuple[AgentSpec, ...]

    def agent_by_id(self, agent_id: str) -> AgentSpec | None:
        for agent in self.agents:
            if agent.agent_id == agent_id:
                return agent
        return None

    def known_agent_ids(self) -> tuple[str, ...]:
        return tuple(agent.agent_id for agent in self.agents)

    def active_agent_ids(self) -> tuple[str, ...]:
        return tuple(agent.agent_id for agent in self.agents if agent.active)

def load_agent_spec_registry(path: str | Path | None = None) -> AgentSpecRegistry:
    registry_path = _resolve_agent_spec_path(path)
    raw = _load_json(registry_path)
    if raw.get("schema_version") != AGENT_SPEC_SCHEMA_VERSION:
        raise AgentSpecRegistryError(
            "agent spec schema_version must be "
            f"{AGENT_SPEC_SCHEMA_VERSION}, got {raw.get('schema_version')!r}"
        )
    registry_version = _required_string(raw.get("registry_version"), "registry_version")
    raw_agents = raw.get("agents")
    if not isinstance(raw_agents, list) or not raw_agents:
        raise AgentSpecRegistryError("agent spec agents must be a non-empty list")
    agents = tuple(_parse_agent(item) for item in raw_agents)
    _validate_agents(agents)
    return AgentSpecRegistry(
        schema_version=AGENT_SPEC_SCHEMA_VERSION,
        registry_version=registry_version,
        agents=agents,
    )


@lru_cache(maxsize=1)
def default_agent_spec_registry() -> AgentSpecRegistry:
    return load_agent_spec_registry()


def _parse_agent(value: object) -> AgentSpec:
    item = _mapping(value, "agent")
    return AgentSpec(
        agent_id=_required_string(item.get("id"), "id"),
        capability=_required_string(item.get("capability"), "capability"),
        owner_package=_required_string(item.get("owner_package"), "owner_package"),
        runtime_adapter=_required_string(item.get("runtime_adapter"), "runtime_adapter"),
        active=bool(item.get("active")),
        opening_gate=_required_string(item.get("opening_gate"), "opening_gate"),
        allowed_structured_handoff_tools=_string_tuple(
            item.get("allowed_structured_handoff_tools"),
            "allowed_structured_handoff_tools",
        ),
        context_projection_kinds=_string_tuple(
            item.get("context_projection_kinds"),
            "context_projection_kinds",
        ),
        description=_required_string(item.get("description"), "description"),
    )


def _validate_agents(agents: tuple[AgentSpec, ...]) -> None:
    seen: set[str] = set()
    capability_seen: set[str] = set()
    for agent in agents:
        if agent.agent_id in seen:
            raise AgentSpecRegistryError(f"duplicate AgentSpec id: {agent.agent_id}")
        seen.add(agent.agent_id)
        if agent.agent_id not in ALLOWED_AGENT_TARGETS:
            raise AgentSpecRegistryError(f"unsupported AgentSpec id: {agent.agent_id}")
        if agent.capability not in ALLOWED_REQUESTED_CAPABILITIES:
            raise AgentSpecRegistryError(
                f"{agent.agent_id} capability is unsupported: {agent.capability}"
            )
        if agent.capability in capability_seen:
            raise AgentSpecRegistryError(
                f"duplicate AgentSpec capability assignment: {agent.capability}"
            )
        capability_seen.add(agent.capability)
        if agent.runtime_adapter != "worker_dispatch":
            raise AgentSpecRegistryError(
                f"{agent.agent_id} runtime_adapter is unsupported: {agent.runtime_adapter}"
            )
        if agent.opening_gate not in {"open", "closed"}:
            raise AgentSpecRegistryError(
                f"{agent.agent_id} opening_gate is unsupported: {agent.opening_gate}"
            )
        if agent.agent_id == "rag-agent" and agent.allowed_structured_handoff_tools:
            raise AgentSpecRegistryError("rag-agent must not expose structured handoff tools")
        if agent.agent_id == "notice-agent" and "campus_notice_get" in agent.allowed_structured_handoff_tools:
            raise AgentSpecRegistryError(
                "notice-agent must not expose campus_notice_get as structured handoff tool"
            )
        if agent.opening_gate == "closed" and agent.active:
            raise AgentSpecRegistryError(
                f"{agent.agent_id} closed opening_gate cannot be active"
            )


def _resolve_agent_spec_path(path: str | Path | None) -> Path:
    if path is not None:
        return Path(path)
    env_path = os.environ.get("SUPERVISOR_API_AGENT_SPEC_PATH", "").strip()
    if env_path:
        return Path(env_path)
    root = _repo_root()
    return root / DEFAULT_AGENT_SPEC_PATH


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / DEFAULT_AGENT_SPEC_PATH).exists():
            return parent
    raise AgentSpecRegistryError("repo root with configs/runtime/agents.v2.json was not found")


def _load_json(path: Path) -> dict[str, object]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise AgentSpecRegistryError(f"agent spec registry not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise AgentSpecRegistryError(f"agent spec registry is not valid JSON: {path}") from exc
    if not isinstance(raw, dict):
        raise AgentSpecRegistryError("agent spec registry root must be an object")
    return raw


def _mapping(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise AgentSpecRegistryError(f"{field_name} must be an object")
    return value


def _required_string(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AgentSpecRegistryError(f"{field_name} must be a non-empty string")
    return value.strip()


def _string_tuple(value: object, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise AgentSpecRegistryError(f"{field_name} must be a list")
    result: list[str] = []
    for item in value:
        result.append(_required_string(item, field_name))
    return tuple(result)
