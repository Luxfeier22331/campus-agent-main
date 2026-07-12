export const EXECUTION_FINALIZATION_STATUSES = [
	"completed",
	"needs_clarification",
	"no_answer",
	"error",
	"rejected",
	"approval_required",
	"cancelled",
] as const;

export const EXECUTION_FINALIZATION_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

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

export type ExecutionFinalizationStatus = (typeof EXECUTION_FINALIZATION_STATUSES)[number];
export type ExecutionFinalizationConfidence =
	(typeof EXECUTION_FINALIZATION_CONFIDENCE_LEVELS)[number];
export type StageTimingField = (typeof STAGE_TIMING_FIELDS)[number];
export type StageTimingWire = Partial<Record<StageTimingField, number>>;

export interface ExecutionFinalizationResponseWire {
	answer_text: string;
	confidence: ExecutionFinalizationConfidence;
	error: { code: string; message: string; retryable: boolean } | null;
	follow_up_question: string;
	observability?: Record<string, unknown> | null;
	resolved_scope: string | null;
	result: Record<string, unknown> | null;
	selected_tool: string | null;
	session_update: {
		upsert_slots: Array<{
			confirmed: true;
			name: "curriculum_program" | "curriculum_program_family" | "curriculum_semester";
			value: string;
		}>;
	} | null;
	stage_timing?: StageTimingWire | null;
	status: ExecutionFinalizationStatus;
	trace_id: string;
	workflow_trace_summary?: Record<string, unknown> | null;
}
