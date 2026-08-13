import type { CandidateSourceRow, ImprovementCategory, LearningLoopCandidate } from "./types";
import { evaluateStageTimingBudget, LATENCY_BUDGET_VERSION } from "./latency-budget";

export const IMPROVEMENT_CATEGORIES = [
	"prompt_instruction_fix",
	"retrieval_source_fix",
	"tool_schema_or_description_fix",
	"tool_admission_or_routing_fix",
	"model_provider_or_latency_budget_fix",
	"product_expectation_or_ui_fix",
] as const satisfies readonly ImprovementCategory[];

function firstReason(row: CandidateSourceRow): string {
	const latency = evaluateStageTimingBudget(row.stageTiming);
	return (
		latency.worstBreach?.reason ??
		row.reasonCodes[0] ??
		row.errorCode ??
		"operator_review_needed"
	);
}

function classifyCandidate(row: CandidateSourceRow): ImprovementCategory {
	const latency = evaluateStageTimingBudget(row.stageTiming);
	if (latency.worstBreach?.severity === "critical") {
		return latency.worstBreach.category;
	}
	const reason = firstReason(row);
	if (reason.includes("schema") || reason.includes("validation") || reason.includes("tool_arg")) {
		return "tool_schema_or_description_fix";
	}
	if (row.reasonCodes.includes("too_slow")) {
		return "model_provider_or_latency_budget_fix";
	}
	if (row.reasonCodes.includes("wrong_tool")) {
		return "tool_admission_or_routing_fix";
	}
	if (row.reasonCodes.includes("missing_context")) {
		return "retrieval_source_fix";
	}
	if (row.reasonCodes.includes("bad_tone") || row.reasonCodes.includes("unclear_answer")) {
		return "prompt_instruction_fix";
	}
	return "product_expectation_or_ui_fix";
}

function shouldSelect(row: CandidateSourceRow): boolean {
	const latency = evaluateStageTimingBudget(row.stageTiming);
	return row.vote !== "helpful" || row.failClosed === true || latency.worstBreach?.severity === "critical";
}

function candidateEvidence(row: CandidateSourceRow) {
	return {
		cachedInputTokens: row.cachedInputTokens,
			...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
		errorCode: row.errorCode,
		failClosed: row.failClosed,
		inputTokens: row.inputTokens,
		modelName: row.modelName,
		modelProvider: row.modelProvider,
		outputTokens: row.outputTokens,
		projectionLagMs: row.projectionLagMs,
		reasonCodes: row.reasonCodes,
		status: row.status,
		totalTokens: row.totalTokens,
		traceAvailable: row.traceAvailable,
	};
}

export function buildLearningLoopCandidates(rows: CandidateSourceRow[]): LearningLoopCandidate[] {
	return rows.flatMap((row) => {
		const latency = evaluateStageTimingBudget(row.stageTiming);
		const runtimeLatencyCandidates = latency.breaches
			.filter((breach) => breach.severity === "critical")
			.map(
				(breach): LearningLoopCandidate => ({
					category: breach.category,
					evidence: {
						...candidateEvidence(row),
						budgetState: breach.severity,
						budgetVersion: LATENCY_BUDGET_VERSION,
							...(breach.durationMs === null ? {} : { durationMs: breach.durationMs }),
						stageField: breach.field,
					},
					feedbackId: null,
					feedbackUpdatedAt: null,
					reason: breach.reason,
					requestId: row.requestId,
					source: "runtime_observation",
				}),
			);
		if (!shouldSelect(row)) {
			return runtimeLatencyCandidates;
		}
		if (row.feedbackId === null && row.vote !== "helpful") {
			return runtimeLatencyCandidates;
		}
		const feedbackOrFailureCandidate: LearningLoopCandidate = {
			category: classifyCandidate(row),
			evidence: candidateEvidence(row),
			feedbackId: row.feedbackId,
			feedbackUpdatedAt: row.feedbackUpdatedAt,
			reason: firstReason(row),
			requestId: row.requestId,
			source: row.vote === "helpful" ? "runtime_observation" : "message_feedback",
		};
		return [feedbackOrFailureCandidate, ...runtimeLatencyCandidates];
	});
}
