from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from campus_contracts import AgentRequest, WorkflowAgentContext

from campus_supervisor_agent_worker.generated.supervisor_execution_contract import (
    WorkflowPlanWire,
)
from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpecRegistry,
    ToolSpecRegistryError,
    default_tool_spec_registry,
)

WORKFLOW_PLAN_ERROR_SCHEMA_VERSION = "openai-agents-workflow-plan-error-v1"
SUPPORTED_WORKFLOW_MODES = frozenset({"single_step", "multi_step"})


class OpenAIAgentsWorkflowPlanError(ValueError):
    def __init__(self, failure_class: str, message: str) -> None:
        super().__init__(f"{failure_class}: {message}")
        self.failure_class = failure_class
        self.message = message


@dataclass(frozen=True, slots=True)
class OpenAIAgentsWorkflowStepPlan:
    step_id: str
    execution_mode: str
    target: str
    payload_kind: str
    allowed_tools: tuple[str, ...] = field(default_factory=tuple)
    selected_tool: str = ""
    required_projection_kind: str = ""
    expected_output_artifacts: tuple[str, ...] = field(default_factory=tuple)
    depends_on_step_ids: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class OpenAIAgentsWorkflowExecutionPlan:
    plan_id: str
    workflow_mode: str
    steps: tuple[OpenAIAgentsWorkflowStepPlan, ...]
    resume_supported: bool
    max_replans: int

    @property
    def selected_step(self) -> OpenAIAgentsWorkflowStepPlan:
        if not self.steps:
            raise OpenAIAgentsWorkflowPlanError(
                "plan_not_admitted",
                "Go WorkflowPlan contains no executable steps",
            )
        return self.steps[0]


def compile_openai_agents_workflow_plan(
    workflow_plan: WorkflowPlanWire | dict[str, Any],
    *,
    agent_request: AgentRequest,
    tool_registry: ToolSpecRegistry | None = None,
) -> OpenAIAgentsWorkflowExecutionPlan:
    wire = _coerce_workflow_plan(workflow_plan)
    if wire.workflow_mode not in SUPPORTED_WORKFLOW_MODES:
        raise _plan_error(
            "plan_not_admitted",
            f"unsupported WorkflowPlan mode for SDK execution: {wire.workflow_mode}",
        )
    if not wire.steps:
        raise _plan_error("plan_not_admitted", "WorkflowPlan.steps must not be empty")
    if not wire.allowed_agents:
        raise _plan_error("plan_not_admitted", "WorkflowPlan.allowed_agents must not be empty")
    step_inputs = _dependency_inputs_by_step(wire)
    expected_artifacts = _expected_artifacts_by_step(wire)
    resolved_tool_registry = tool_registry or default_tool_spec_registry()
    steps = tuple(
        _compile_step(
            step,
            allowed_agents=tuple(wire.allowed_agents),
            required_projection_kind=step_inputs.get(step.step_id, ("", ()))[0],
            depends_on_step_ids=step_inputs.get(step.step_id, ("", ()))[1],
            expected_output_artifacts=expected_artifacts.get(step.step_id, ()),
            tool_registry=resolved_tool_registry,
        )
        for step in wire.steps
    )
    execution_plan = OpenAIAgentsWorkflowExecutionPlan(
        plan_id=wire.plan_id,
        workflow_mode=wire.workflow_mode,
        steps=steps,
        resume_supported=bool(wire.resume_policy.get("resume_supported")),
        max_replans=max(0, int(wire.semantic_retry_policy.get("max_replans") or 0)),
    )
    _validate_agent_request_matches_compiled_plan(agent_request, execution_plan)
    return execution_plan


