from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

WORKFLOW_ARTIFACT_REGISTRY_SCHEMA_VERSION = "workflow-artifact-registry-v1"
DEFAULT_WORKFLOW_ARTIFACT_REGISTRY_PATH = Path("configs/runtime/workflow-artifacts.v1.json")
SUPPORTED_OWNER_AGENTS = {
    "rag-agent",
    "navigation-agent",
    "campus-services-agent",
    "notice-agent",
}
SUPPORTED_VISIBILITIES = {
    "agent_private",
    "operator_safe_summary",
    "finalizer_input",
}
SUPPORTED_PROJECTION_SUPPORT = {
    "supported_go_runtime",
    "contract_only",
    "planned_contract_gap",
}
SUPPORTED_OPENING_GATES = {"open", "closed"}
SUPPORTED_REQUIRED_INPUT_PREFIXES = ("request:", "artifact:")


class WorkflowArtifactRegistryError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class WorkflowArtifact:
    kind: str
    display_name: str
    owner_agent: str
    producer_tools: tuple[str, ...]
    source_truth_owner: str
    visibility: str
    current_projection_support: str
    answer_eligible: bool
    requires_grounding: bool
    freshness_policy: str
    allowed_consumers: tuple[str, ...]
    known_aliases: tuple[str, ...]
    forbidden_raw_payload_keys: tuple[str, ...]
    notes: str


@dataclass(frozen=True, slots=True)
class WorkflowCapabilityBinding:
    binding_id: str
    owner_agent: str
    tool_name: str
    produces: tuple[str, ...]
    consumes: tuple[str, ...]
    required_inputs: tuple[str, ...]
    state_changing: bool
    opening_gate: str
    eval_denominator: tuple[str, ...]
    priority: int
    notes: str


@dataclass(frozen=True, slots=True)
class WorkflowArtifactRegistry:
    schema_version: str
    registry_version: str
    visibility_values: tuple[str, ...]
    support_status_values: tuple[str, ...]
    forbidden_raw_key_tokens: tuple[str, ...]
    artifacts: tuple[WorkflowArtifact, ...]
    bindings: tuple[WorkflowCapabilityBinding, ...]

    def artifact_by_kind(self, kind: str) -> WorkflowArtifact | None:
        normalized = kind.strip()
        for artifact in self.artifacts:
            if artifact.kind == normalized or normalized in artifact.known_aliases:
                return artifact
        return None

    def registered_kind_or_alias(self, kind: str) -> bool:
        return self.artifact_by_kind(kind) is not None


def load_workflow_artifact_registry(
    path: str | Path | None = None,
) -> WorkflowArtifactRegistry:
    registry_path = _resolve_workflow_artifact_registry_path(path)
    raw = _load_json(registry_path)
    if raw.get("schema_version") != WORKFLOW_ARTIFACT_REGISTRY_SCHEMA_VERSION:
        raise WorkflowArtifactRegistryError(
            "workflow artifact registry schema_version must be "
            f"{WORKFLOW_ARTIFACT_REGISTRY_SCHEMA_VERSION}, got {raw.get('schema_version')!r}"
        )
    registry = WorkflowArtifactRegistry(
        schema_version=WORKFLOW_ARTIFACT_REGISTRY_SCHEMA_VERSION,
        registry_version=_required_string(raw.get("registry_version"), "registry_version"),
        visibility_values=_string_tuple(raw.get("visibility_values"), "visibility_values"),
        support_status_values=_string_tuple(
            raw.get("support_status_values"),
            "support_status_values",
        ),
        forbidden_raw_key_tokens=_string_tuple(
            raw.get("forbidden_raw_key_tokens"),
            "forbidden_raw_key_tokens",
        ),
        artifacts=tuple(
            _parse_artifact(item) for item in _required_list(raw.get("artifacts"), "artifacts")
        ),
        bindings=tuple(
            _parse_binding(item) for item in _required_list(raw.get("bindings"), "bindings")
        ),
    )
    _validate_registry(registry)
    return registry


