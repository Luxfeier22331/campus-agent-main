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

export type ExecutionFinalizationStatus = (typeof EXECUTION_FINALIZATION_STATUSES)[number];
export type ExecutionFinalizationConfidence =
	(typeof EXECUTION_FINALIZATION_CONFIDENCE_LEVELS)[number];

export interface ExecutionFinalizationResponseWire {
	answer_text: string;
	confidence: ExecutionFinalizationConfidence;
	error: { code: string; message: string; retryable: boolean } | null;
	follow_up_question: string;
	observability?: Record<string, unknown> | null;
	result: Record<string, unknown> | null;
	selected_capability: string | null;
	status: ExecutionFinalizationStatus;
	trace_id: string;
	workflow_trace_summary?: Record<string, unknown> | null;
}