def validate_agent_request_against_workflow_plan(
    agent_request: AgentRequest,
    *,
    tool_registry: ToolSpecRegistry | None = None,
) -> OpenAIAgentsWorkflowStepPlan:
    context = agent_request.workflow_context
    _require_go_workflow_context(context)
    resolved_registry = tool_registry or default_tool_spec_registry()
    expected_payload_kind = _payload_kind_for_request(agent_request, resolved_registry)
    if context.target and context.target != agent_request.target:
        raise _plan_error(
            "plan_not_admitted",
            "AgentRequest.workflow_context.target must match AgentRequest.target",
        )
    if context.agent_id != agent_request.target:
        raise _plan_error(
            "plan_not_admitted",
            "AgentRequest.workflow_context.agent_id must match AgentRequest.target",
        )
    expected_step_id = _step_id(agent_request.target, expected_payload_kind)
    if context.step_id != expected_step_id:
        raise _plan_error(
            "plan_not_admitted",
            f"AgentRequest.workflow_context.step_id must be {expected_step_id}",
        )
    return OpenAIAgentsWorkflowStepPlan(
        step_id=context.step_id,
        execution_mode=_execution_mode_for_request(
            agent_request,
            payload_kind=expected_payload_kind,
            tool_registry=resolved_registry,
        ),
        target=agent_request.target,
        payload_kind=expected_payload_kind,
        allowed_tools=tuple(agent_request.allowed_tools),
        selected_tool=agent_request.allowed_tools[0]
        if len(agent_request.allowed_tools) == 1
        else "",
        required_projection_kind=context.required_projection_kind,
        expected_output_artifacts=tuple(context.expected_output_artifacts),
        depends_on_step_ids=tuple(
            str(item.get("source_step_id") or "").strip()
            for item in context.projection_refs
            if str(item.get("source_step_id") or "").strip()
        ),
    )


def _coerce_workflow_plan(workflow_plan: WorkflowPlanWire | dict[str, Any]) -> WorkflowPlanWire:
    if isinstance(workflow_plan, WorkflowPlanWire):
        return workflow_plan
    try:
        return WorkflowPlanWire.model_validate(workflow_plan)
    except Exception as exc:
        raise _plan_error("plan_not_admitted", f"WorkflowPlan validation failed: {exc}") from exc


def _compile_step(
    step,
    *,
    allowed_agents: tuple[str, ...],
    required_projection_kind: str,
    depends_on_step_ids: tuple[str, ...],
    expected_output_artifacts: tuple[str, ...],
    tool_registry: ToolSpecRegistry,
) -> OpenAIAgentsWorkflowStepPlan:
    if step.step_kind != "handoff":
        raise _plan_error(
            "plan_not_admitted",
            f"WorkflowPlan step_kind must be handoff for SDK execution: {step.step_kind}",
        )
    if step.target not in allowed_agents:
        raise _plan_error(
            "plan_not_admitted",
            f"WorkflowPlan step target is outside allowed_agents: {step.target}",
        )
    if not str(step.payload_kind or "").strip():
        raise _plan_error(
            "plan_not_admitted", f"WorkflowPlan step {step.step_id} lacks payload_kind"
        )
    expected_step_id = _step_id(step.target, step.payload_kind)
    if step.step_id != expected_step_id:
        raise _plan_error(
            "plan_not_admitted",
            f"WorkflowPlan step_id must be {expected_step_id}",
        )
    if not tool_registry.payload_kind_belongs_to_target(step.target, step.payload_kind):
        raise _plan_error(
            "plan_not_admitted",
            f"WorkflowPlan step payload_kind is outside ToolSpec target boundary: {step.payload_kind}",
        )
    allowed_tools = tuple(str(tool).strip() for tool in step.allowed_tools if str(tool).strip())
    _validate_allowed_tools_for_step(
        target=step.target,
        payload_kind=step.payload_kind,
        allowed_tools=allowed_tools,
        selected_tool=str(step.selected_tool or "").strip(),
        tool_registry=tool_registry,
    )
    return OpenAIAgentsWorkflowStepPlan(
        step_id=step.step_id,
        execution_mode=_execution_mode_for_step(
            target=step.target,
            payload_kind=step.payload_kind,
            allowed_tools=allowed_tools,
            tool_registry=tool_registry,
        ),
        target=step.target,
        payload_kind=step.payload_kind,
        allowed_tools=allowed_tools,
        selected_tool=str(step.selected_tool or "").strip(),
        required_projection_kind=required_projection_kind,
        expected_output_artifacts=expected_output_artifacts,
        depends_on_step_ids=depends_on_step_ids,
    )