@lru_cache(maxsize=1)
def default_workflow_artifact_registry() -> WorkflowArtifactRegistry:
    return load_workflow_artifact_registry()


def validate_agent_projection_kinds_against_artifacts(
    agent_registry,
    artifact_registry: WorkflowArtifactRegistry,
) -> None:
    for agent in agent_registry.agents:
        for kind in agent.context_projection_kinds:
            if not artifact_registry.registered_kind_or_alias(kind):
                raise WorkflowArtifactRegistryError(
                    f"AgentSpec {agent.agent_id} context_projection_kind {kind!r} "
                    "is outside workflow artifact registry"
                )


def validate_tool_producers_against_artifacts(
    tool_registry,
    artifact_registry: WorkflowArtifactRegistry,
) -> None:
    for artifact in artifact_registry.artifacts:
        for tool_name in artifact.producer_tools:
            tool = tool_registry.tool_by_name(tool_name)
            if tool is None:
                raise WorkflowArtifactRegistryError(
                    f"{artifact.kind} producer tool is missing from ToolSpec: {tool_name}"
                )
            if tool.owner_agent != artifact.owner_agent:
                raise WorkflowArtifactRegistryError(
                    f"{artifact.kind} producer tool {tool_name} owner={tool.owner_agent}, "
                    f"want {artifact.owner_agent}"
                )
            if not tool.read_only:
                raise WorkflowArtifactRegistryError(
                    f"{artifact.kind} producer tool {tool_name} must be read_only"
                )


def validate_capability_bindings(
    agent_registry,
    tool_registry,
    artifact_registry: WorkflowArtifactRegistry,
) -> None:
    artifact_kinds = {artifact.kind for artifact in artifact_registry.artifacts}
    binding_ids: set[str] = set()
    open_producers: dict[str, tuple[str, int]] = {}
    for binding in artifact_registry.bindings:
        if binding.binding_id in binding_ids:
            raise WorkflowArtifactRegistryError(
                f"workflow capability binding duplicate binding_id: {binding.binding_id}"
            )
        binding_ids.add(binding.binding_id)
        agent = agent_registry.agent_by_id(binding.owner_agent)
        if agent is None:
            raise WorkflowArtifactRegistryError(
                f"{binding.binding_id} owner_agent is missing from AgentSpec: {binding.owner_agent}"
            )
        if binding.opening_gate not in SUPPORTED_OPENING_GATES:
            raise WorkflowArtifactRegistryError(
                f"{binding.binding_id} opening_gate is unsupported: {binding.opening_gate}"
            )
        if binding.opening_gate != agent.opening_gate:
            raise WorkflowArtifactRegistryError(
                f"{binding.binding_id} opening_gate={binding.opening_gate} does not match "
                f"AgentSpec {binding.owner_agent} opening_gate={agent.opening_gate}"
            )
        if binding.state_changing:
            raise WorkflowArtifactRegistryError(
                f"{binding.binding_id} must remain read-only in workflow harness"
            )
        if binding.opening_gate == "open" and not binding.tool_name:
            raise WorkflowArtifactRegistryError(
                f"{binding.binding_id} open binding must declare tool_name"
            )
        if binding.tool_name:
            tool = tool_registry.tool_by_name(binding.tool_name)
            if tool is None:
                raise WorkflowArtifactRegistryError(
                    f"{binding.binding_id} tool is missing from ToolSpec: {binding.tool_name}"
                )
            if tool.owner_agent != binding.owner_agent:
                raise WorkflowArtifactRegistryError(
                    f"{binding.binding_id} tool owner={tool.owner_agent}, want {binding.owner_agent}"
                )
            if not tool.read_only:
                raise WorkflowArtifactRegistryError(
                    f"{binding.binding_id} tool {binding.tool_name} must be read_only"
                )
            if binding.opening_gate == "open" and not tool.active:
                raise WorkflowArtifactRegistryError(
                    f"{binding.binding_id} open binding tool {binding.tool_name} must be active"
                )
        for artifact_kind in binding.produces + binding.consumes:
            if artifact_kind not in artifact_kinds:
                raise WorkflowArtifactRegistryError(
                    f"{binding.binding_id} references unknown artifact kind: {artifact_kind}"
                )
        for required_input in binding.required_inputs:
            if not required_input.startswith(SUPPORTED_REQUIRED_INPUT_PREFIXES):
                raise WorkflowArtifactRegistryError(
                    f"{binding.binding_id} required_input is unsupported: {required_input}"
                )
        if not binding.eval_denominator:
            raise WorkflowArtifactRegistryError(
                f"{binding.binding_id} eval_denominator must not be empty"
            )
        if binding.opening_gate != "open":
            continue
        for produced_kind in binding.produces:
            prior = open_producers.get(produced_kind)
            if prior is not None and prior[1] == binding.priority:
                raise WorkflowArtifactRegistryError(
                    f"ambiguous open producer bindings for {produced_kind}: "
                    f"{prior[0]} and {binding.binding_id}"
                )
            if prior is None or binding.priority < prior[1]:
                open_producers[produced_kind] = (binding.binding_id, binding.priority)


