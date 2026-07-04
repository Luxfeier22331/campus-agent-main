import { eq, gte, inArray, lte } from "drizzle-orm";

import { requestExecution, requestObservabilityFact } from "../../../db/schema";
import { isStageTimingField, projectStageTimingBudget } from "../../latency-budget";
import type {
	MetricRatio,
	NormalizedOperatorOverviewFilters,
	OperatorOverviewWindow,
	OperatorRequestOpsIndex,
	OperatorResultWindow,
	RequestProjectionRecord,
} from "../service";
import type { RequestObservabilityFactRow, RuntimeDatabase } from "./runtime";

export function toIsoString(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

export function escapeLikePattern(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function toRequestProjectionRecord(
	row: typeof import("../../../db/schema").requestProjection.$inferSelect,
	input: {
		runId?: string | null;
	} = {},
): RequestProjectionRecord {
	return {
		answerPreview: row.answerPreview ?? null,
		completedAt: toIsoString(row.completedAt),
		conversationId: row.conversationId,
		...(row.diagnosticsJson ? { diagnostics: row.diagnosticsJson } : {}),
		durationMs: row.durationMs ?? null,
		errorCode: row.errorCode ?? null,
		entitlementGroups: row.entitlementGroupsJson ?? [],
		entitlementSnapshotId: row.entitlementSnapshotId ?? null,
		principalId: row.principalId,
		principalLabel: row.principalLabel ?? null,
		principalType: row.principalType,
		projectedAt: row.projectedAt.toISOString(),
		questionPreview: row.questionPreview,
		requestId: row.requestId,
		runId: input.runId ?? null,
		requestedTool: row.requestedTool ?? null,
		requestedScope: row.requestedScopeJson ?? null,
		...(row.versionQueryJson ? { versionQuery: row.versionQueryJson } : {}),
		resolvedScope: row.resolvedScopeJson ?? null,
		selectedTool: row.selectedTool ?? null,
		sourceDocIds: row.sourceDocIdsJson ?? [],
		startedAt: row.startedAt.toISOString(),
		status: row.status as RequestProjectionRecord["status"],
		surface: row.surface,
		traceId: row.traceId,
		visibilityScope: row.visibilityScope ?? null,
		applicabilityScope: row.applicabilityScope ?? null,
	};
}

export async function loadRunBacklinksByRequestIds(
	db: RuntimeDatabase,
	requestIds: string[],
): Promise<Map<string, string | null>> {
	const uniqueRequestIds = [...new Set(requestIds)];
	const backlinks = new Map<string, string | null>(
		uniqueRequestIds.map((requestId) => [requestId, null]),
	);
	if (uniqueRequestIds.length === 0) {
		return backlinks;
	}

	const rows = await db
		.select({
			requestId: requestExecution.requestId,
			runId: requestExecution.runId,
		})
		.from(requestExecution)
		.where(inArray(requestExecution.requestId, uniqueRequestIds))
		.limit(uniqueRequestIds.length);
	for (const row of rows) {
		backlinks.set(row.requestId, row.runId ?? null);
	}
	return backlinks;
}

function normalizeStageTiming(
	value: Record<string, unknown> | null | undefined,
): Record<string, number> {
	const entries = Object.entries(value ?? {}).filter(
		(entry): entry is [string, number] =>
			isStageTimingField(entry[0]) &&
			typeof entry[1] === "number" &&
			Number.isFinite(entry[1]) &&
			entry[1] >= 0,
	);
	return Object.fromEntries(entries);
}

export function toOperatorRequestOpsIndex(
	row: RequestObservabilityFactRow,
): OperatorRequestOpsIndex {
	return {
		debugTraceRefs: row.debugTraceRefsJson ?? [],
		model: {
			billableStepCount: row.billableStepCount ?? null,
			cachedInputTokens: row.cachedInputTokens ?? null,
			estimatedCostMicrousd: row.estimatedCostMicrousd ?? null,
			executionDetail: row.modelExecutionDetail ?? null,
			executionState: row.modelExecutionState ?? null,
			inputTokens: row.inputTokens ?? null,
			modelName: row.modelName ?? null,
			modelProvider: row.modelProvider ?? null,
			outputTokens: row.outputTokens ?? null,
			promptId: row.promptId ?? null,
			promptVersion: row.promptVersion ?? null,
			templateSha256: row.templateSha256 ?? null,
			usageSummary: row.modelUsageSummaryJson ?? [],
		},
		retrieval: {
			adequacyReason: row.retrievalAdequacyReason ?? null,
			adequacyVerdict: row.retrievalAdequacyVerdict ?? null,
			candidateCount: row.candidateCount ?? null,
			collection: row.collection ?? null,
			retrievalAttempted: row.retrievalAttempted ?? null,
			retrievedSourceCount: row.retrievedSourceCount ?? null,
		},
		sinkLinks: {
			projectionLagMs: row.projectionLagMs ?? null,
			traceAvailable: row.traceAvailable,
		},
		stageTiming: normalizeStageTiming(row.stageTimingJson),
		stageTimingBudget: projectStageTimingBudget(row.stageTimingJson),
		tool: {
			failClosed: row.failClosed ?? null,
			failCloseReason: row.toolFailCloseReason ?? null,
			historicalDowngradeReason: row.toolHistoricalDowngradeReason ?? null,
			requestedTool: row.requestedTool ?? null,
			selectedTool: row.selectedTool ?? null,
			toolBusinessOutcome: row.toolBusinessOutcome ?? null,
		},
	};
}

export function resolveWindowBounds(window: OperatorOverviewWindow, now: Date) {
	const nowValue = now.valueOf();
	const durationMs =
		window === "15m"
			? 15 * 60_000
			: window === "1h"
				? 60 * 60_000
				: window === "24h"
					? 24 * 60 * 60_000
					: window === "7d"
						? 7 * 24 * 60 * 60_000
						: 30 * 24 * 60 * 60_000;
	const granularity =
		window === "15m" ? "5m" : window === "1h" ? "15m" : window === "24h" ? "1h" : "1d";

	return {
		from: new Date(nowValue - durationMs),
		granularity,
		to: now,
	} as const;
}

export function toRatio(count: number, eligibleCount: number | null): MetricRatio {
	return {
		count,
		eligibleCount,
		value: eligibleCount && eligibleCount > 0 ? Number((count / eligibleCount).toFixed(4)) : 0,
	};
}

export function resolveBucketStart(
	timestamp: string,
	granularity: OperatorResultWindow["granularity"],
): Date {
	const value = new Date(timestamp);
	if (granularity === "5m") {
		value.setUTCMinutes(Math.floor(value.getUTCMinutes() / 5) * 5, 0, 0);
		return value;
	}
	if (granularity === "15m") {
		value.setUTCMinutes(Math.floor(value.getUTCMinutes() / 15) * 15, 0, 0);
		return value;
	}
	if (granularity === "1h") {
		value.setUTCMinutes(0, 0, 0);
		return value;
	}
	value.setUTCHours(0, 0, 0, 0);
	return value;
}

export function addGranularity(
	bucketStart: Date,
	granularity: OperatorResultWindow["granularity"],
): Date {
	const next = new Date(bucketStart);
	if (granularity === "5m") {
		next.setUTCMinutes(next.getUTCMinutes() + 5);
		return next;
	}
	if (granularity === "15m") {
		next.setUTCMinutes(next.getUTCMinutes() + 15);
		return next;
	}
	if (granularity === "1h") {
		next.setUTCHours(next.getUTCHours() + 1);
		return next;
	}
	next.setUTCDate(next.getUTCDate() + 1);
	return next;
}

export function percentile(values: number[], percentileValue: number): number | null {
	if (values.length === 0) {
		return null;
	}

	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
	);
	return sorted[index] ?? null;
}

export function buildObservabilityConditions(
	filters: NormalizedOperatorOverviewFilters,
	bounds: ReturnType<typeof resolveWindowBounds>,
) {
	const conditions = [
		gte(requestObservabilityFact.startedAt, bounds.from),
		lte(requestObservabilityFact.startedAt, bounds.to),
	];

	if (filters.surface) {
		conditions.push(eq(requestObservabilityFact.surface, filters.surface));
	}
	if (filters.principalType) {
		conditions.push(eq(requestObservabilityFact.principalType, filters.principalType));
	}

	return conditions;
}

export function buildResultWindow(bounds: ReturnType<typeof resolveWindowBounds>) {
	return {
		from: bounds.from.toISOString(),
		granularity: bounds.granularity,
		to: bounds.to.toISOString(),
	} as const;
}

export function resolveResultGranularity(
	filters: NormalizedOperatorOverviewFilters,
	bounds: ReturnType<typeof resolveWindowBounds>,
) {
	return filters.granularity ?? bounds.granularity;
}
