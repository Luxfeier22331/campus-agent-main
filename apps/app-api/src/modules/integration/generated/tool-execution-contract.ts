/* AUTO-GENERATED FROM tool-execution.openapi.yaml. Do not edit by hand. */

export const TOOL_EXECUTION_CONTRACT = {
	executionContractVersion: "tool_execution_v1",
	responseContract: "execution_finalization_response_v2",
	runtimeDecisionsSchemaVersion: "tool-execution-runtime-decisions-v1",
	runtimeDecisionSummarySchemaVersion: "runtime-decision-summary-v1",
	workflowTraceSummaryVersion: "workflow-trace-summary-v4",
} as const;

export const TOOL_IDS = [
	"knowledge_query",
	"place_lookup",
	"public_web_search",
	"transport_schedule_lookup",
	"campus_notice_discover",
	"campus_notice_get",
] as const;
export const MODEL_VISIBLE_TOOL_NAMES = [
	"knowledge_query",
	"public_web_search",
	"transport_schedule_lookup",
	"campus_notice_discover",
] as const;
export const REQUESTED_TOOLS = [
	"knowledge_query",
	"place_lookup",
	"public_web_search",
	"transport_schedule_lookup",
	"campus_notice_discover",
] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const DELEGATE_STATUSES = [
	"completed",
	"needs_clarification",
	"no_answer",
	"error",
] as const;
export const EXECUTION_STATUSES = [
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
	"schedule_baseline",
	"place_context",
	"evidence_bundle",
	"grounding_verdict",
] as const;
export const STAGE_TIMING_FIELDS = [
	"request.total_ms",
	"stream.browser_ttft_ms",
	"execution.admission_ms",
	"memory.recall_ms",
	"agent.primary_ms",
	"agent.runtime_ms",
	"agent.first_delta_ms",
	"tool.total_ms",
	"tool.knowledge_query_ms",
	"tool.transport_schedule_lookup_ms",
	"tool.campus_notice_discover_ms",
	"rag.plan_ms",
	"rag.lookup_ms",
	"rag.rerank_ms",
	"rag.synthesis_ms",
	"rag.grounding_ms",
	"finalization.write_ms",
	"projection.closeout_ms",
] as const;
export const DEBUG_TRACE_SINKS = ["langfuse_otlp"] as const;

export type ToolID = (typeof TOOL_IDS)[number];
export type ModelVisibleToolName = (typeof MODEL_VISIBLE_TOOL_NAMES)[number];
export type RequestedTool = (typeof REQUESTED_TOOLS)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type DelegateStatus = (typeof DELEGATE_STATUSES)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type WorkflowMode = (typeof WORKFLOW_MODES)[number];
export type StepOutputProjectionKind = (typeof STEP_OUTPUT_PROJECTION_KINDS)[number];

export type StageTimingField = (typeof STAGE_TIMING_FIELDS)[number];
export type StageTimingWire = Partial<Record<StageTimingField, number>>;
export type DebugTraceSink = (typeof DEBUG_TRACE_SINKS)[number];

export type SafeRecord = Record<string, unknown>;

export interface ConversationContextWire {
	schema_version: "conversation_context.v1";
	conversation_id: string;
	user_message_id: string;
	parent_message_id?: string | null;
	current_user_message: { role: "user"; content: string; created_at: string };
	recent_turns: SafeRecord[];
	previous_answer_summary?: string | null;
	previous_evidence_refs: SafeRecord[];
	previous_tool_results: SafeRecord[];
	session_state: SafeRecord;
	visibility: { model_visible: string[]; runtime_only: string[] };
	memory_recall: {
		gate_field: "context.memory.enabled";
		owner: "execution-control";
		runtime: "hindsight";
	};
	source_attribution: SafeRecord[];
	context_summary: string | null;
	budget: { token_estimate: number; recent_turn_limit: number };
	truncation: SafeRecord | null;
}

export interface RuntimeDecisionSummaryWire {
	schema_version: typeof TOOL_EXECUTION_CONTRACT.runtimeDecisionSummarySchemaVersion;
	scope_gate_decision?: string;
	policy_gate_decision?: string;
	context_preflight_state?: string;
	routing_next_action?: string;
	planning_outcome: string;
	selected_tool?: string;
	task_queue?: string;
	terminal_outcome?: string;
	fail_close_reason?: string;
	runtime_versions?: SafeRecord;
	policy_artifact_versions?: SafeRecord;
}

