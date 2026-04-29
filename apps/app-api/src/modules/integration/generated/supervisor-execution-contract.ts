/* AUTO-GENERATED FROM supervisor-execution.openapi.yaml. Do not edit by hand. */

export const SUPERVISOR_EXECUTION_CONTRACT = {
	bridgeVersion: "supervisor_bridge_v6",
	responseContract: "agent_response",
	runtimeDecisionsSchemaVersion: "supervisor-runtime-decisions-v1",
	runtimeDecisionSummarySchemaVersion: "runtime-decision-summary-v1",
	workflowTraceSummaryVersion: "workflow-trace-summary-v2",
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

export type AgentTarget = (typeof AGENT_TARGETS)[number];
export type RequestedCapability = (typeof REQUESTED_CAPABILITIES)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type DelegateStatus = (typeof DELEGATE_STATUSES)[number];
export type SupervisorStatus = (typeof SUPERVISOR_STATUSES)[number];

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

export interface SupervisorExecutionWorkflowTraceSummaryWire {
	routing_frame: SafeRecord;
	context_resolution: SafeRecord;
	planning_outcome: string;
	direct_vs_delegate_branch: string;
	workflow_mode: string;
	handoff: SafeRecord;
	handoff_chain: SafeRecord[];
	selected_target: AgentTarget | string | null;
	selected_tools: string[];
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
	error: { code: string; message: string; retryable?: boolean } | null;
	observability?: SafeRecord | null;
	workflow_trace_summary?: SupervisorExecutionWorkflowTraceSummaryWire | null;
	trace_id: string;
}
