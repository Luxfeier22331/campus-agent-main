# AUTO-GENERATED FROM supervisor-execution.openapi.yaml. Do not edit by hand.

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

BRIDGE_VERSION = "supervisor_bridge_v6"
RESPONSE_CONTRACT = "agent_response"
RUNTIME_DECISIONS_SCHEMA_VERSION = "supervisor-runtime-decisions-v1"
RUNTIME_DECISION_SUMMARY_SCHEMA_VERSION = "runtime-decision-summary-v1"
WORKFLOW_TRACE_SUMMARY_VERSION = "workflow-trace-summary-v2"

AgentTarget = Literal[
    "rag-agent",
    "navigation-agent",
    "campus-services-agent",
    "notice-agent",
]
RequestedCapability = Literal[
    "knowledge",
    "place_lookup",
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


class RuntimeDecisionSummaryWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[RUNTIME_DECISION_SUMMARY_SCHEMA_VERSION]
    planning_outcome: str
    scope_gate_decision: str = ""
    policy_gate_decision: str = ""
    context_preflight_state: str = ""
    routing_next_action: str = ""
    selected_target: str = ""
    selected_tool: str = ""
    terminal_outcome: str = ""
    fail_close_reason: str = ""
    runtime_versions: dict[str, Any] = Field(default_factory=dict)
    policy_artifact_versions: dict[str, Any] = Field(default_factory=dict)


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


class AgentResponseWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: AgentTarget
    status: DelegateStatus
    answer_text: str = ""
    follow_up_question: str = ""
    confidence: ConfidenceLevel = "low"
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    agent_observability: dict[str, Any] | None = None


class WorkflowTraceSummaryWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    routing_frame: dict[str, Any]
    context_resolution: dict[str, Any]
    planning_outcome: str
    direct_vs_delegate_branch: str
    workflow_mode: str
    handoff: dict[str, Any]
    handoff_chain: list[dict[str, Any]]
    selected_target: str | None
    selected_tools: list[str]
    tool_argument_summary: dict[str, Any]
    guardrail_outcomes: dict[str, Any]
    fail_close_reason: str
    runtime_versions: dict[str, Any]
    policy_artifact_versions: dict[str, Any]
    trace_steps: list[dict[str, Any]] = Field(default_factory=list)
    tool_call_summaries: list[dict[str, Any]] = Field(default_factory=list)


class SupervisorResponseWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selected_target: AgentTarget | None
    status: SupervisorStatus
    answer_text: str
    follow_up_question: str
    confidence: ConfidenceLevel
    result: dict[str, Any] | None
    error: dict[str, Any] | None
    trace_id: str
    observability: dict[str, Any] | None = None
    workflow_trace_summary: WorkflowTraceSummaryWire | None = None
