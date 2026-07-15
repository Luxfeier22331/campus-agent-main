/* AUTO-GENERATED FROM tool-execution.openapi.yaml. Do not edit by hand. */

export const TOOL_EXECUTION_CONTRACT = {
	executionContractVersion: "tool_execution_v2",
	responseContract: "execution_finalization_response_v3",
	workflowTraceSummaryVersion: "workflow-trace-summary-v6",
} as const;

export const TOOL_IDS = [
	"knowledge_query",
	"knowledge_search",
	"transport_schedule_lookup",
] as const;
export const MODEL_VISIBLE_TOOL_NAMES = ["knowledge_query", "transport_schedule_lookup"] as const;
export const REQUESTED_TOOLS = ["knowledge_query", "transport_schedule_lookup"] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
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
export const ANSWER_ARTIFACT_KINDS = ["agent_final_output"] as const;
export const STAGE_TIMING_FIELDS = [
	"request.total_ms",
	"stream.browser_ttft_ms",
	"execution.admission_ms",
	"memory.recall_ms",
	"agent.primary_ms",
	"agent.runtime_ms",
	"agent.first_delta_ms",
	"tool.total_ms",
	"tool.transport_schedule_lookup_ms",
	"knowledge.search_ms",
	"finalization.write_ms",
	"projection.closeout_ms",
] as const;

export type ToolID = (typeof TOOL_IDS)[number];
export type ModelVisibleToolName = (typeof MODEL_VISIBLE_TOOL_NAMES)[number];
export type RequestedTool = (typeof REQUESTED_TOOLS)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type WorkflowMode = (typeof WORKFLOW_MODES)[number];
export type AnswerArtifactKind = (typeof ANSWER_ARTIFACT_KINDS)[number];

export type StageTimingField = (typeof STAGE_TIMING_FIELDS)[number];
export type StageTimingWire = Partial<Record<StageTimingField, number>>;
export type SafeRecord = Record<string, unknown>;

export interface ConversationContextWire {
	schema_version: "conversation_context.v1";
	conversation_id: string;
	user_message_id: string;
	parent_message_id?: string | null;
	current_user_message: { role: "user"; content: string; created_at: string };
	recent_turns: SafeRecord[];
	previous_evidence_refs: SafeRecord[];
	previous_tool_results: SafeRecord[];
	session_state: SafeRecord;
}

export interface TraceContextWire {
	trace_id: string;
}

export interface ExecutionPayloadWire {
	execution_contract_version: typeof TOOL_EXECUTION_CONTRACT.executionContractVersion;
	response_contract: typeof TOOL_EXECUTION_CONTRACT.responseContract;
	user_goal: string;
	conversation_id: string;
	tenant_id?: string;
	request_id: string;
	safety_identifier?: string | null;
	requested_tool?: RequestedTool;
	trace: TraceContextWire;
	context: SafeRecord;
}

export interface ExecutionRunMetadataWire {
	execution_payload: ExecutionPayloadWire;
}

export interface ExecutionRunCreateRequestWire {
	run_id: string;
	conversation_id: string;
	turn_id: string;
	request_id: string;
	trace_id?: string;
	owner_user_id: string;
	surface: string;
	runtime_versions?: SafeRecord;
	metadata: ExecutionRunMetadataWire;
}

export interface ToolExecutionWorkflowTraceSummaryWire {
	workflow_mode: WorkflowMode;
	selected_tool: ToolID | null;
	selected_tools: string[];
	first_decision_actor: string;
	planning_outcome: string;
	direct_vs_delegate_branch: string;
	terminal_reason: string;
	answer_artifact_kinds: AnswerArtifactKind[];
	answer_artifact_refs: string[];
	trace_steps: SafeRecord[];
	tool_call_summaries: SafeRecord[];
	runtime_versions: SafeRecord;
}

export interface SessionUpdateSlotWire {
	confirmed: true;
	name: "curriculum_program" | "curriculum_program_family" | "curriculum_semester";
	value: string;
}

export interface SessionUpdateWire {
	upsert_slots: SessionUpdateSlotWire[];
}

export interface ToolExecutionResponseWire {
	selected_tool: ToolID | null;
	status: ExecutionStatus;
	answer_text: string;
	follow_up_question: string;
	confidence: ConfidenceLevel;
	resolved_targets: string[];
	session_update: SessionUpdateWire | null;
	result: SafeRecord | null;
	error: { code: string; message: string; retryable: boolean } | null;
	observability?: SafeRecord | null;
	workflow_trace_summary?: ToolExecutionWorkflowTraceSummaryWire | null;
	stage_timing?: StageTimingWire | null;
	trace_id: string;
}
