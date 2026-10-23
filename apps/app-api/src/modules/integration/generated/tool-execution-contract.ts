/* AUTO-GENERATED FROM tool-execution.openapi.yaml. Do not edit by hand. */

export const TOOL_EXECUTION_CONTRACT = {
	executionContractVersion: "tool_execution_v7",
	responseContract: "execution_finalization_response_v9",
} as const;

export const TOOL_IDS = ["campus_search", "personal_memory_recall"] as const;
export const MODEL_VISIBLE_TOOL_NAMES = ["campus_search", "personal_memory_recall"] as const;
export const EXECUTION_STATUSES = [
	"completed",
	"error",
	"rejected",
	"approval_required",
	"cancelled",
] as const;
export const STAGE_TIMING_FIELDS = [
	"request.total_ms",
	"execution.dispatch_ms",
	"workflow.schedule_to_start_ms",
	"stream.first_delta_persist_ms",
	"stream.app_api_ttft_ms",
	"stream.orchestration_overhead_ms",
	"execution.admission_ms",
	"memory.recall_ms",
	"workflow.solve_ms",
	"workflow.execute_step_ms",
	"workflow.replan_ms",
	"workflow.synthesize_ms",
	"workflow.first_delta_ms",
	"tool.total_ms",
	"finalization.write_ms",
	"projection.closeout_ms",
] as const;

export type ToolID = (typeof TOOL_IDS)[number];
export type ModelVisibleToolName = (typeof MODEL_VISIBLE_TOOL_NAMES)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

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

export interface ExecutionPayloadWire {
	execution_contract_version: typeof TOOL_EXECUTION_CONTRACT.executionContractVersion;
	response_contract: typeof TOOL_EXECUTION_CONTRACT.responseContract;
	user_goal: string;
	conversation_id: string;
	tenant_id?: string;
	request_id: string;
	safety_identifier?: string | null;
	context: SafeRecord;
}

export interface ExecutionRunMetadataWire {
	execution_contract_version: typeof TOOL_EXECUTION_CONTRACT.executionContractVersion;
	execution_input_ref: string;
	execution_input_sha256: string;
}

export interface ExecutionRunCreateRequestWire {
	conversation_id: string;
	request_id: string;
	owner_user_id: string;
	personal_memory_recall_allowed: boolean;
	surface: string;
	runtime_versions?: SafeRecord;
	metadata: ExecutionRunMetadataWire;
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
	model_usage: ModelUsageWire;
	result: SafeRecord | null;
	error: { code: string; message: string; retryable: boolean } | null;
	observability?: SafeRecord | null;
	stage_timing?: StageTimingWire | null;
}