def _validate_allowed_tools_for_step(
    *,
    target: str,
    payload_kind: str,
    allowed_tools: tuple[str, ...],
    selected_tool: str,
    tool_registry: ToolSpecRegistry,
) -> None:
    tool = _tool_for_payload_kind(target, payload_kind, tool_registry)
    if tool.surface == "structured_handoff":
        if allowed_tools != (tool.name,):
            raise _plan_error(
                "tool_not_admitted",
                f"WorkflowPlan step allowed_tools must be exactly {(tool.name,)!r}",
            )
        if selected_tool and selected_tool != tool.name:
            raise _plan_error(
                "tool_not_admitted",
                "WorkflowPlan selected_tool must match structured handoff tool",
            )
        return
    if tool.surface == "agent_internal":
        if allowed_tools:
            raise _plan_error(
                "tool_not_admitted",
                "WorkflowPlan agent_internal steps must not expose allowed_tools",
            )
        return
    raise _plan_error(
        "tool_not_admitted",
        f"unsupported ToolSpec surface for WorkflowPlan step: {tool.surface}",
    )


def _execution_mode_for_request(
    request: AgentRequest,
    *,
    payload_kind: str,
    tool_registry: ToolSpecRegistry,
) -> str:
    return _execution_mode_for_step(
        target=request.target,
        payload_kind=payload_kind,
        allowed_tools=tuple(request.allowed_tools),
        tool_registry=tool_registry,
    )


def _execution_mode_for_step(
    *,
    target: str,
    payload_kind: str,
    allowed_tools: tuple[str, ...],
    tool_registry: ToolSpecRegistry,
) -> str:
    tool = _tool_for_payload_kind(target, payload_kind, tool_registry)
    if tool.surface == "agent_internal" and tool.runtime_posture == "internal_function":
        return "internal_function"
    if allowed_tools:
        return "sdk_agent_execution"
    if target == "rag-agent":
        return "sdk_agent_execution"
    raise _plan_error(
        "plan_not_admitted",
        f"WorkflowPlan step is not executable by SDK runtime: {target}/{payload_kind}",
    )


def _validate_agent_request_matches_compiled_plan(
    request: AgentRequest,
    execution_plan: OpenAIAgentsWorkflowExecutionPlan,
) -> None:
    context = request.workflow_context
    _require_go_workflow_context(context)
    matching_step = next(
        (
            step
            for step in execution_plan.steps
            if step.step_id == context.step_id and step.target == request.target
        ),
        None,
    )
    if matching_step is None:
        raise _plan_error(
            "plan_not_admitted",
            "AgentRequest.workflow_context.step_id is not admitted by Go WorkflowPlan",
        )
    if matching_step.allowed_tools != tuple(request.allowed_tools):
        raise _plan_error(
            "tool_not_admitted",
            "AgentRequest.allowed_tools must match Go WorkflowPlan step allowed_tools",
        )
    if context.agent_id != matching_step.target:
        raise _plan_error(
            "plan_not_admitted",
            "AgentRequest.workflow_context.agent_id must match Go WorkflowPlan step target",
        )
    if context.target and context.target != matching_step.target:
        raise _plan_error(
            "plan_not_admitted",
            "AgentRequest.workflow_context.target must match Go WorkflowPlan step target",
        )
    if context.required_projection_kind != matching_step.required_projection_kind:
        raise _plan_error(
            "projection_kind_not_admitted",
            "AgentRequest.required_projection_kind must match Go WorkflowPlan edge",
        )
    if (
        matching_step.expected_output_artifacts
        and tuple(context.expected_output_artifacts) != matching_step.expected_output_artifacts
    ):
        raise _plan_error(
            "plan_not_admitted",
            "AgentRequest.expected_output_artifacts must match Go WorkflowPlan step",
        )
    if matching_step.required_projection_kind and not any(
        str(item.get("projection_kind") or "").strip() == matching_step.required_projection_kind
        for item in context.projection_refs
    ):
        raise _plan_error(
            "projection_kind_not_admitted",
            "AgentRequest projection_refs do not include the Go-required projection kind",
        )


