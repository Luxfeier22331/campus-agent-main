/* AUTO-GENERATED FROM tool-execution.openapi.yaml. Do not edit by hand. */

export const TOOL_EXECUTION_CONTRACT = {
	executionContractVersion: "tool_execution_v5",
	responseContract: "execution_finalization_response_v5",
	workflowTraceSummaryVersion: "workflow-trace-summary-v7",
} as const;

export const TOOL_IDS = ["personal_memory_recall"] as const;
export const MODEL_VISIBLE_TOOL_NAMES = ["personal_memory_recall"] as const;
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
export const EXECUTION_PATHS = [
	"direct",
	"tool_assisted",
	"clarification",
	"rejected",
	"unsupported",
] as const;
export const STAGE_TIMING_FIELDS = [
	"request.total_ms",
	"execution.dispatch_ms",
	"agent.schedule_to_start_ms",
	"stream.first_delta_persist_ms",
	"stream.app_api_ttft_ms",
	"stream.orchestration_overhead_ms",
	"execution.admission_ms",
	"grounding.prepare_ms",
	"memory.recall_ms",
	"agent.primary_ms",
	"agent.runtime_ms",
	"agent.first_delta_ms",
	"tool.total_ms",
	"finalization.write_ms",
	"projection.closeout_ms",
] as const;

export type ToolID = (typeof TOOL_IDS)[number];
export type ModelVisibleToolName = (typeof MODEL_VISIBLE_TOOL_NAMES)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export type ExecutionPath = (typeof EXECUTION_PATHS)[number];

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
	trace: TraceContextWire;
	context: SafeRecord;
}

export interface ExecutionRunMetadataWire {
	execution_contract_version: typeof TOOL_EXECUTION_CONTRACT.executionContractVersion;
	execution_input_ref: string;
	execution_input_sha256: string;
}

export interface ExecutionRunCreateRequestWire {
	run_id: string;
	conversation_id: string;
	turn_id: string;
	request_id: string;
	trace_id?: string;
	owner_user_id: string;
	personal_memory_recall_allowed: boolean;
	surface: string;
	runtime_versions?: SafeRecord;
	metadata: ExecutionRunMetadataWire;
}

export interface ToolExecutionWorkflowTraceSummaryWire {
	execution_path: ExecutionPath;
	terminal_reason: string;
	answer_artifact_refs: string[];
	runtime_versions: SafeRecord;
}

export interface ModelUsageWire {
	input_tokens: number;
	cached_input_tokens: number;
	output_tokens: number;
	total_tokens: number;
}

export interface ToolExecutionResponseWire {
	status: ExecutionStatus;
	answer_text: string;
	follow_up_question: string;
	confidence: ConfidenceLevel;
	model_usage: ModelUsageWire;
	result: SafeRecord | null;
	error: { code: string; message: string; retryable: boolean } | null;
	observability?: SafeRecord | null;
	workflow_trace_summary?: ToolExecutionWorkflowTraceSummaryWire | null;
	stage_timing?: StageTimingWire | null;
	trace_id: string;
}
