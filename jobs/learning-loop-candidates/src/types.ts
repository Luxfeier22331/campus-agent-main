import type { LearningLoopCandidate } from "eval-langfuse";

export type ImprovementCategory =
	| "prompt_instruction_fix"
	| "retrieval_source_fix"
	| "tool_schema_or_description_fix"
	| "tool_admission_or_routing_fix"
	| "model_provider_or_latency_budget_fix"
	| "product_expectation_or_ui_fix";

export interface CandidateSourceRow {
	feedbackId: string | null;
	requestId: string;
	vote: string | null;
	reasonCodes: string[];
	feedbackUpdatedAt: string | null;
	status: string;
	errorCode: string | null;
	selectedTool: string | null;
	requestedTool: string | null;
	failClosed: boolean | null;
	modelProvider: string | null;
	modelName: string | null;
	durationMs: number | null;
	stageTiming?: Record<string, unknown> | null;
	traceAvailable: boolean;
	projectionLagMs: number | null;
}

export interface LatencyBudgetBreach {
	category: ImprovementCategory;
	durationMs: number;
	field: string;
	reason: string;
	severity: "warn" | "critical";
	thresholdMs: number;
}

export type { LearningLoopCandidate };

export interface LearningLoopCandidatePublisher {
	publish(candidates: LearningLoopCandidate[]): Promise<{ publishedCount: number }>;
	verify?(candidates: LearningLoopCandidate[]): Promise<{
		expectedCount: number;
		matchedCount: number;
		missingIds: string[];
	}>;
}