def _require_go_workflow_context(context: WorkflowAgentContext) -> None:
    if not (
        context.workflow_run_ref.strip() and context.step_id.strip() and context.agent_id.strip()
    ):
        raise _plan_error(
            "plan_not_admitted",
            "AgentRequest.workflow_context from Go WorkflowPlan is required",
        )


def _dependency_inputs_by_step(
    wire: WorkflowPlanWire,
) -> dict[str, tuple[str, tuple[str, ...]]]:
    inputs: dict[str, tuple[str, tuple[str, ...]]] = {}
    for edge in wire.edges:
        required_kind = str(edge.required_projection_kind or "").strip()
        source_step = str(edge.from_step_id or "").strip()
        target_step = str(edge.to_step_id or "").strip()
        if not source_step or not target_step:
            raise _plan_error("plan_not_admitted", "WorkflowPlan edge step ids are required")
        previous_kind, previous_sources = inputs.get(target_step, ("", ()))
        if previous_kind and required_kind and previous_kind != required_kind:
            raise _plan_error(
                "projection_kind_not_admitted",
                f"WorkflowPlan step {target_step} has conflicting required projection kinds",
            )
        inputs[target_step] = (required_kind or previous_kind, (*previous_sources, source_step))
    return inputs


def _expected_artifacts_by_step(wire: WorkflowPlanWire) -> dict[str, tuple[str, ...]]:
    by_step: dict[str, tuple[str, ...]] = {}
    for step in wire.steps:
        by_step[step.step_id] = _expected_artifacts_for_step(step.target, step.payload_kind)
    return by_step


def _expected_artifacts_for_step(target: str, payload_kind: str) -> tuple[str, ...]:
    if target == "notice-agent" and payload_kind == "campus_notice_get":
        return ("notice_context",)
    if target == "notice-agent" and payload_kind == "campus_notice_change_set_lookup":
        return ("notice_change_set",)
    if target == "campus-services-agent" and payload_kind == "transport_schedule_lookup":
        return ("schedule_baseline",)
    if target == "rag-agent" and payload_kind == "rag_request":
        return ("evidence_bundle", "grounding_verdict")
    return ()


def _payload_kind_for_request(request: AgentRequest, registry: ToolSpecRegistry) -> str:
    try:
        return registry.payload_kind_for_request(request.target, request.payload)
    except ToolSpecRegistryError as exc:
        raise _plan_error("plan_not_admitted", str(exc)) from exc


def _tool_for_payload_kind(target: str, payload_kind: str, registry: ToolSpecRegistry):
    matches = tuple(
        tool
        for tool in registry.tools
        if tool.active and tool.owner_agent == target and tool.payload_kind == payload_kind
    )
    if not matches:
        raise _plan_error(
            "plan_not_admitted",
            f"payload_kind is outside active ToolSpec boundary: {target}/{payload_kind}",
        )
    return matches[0]


def _step_id(target: str, payload_kind: str) -> str:
    return f"handoff:{target}:{payload_kind}"


def _plan_error(failure_class: str, message: str) -> OpenAIAgentsWorkflowPlanError:
    return OpenAIAgentsWorkflowPlanError(failure_class, message)


__all__ = [
    "WORKFLOW_PLAN_ERROR_SCHEMA_VERSION",
    "OpenAIAgentsWorkflowExecutionPlan",
    "OpenAIAgentsWorkflowPlanError",
    "OpenAIAgentsWorkflowStepPlan",
    "compile_openai_agents_workflow_plan",
    "validate_agent_request_against_workflow_plan",
]