def _parse_binding(value: object) -> WorkflowCapabilityBinding:
    item = _mapping(value, "binding")
    return WorkflowCapabilityBinding(
        binding_id=_required_string(item.get("binding_id"), "binding_id"),
        owner_agent=_required_string(item.get("owner_agent"), "owner_agent"),
        tool_name=str(item.get("tool_name") or "").strip(),
        produces=_string_tuple(item.get("produces"), "produces"),
        consumes=_string_tuple(item.get("consumes", []), "consumes"),
        required_inputs=_string_tuple(item.get("required_inputs"), "required_inputs"),
        state_changing=bool(item.get("state_changing")),
        opening_gate=_required_string(item.get("opening_gate"), "opening_gate"),
        eval_denominator=_string_tuple(item.get("eval_denominator"), "eval_denominator"),
        priority=_required_int(item.get("priority"), "priority"),
        notes=str(item.get("notes") or "").strip(),
    )


def _parse_artifact(value: object) -> WorkflowArtifact:
    item = _mapping(value, "artifact")
    return WorkflowArtifact(
        kind=_required_string(item.get("kind"), "kind"),
        display_name=_required_string(item.get("display_name"), "display_name"),
        owner_agent=_required_string(item.get("owner_agent"), "owner_agent"),
        producer_tools=_string_tuple(item.get("producer_tools"), "producer_tools"),
        source_truth_owner=_required_string(item.get("source_truth_owner"), "source_truth_owner"),
        visibility=_required_string(item.get("visibility"), "visibility"),
        current_projection_support=_required_string(
            item.get("current_projection_support"),
            "current_projection_support",
        ),
        answer_eligible=bool(item.get("answer_eligible")),
        requires_grounding=bool(item.get("requires_grounding")),
        freshness_policy=_required_string(item.get("freshness_policy"), "freshness_policy"),
        allowed_consumers=_string_tuple(item.get("allowed_consumers"), "allowed_consumers"),
        known_aliases=_string_tuple(item.get("known_aliases", []), "known_aliases"),
        forbidden_raw_payload_keys=_string_tuple(
            item.get("forbidden_raw_payload_keys"),
            "forbidden_raw_payload_keys",
        ),
        notes=str(item.get("notes") or "").strip(),
    )


def _validate_registry(registry: WorkflowArtifactRegistry) -> None:
    if not registry.artifacts:
        raise WorkflowArtifactRegistryError("workflow artifact artifacts must not be empty")
    raw_tokens = set(registry.forbidden_raw_key_tokens)
    if not raw_tokens:
        raise WorkflowArtifactRegistryError(
            "workflow artifact forbidden_raw_key_tokens must not be empty"
        )
    seen_kinds: set[str] = set()
    seen_aliases: dict[str, str] = {}
    for artifact in registry.artifacts:
        _validate_artifact(artifact, raw_tokens)
        if artifact.kind in seen_kinds:
            raise WorkflowArtifactRegistryError(
                f"workflow artifact duplicate kind: {artifact.kind}"
            )
        seen_kinds.add(artifact.kind)
        for alias in artifact.known_aliases:
            if alias == artifact.kind:
                raise WorkflowArtifactRegistryError(
                    f"{artifact.kind} known_aliases must not include own kind"
                )
            if alias in seen_aliases:
                raise WorkflowArtifactRegistryError(
                    f"workflow artifact alias {alias} is assigned to both "
                    f"{seen_aliases[alias]} and {artifact.kind}"
                )
            seen_aliases[alias] = artifact.kind
    conflicts = set(seen_aliases) & seen_kinds
    if conflicts:
        raise WorkflowArtifactRegistryError(
            f"workflow artifact aliases conflict with artifact kinds: {sorted(conflicts)}"
        )
    if not registry.bindings:
        raise WorkflowArtifactRegistryError("workflow artifact bindings must not be empty")