export interface WorkflowPlanStepWire {
	step_id: string;
	step_kind: string;
	tool?: ToolID | string;
	task_queue?: string;
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

export interface WorkflowToolContextWire {
	schema_version: "workflow-tool-context-v1";
	visibility: "tool_private";
	workflow_run_ref: string;
	step_id: string;
	tool_id: ToolID;
	task_queue?: string;
	required_projection_kind?: StepOutputProjectionKind;
	expected_output_artifacts: StepOutputProjectionKind[];
	projection_refs: WorkflowContextProjectionWire[];
}

export interface WorkflowPlanWire {
	schema_version: "workflow-plan-v1";
	plan_id: string;
	workflow_mode: WorkflowMode;
	allowed_tools: ToolID[];
	steps: WorkflowPlanStepWire[];
	edges: WorkflowPlanEdgeWire[];
	terminal_policy: SafeRecord;
	resume_policy: SafeRecord;
	semantic_retry_policy: SafeRecord;
}

export interface ToolInvocationWire {
	invocation_id: string;
	parent_invocation_id?: string;
	workflow_run_ref: string;
	step_id: string;
	tool_id: ToolID;
	status: string;
	allowed_tools: string[];
	used_tools: string[];
	projection_ids: string[];
	fail_close_reason?: string;
}

export interface RuntimeDecisionsWire {
	schema_version: typeof TOOL_EXECUTION_CONTRACT.runtimeDecisionsSchemaVersion;
	effective_tool: RequestedTool;
	task_queue: string;
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

export interface ToolResponseWire {
	tool: ToolID;
	task_queue?: string;
	status: DelegateStatus;
	answer_text?: string;
	follow_up_question?: string;
	confidence?: ConfidenceLevel;
	result?: SafeRecord | null;
	error?: { code: string; message: string; retryable?: boolean } | null;
	tool_observability?: SafeRecord | null;
}

export interface ToolExecutionRequestWire {
	execution_contract_version: typeof TOOL_EXECUTION_CONTRACT.executionContractVersion;
	response_contract: typeof TOOL_EXECUTION_CONTRACT.responseContract;
	user_goal: string;
	conversation_id?: string;
	tenant_id?: string;
	request_id: string;
	safety_identifier?: string | null;
	effective_tool: RequestedTool;
	task_queue: string;
	requested_tool: RequestedTool;
	requested_scope?: { corpus: string; collection: string } | null;
	trace: { trace_id: string };
	actor: SafeRecord;
	context: SafeRecord;
	version_query: SafeRecord;
	runtime_decisions?: RuntimeDecisionsWire;
}

export interface ToolRequestWire {
	tool: ToolID;
	task_queue?: string;
	user_goal: string;
	conversation_id?: string;
	request_id?: string;
	safety_identifier?: string | null;
	trace?: { trace_id: string };
	actor?: SafeRecord;
	context?: SafeRecord;
	workflow_context?: WorkflowToolContextWire;
	payload: { kind: string; payload: SafeRecord };
	allowed_tools: ModelVisibleToolName[];
}

export interface ToolExecutionWorkflowTraceSummaryWire {
	routing_frame: SafeRecord;
	context_resolution: SafeRecord;
	planning_outcome: string;
	direct_vs_delegate_branch: string;
	workflow_mode: WorkflowMode;
	handoff: SafeRecord;
	handoff_chain: SafeRecord[];
	tool_invocations: ToolInvocationWire[];
	selected_tool: ToolID | string | null;
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

export interface DebugTraceRefWire {
	sink: DebugTraceSink;
	trace_id?: string | null;
	trace_ref: string;
	url?: string;
}

export interface ToolExecutionResponseWire {
	selected_tool: ToolID | null;
	status: ExecutionStatus;
	answer_text: string;
	follow_up_question: string;
	confidence: ConfidenceLevel;
	result: SafeRecord | null;
	error: { code: string; message: string; retryable: boolean } | null;
	observability?: SafeRecord | null;
	workflow_trace_summary?: ToolExecutionWorkflowTraceSummaryWire | null;
	stage_timing?: StageTimingWire | null;
	debug_trace_refs?: DebugTraceRefWire[] | null;
	trace_id: string;
}
