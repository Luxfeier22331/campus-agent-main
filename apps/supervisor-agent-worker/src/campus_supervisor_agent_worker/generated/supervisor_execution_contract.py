# AUTO-GENERATED FROM supervisor-execution.openapi.yaml. Do not edit by hand.

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

BRIDGE_VERSION = "supervisor_bridge_v6"
RESPONSE_CONTRACT = "capability_response"
RUNTIME_DECISIONS_SCHEMA_VERSION = "supervisor-runtime-decisions-v1"
RUNTIME_DECISION_SUMMARY_SCHEMA_VERSION = "runtime-decision-summary-v1"
WORKFLOW_TRACE_SUMMARY_VERSION = "workflow-trace-summary-v4"

CapabilityID = Literal[
    "knowledge",
    "navigation",
    "campus_services",
    "notice",
]
RequestedCapability = Literal[
    "knowledge",
    "navigation",
    "campus_services",
    "notice",
]
ConfidenceLevel = Literal[
    "high",
    "medium",
    "low",
]
DelegateStatus = Literal[
    "completed",
    "needs_clarification",
    "no_answer",
    "error",
]
SupervisorStatus = Literal[
    "completed",
    "needs_clarification",
    "no_answer",
    "error",
    "rejected",
    "approval_required",
    "cancelled",
]


WorkflowMode = Literal[
    "terminal",
    "single_step",
    "multi_step",
]
StepOutputProjectionKind = Literal[
    "notice_context",
    "notice_change_set",
    "schedule_baseline",
    "service_guide_facts",
    "place_context",
    "evidence_bundle",
    "grounding_verdict",
]


class RuntimeDecisionSummaryWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[RUNTIME_DECISION_SUMMARY_SCHEMA_VERSION]
    planning_outcome: str
    scope_gate_decision: str = ""
    policy_gate_decision: str = ""
    context_preflight_state: str = ""
    routing_next_action: str = ""
    selected_capability: str = ""
    selected_tool: str = ""
    worker_role: str = ""
    terminal_outcome: str = ""
    fail_close_reason: str = ""
    runtime_versions: dict[str, Any] = Field(default_factory=dict)
    policy_artifact_versions: dict[str, Any] = Field(default_factory=dict)


class WorkflowPlanStepWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step_id: str
    step_kind: str
    capability: str = ""
    worker_role: str = ""
    payload_kind: str = ""
    allowed_tools: list[str] = Field(default_factory=list)
    selected_tool: str = ""


class WorkflowPlanEdgeWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_step_id: str
    to_step_id: str
    condition: str
    required_projection_kind: str = ""


class ProjectionSafetySummaryWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    truncated: bool
    redacted: bool
    max_chars: int
    fields_present: list[str]


class StepOutputProjectionWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    projection_id: str
    source_step_id: str
    projection_kind: StepOutputProjectionKind
    content_hash: str
    payload: dict[str, Any]
    safety: ProjectionSafetySummaryWire


class WorkflowContextProjectionWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    projection_id: str
    source_step_id: str
    projection_kind: StepOutputProjectionKind
    content_hash: str
    safety: ProjectionSafetySummaryWire


class WorkflowCapabilityContextWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["workflow-capability-context-v1"]
    visibility: Literal["capability_private"]
    workflow_run_ref: str
    step_id: str
    capability_id: CapabilityID
    worker_role: str = ""
    required_projection_kind: StepOutputProjectionKind | str = ""
    expected_output_artifacts: list[StepOutputProjectionKind]
    projection_refs: list[WorkflowContextProjectionWire]


class WorkflowPlanWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["workflow-plan-v1"]
    plan_id: str
    workflow_mode: WorkflowMode
    allowed_capabilities: list[CapabilityID]
    steps: list[WorkflowPlanStepWire]
    edges: list[WorkflowPlanEdgeWire]
    terminal_policy: dict[str, Any]
    resume_policy: dict[str, Any]
    semantic_retry_policy: dict[str, Any]


class CapabilityInvocationWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invocation_id: str
    parent_invocation_id: str = ""
    workflow_run_ref: str
    step_id: str
    capability_id: CapabilityID
    status: str
    allowed_tools: list[str]
    used_tools: list[str]
    projection_ids: list[str]
    fail_close_reason: str = ""


class RuntimeDecisionsWire(BaseModel):
    model_config = ConfigDict(extra="allow")

    schema_version: Literal[RUNTIME_DECISIONS_SCHEMA_VERSION]
    effective_capability: RequestedCapability
    lane: str
    routing_frame: dict[str, Any]
    runtime_decision_summary: RuntimeDecisionSummaryWire
    scope_gate: dict[str, Any] = Field(default_factory=dict)
    policy_gate: dict[str, Any] = Field(default_factory=dict)
    context_preflight: dict[str, Any] = Field(default_factory=dict)
    tool_policy: dict[str, Any] = Field(default_factory=dict)
    handoff: dict[str, Any] | None = None
    workflow_plan: WorkflowPlanWire | None = None
    terminal_envelope: dict[str, Any] | None = None


class BridgeV6RequestWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bridge_version: Literal[BRIDGE_VERSION]
    response_contract: Literal[RESPONSE_CONTRACT]
    user_goal: str
    request_id: str
    effective_capability: RequestedCapability
    lane: str
    requested_capability: RequestedCapability
    trace: dict[str, Any]
    actor: dict[str, Any]
    context: dict[str, Any]
    version_query: dict[str, Any]
    runtime_decisions: RuntimeDecisionsWire
    conversation_id: str = ""
    safety_identifier: str | None = None
    requested_scope: dict[str, Any] | None = None


class CapabilityRequestWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capability: CapabilityID
    worker_role: str = ""
    user_goal: str
    payload: dict[str, Any]
    allowed_tools: list[str]
    conversation_id: str = ""
    request_id: str = ""
    safety_identifier: str | None = None
    trace: dict[str, Any] = Field(default_factory=dict)
    actor: dict[str, Any] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)
    workflow_context: WorkflowCapabilityContextWire | None = None


class CapabilityResponseWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capability: CapabilityID
    worker_role: str = ""
    status: DelegateStatus
    answer_text: str = ""
    follow_up_question: str = ""
    confidence: ConfidenceLevel = "low"
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    capability_observability: dict[str, Any] | None = None


class WorkflowTraceSummaryWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    routing_frame: dict[str, Any]
    context_resolution: dict[str, Any]
    planning_outcome: str
    direct_vs_delegate_branch: str
    workflow_mode: WorkflowMode
    handoff: dict[str, Any]
    handoff_chain: list[dict[str, Any]]
    capability_invocations: list[CapabilityInvocationWire]
    selected_capability: str | None
    selected_tools: list[str]
    context_projections: list[WorkflowContextProjectionWire]
    answer_artifact_projection_ids: list[str]
    answer_artifact_kinds: list[StepOutputProjectionKind]
    tool_argument_summary: dict[str, Any]
    guardrail_outcomes: dict[str, Any]
    fail_close_reason: str
    runtime_versions: dict[str, Any]
    policy_artifact_versions: dict[str, Any]
    trace_steps: list[dict[str, Any]] = Field(default_factory=list)
    tool_call_summaries: list[dict[str, Any]] = Field(default_factory=list)


class SupervisorResponseWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selected_capability: CapabilityID | None
    status: SupervisorStatus
    answer_text: str
    follow_up_question: str
    confidence: ConfidenceLevel
    result: dict[str, Any] | None
    error: dict[str, Any] | None
    trace_id: str
    observability: dict[str, Any] | None = None
    workflow_trace_summary: WorkflowTraceSummaryWire | None = None
