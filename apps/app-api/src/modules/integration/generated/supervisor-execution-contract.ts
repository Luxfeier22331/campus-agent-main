/* AUTO-GENERATED FROM supervisor-execution.openapi.yaml. Do not edit by hand. */

export const SUPERVISOR_EXECUTION_CONTRACT = {
	bridgeVersion: "supervisor_bridge_v6",
	responseContract: "agent_response",
	runtimeDecisionsSchemaVersion: "supervisor-runtime-decisions-v1",
	runtimeDecisionSummarySchemaVersion: "runtime-decision-summary-v1",
	workflowTraceSummaryVersion: "workflow-trace-summary-v4",
} as const;

export const AGENT_TARGETS = [
	"rag-agent",
	"navigation-agent",
	"campus-services-agent",
	"notice-agent",
] as const;
export const REQUESTED_CAPABILITIES = [
	"knowledge",
	"place_lookup",
	"campus_services",
	"notice",
] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const DELEGATE_STATUSES = [
	"completed",
	"needs_clarification",
	"no_answer",
	"error",
] as const;
export const SUPERVISOR_STATUSES = [
	"completed",
	"needs_clarification",
	"no_answer",
	"error",
	"rejected",
	"approval_required",
	"cancelled",
] as const;
export const WORKFLOW_MODES = ["terminal", "single_step", "multi_step"] as const;
export const STEP_OUTPUT_PROJECTION_KINDS = [
	"notice_context",
	"notice_change_set",
	"schedule_baseline",
	"service_guide_facts",
	"place_context",
	"evidence_bundle",
	"grounding_verdict",
] as const;

export type AgentTarget = (typeof AGENT_TARGETS)[number];
export type RequestedCapability = (typeof REQUESTED_CAPABILITIES)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type DelegateStatus = (typeof DELEGATE_STATUSES)[number];
export type SupervisorStatus = (typeof SUPERVISOR_STATUSES)[number];

export type WorkflowMode = (typeof WORKFLOW_MODES)[number];
export type StepOutputProjectionKind = (typeof STEP_OUTPUT_PROJECTION_KINDS)[number];

export type SafeRecord = Record<string, unknown>;

export interface RuntimeDecisionSummaryWire {
	schema_version: typeof SUPERVISOR_EXECUTION_CONTRACT.runtimeDecisionSummarySchemaVersion;
	scope_gate_decision?: string;
	policy_gate_decision?: string;
	context_preflight_state?: string;
	routing_next_action?: string;
	planning_outcome: string;
	selected_target?: string;
	selected_tool?: string;
	terminal_outcome?: string;
	fail_close_reason?: string;
	runtime_versions?: SafeRecord;
	policy_artifact_versions?: SafeRecord;
}

export interface WorkflowPlanStepWire {
	step_id: string;
	step_kind: string;
	target?: string;
	payload_kind?: string;
	allowed_tools?: string[];
	selected_tool?: string;
}

export interface WorkflowPlanEdgeWire {
	from_step_id: string;
	to_step_id: string;
	condition: string;
	required_projection_kind?: StepOutputProjectionKind;
}

export interface ProjectionSafetySummaryWire {
	truncated: boolean;
	redacted: boolean;
	max_chars: number;
	fields_present: string[];
}

export interface StepOutputProjectionWire {
	projection_id: string;
	source_step_id: string;
	projection_kind: StepOutputProjectionKind;
	content_hash: string;
	payload: SafeRecord;
	safety: ProjectionSafetySummaryWire;
}

export interface WorkflowContextProjectionWire {
	projection_id: string;
	source_step_id: string;
	projection_kind: StepOutputProjectionKind;
	content_hash: string;
	safety: ProjectionSafetySummaryWire;
}

export interface WorkflowAgentContextWire {
	schema_version: "workflow-agent-context-v1";
	visibility: "agent_private";
	workflow_run_ref: string;
	step_id: string;
	agent_id: AgentTarget;
	target?: AgentTarget;
	required_projection_kind?: StepOutputProjectionKind;
	expected_output_artifacts: StepOutputProjectionKind[];
	projection_refs: WorkflowContextProjectionWire[];
}