def _validate_artifact(artifact: WorkflowArtifact, raw_tokens: set[str]) -> None:
    if artifact.owner_agent not in SUPPORTED_OWNER_AGENTS:
        raise WorkflowArtifactRegistryError(
            f"{artifact.kind} owner_agent is unsupported: {artifact.owner_agent}"
        )
    if artifact.visibility not in SUPPORTED_VISIBILITIES:
        raise WorkflowArtifactRegistryError(
            f"{artifact.kind} visibility is unsupported: {artifact.visibility}"
        )
    if artifact.current_projection_support not in SUPPORTED_PROJECTION_SUPPORT:
        raise WorkflowArtifactRegistryError(
            f"{artifact.kind} current_projection_support is unsupported: "
            f"{artifact.current_projection_support}"
        )
    if not artifact.allowed_consumers:
        raise WorkflowArtifactRegistryError(f"{artifact.kind} allowed_consumers must not be empty")
    if not artifact.forbidden_raw_payload_keys:
        raise WorkflowArtifactRegistryError(
            f"{artifact.kind} forbidden_raw_payload_keys must not be empty"
        )
    for key in artifact.forbidden_raw_payload_keys:
        if key not in raw_tokens:
            raise WorkflowArtifactRegistryError(
                f"{artifact.kind} forbidden raw key is outside global tokens: {key}"
            )
    if artifact.kind == "grounding_verdict" and artifact.answer_eligible:
        raise WorkflowArtifactRegistryError("grounding_verdict must not be answer eligible")


def _resolve_workflow_artifact_registry_path(path: str | Path | None) -> Path:
    if path is not None:
        return Path(path)
    env_path = os.environ.get("EXECUTION_CONTROL_WORKFLOW_ARTIFACT_REGISTRY_PATH", "").strip()
    if env_path:
        return Path(env_path)
    root = _repo_root()
    return root / DEFAULT_WORKFLOW_ARTIFACT_REGISTRY_PATH


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / DEFAULT_WORKFLOW_ARTIFACT_REGISTRY_PATH).exists():
            return parent
    raise WorkflowArtifactRegistryError(
        "repo root with configs/runtime/workflow-artifacts.v1.json was not found"
    )


def _load_json(path: Path) -> dict[str, object]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise WorkflowArtifactRegistryError(
            f"workflow artifact registry not found: {path}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise WorkflowArtifactRegistryError(
            f"workflow artifact registry is not valid JSON: {path}"
        ) from exc
    return _mapping(raw, str(path))


def _mapping(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise WorkflowArtifactRegistryError(f"{field_name} must be an object")
    return value


def _required_list(value: object, field_name: str) -> list[object]:
    if not isinstance(value, list) or not value:
        raise WorkflowArtifactRegistryError(f"{field_name} must be a non-empty list")
    return value


def _required_string(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise WorkflowArtifactRegistryError(f"{field_name} must be a non-empty string")
    return value.strip()


def _string_tuple(value: object, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise WorkflowArtifactRegistryError(f"{field_name} must be a list")
    result: list[str] = []
    for item in value:
        result.append(_required_string(item, field_name))
    return tuple(result)


def _required_int(value: object, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise WorkflowArtifactRegistryError(f"{field_name} must be an integer")
    return value