export interface WorkflowPlanWire {
	schema_version: "workflow-plan-v1";
	plan_id: string;
	workflow_mode: WorkflowMode;
	allowed_agents: AgentTarget[];
	steps: WorkflowPlanStepWire[];
	edges: WorkflowPlanEdgeWire[];
	terminal_policy: SafeRecord;
	resume_policy: SafeRecord;
	semantic_retry_policy: SafeRecord;
}

export interface AgentInvocationWire {
	invocation_id: string;
	parent_invocation_id?: string;
	workflow_run_ref: string;
	step_id: string;
	agent_id: AgentTarget;
	status: string;
	allowed_tools: string[];
	used_tools: string[];
	projection_ids: string[];
	fail_close_reason?: string;
}

export interface RuntimeDecisionsWire {
	schema_version: typeof SUPERVISOR_EXECUTION_CONTRACT.runtimeDecisionsSchemaVersion;
	effective_capability: RequestedCapability;
	lane: string;
	routing_frame: SafeRecord;
	runtime_decision_summary: RuntimeDecisionSummaryWire;
	scope_gate?: SafeRecord;
	policy_gate?: SafeRecord;
	context_preflight?: SafeRecord;
	tool_policy?: SafeRecord;
	handoff?: SafeRecord;
	workflow_plan?: WorkflowPlanWire;
	terminal_envelope?: SafeRecord;
	[key: string]: unknown;
}

export interface AgentResponseWire {
	target: AgentTarget;
	status: DelegateStatus;
	answer_text?: string;
	follow_up_question?: string;
	confidence?: ConfidenceLevel;
	result?: SafeRecord | null;
	error?: { code: string; message: string; retryable?: boolean } | null;
	agent_observability?: SafeRecord | null;
}

export interface BridgeV6RequestWire {
	bridge_version: typeof SUPERVISOR_EXECUTION_CONTRACT.bridgeVersion;
	response_contract: typeof SUPERVISOR_EXECUTION_CONTRACT.responseContract;
	user_goal: string;
	conversation_id?: string;
	request_id: string;
	safety_identifier?: string | null;
	effective_capability: RequestedCapability;
	lane: string;
	requested_capability: RequestedCapability;
	requested_scope?: { corpus: string; collection: string } | null;
	trace: { trace_id: string };
	actor: SafeRecord;
	context: SafeRecord;
	version_query: SafeRecord;
	runtime_decisions: RuntimeDecisionsWire;
}

export interface AgentRequestWire {
	target: AgentTarget;
	user_goal: string;
	conversation_id?: string;
	request_id?: string;
	safety_identifier?: string | null;
	trace?: { trace_id: string };
	actor?: SafeRecord;
	context?: SafeRecord;
	workflow_context?: WorkflowAgentContextWire;
	payload: { kind: string; payload: SafeRecord };
	allowed_tools: string[];
}

export interface SupervisorExecutionWorkflowTraceSummaryWire {
	routing_frame: SafeRecord;
	context_resolution: SafeRecord;
	planning_outcome: string;
	direct_vs_delegate_branch: string;
	workflow_mode: WorkflowMode;
	handoff: SafeRecord;
	handoff_chain: SafeRecord[];
	agent_invocations: AgentInvocationWire[];
	selected_target: AgentTarget | string | null;
	selected_tools: string[];
	context_projections: WorkflowContextProjectionWire[];
	answer_artifact_projection_ids: string[];
	answer_artifact_kinds: StepOutputProjectionKind[];
	tool_argument_summary: SafeRecord;
	trace_steps?: SafeRecord[];
	tool_call_summaries?: SafeRecord[];
	guardrail_outcomes: SafeRecord;
	fail_close_reason: string;
	runtime_versions: SafeRecord;
	policy_artifact_versions: SafeRecord;
}

export interface SupervisorExecutionResponseWire {
	selected_target: AgentTarget | null;
	status: SupervisorStatus;
	answer_text: string;
	follow_up_question: string;
	confidence: ConfidenceLevel;
	result: SafeRecord | null;
	error: { code: string; message: string; retryable: boolean } | null;
	observability?: SafeRecord | null;
	workflow_trace_summary?: SupervisorExecutionWorkflowTraceSummaryWire | null;
	trace_id: string;
}
