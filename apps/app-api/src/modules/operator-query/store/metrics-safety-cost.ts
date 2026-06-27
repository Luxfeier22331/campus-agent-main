import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, not, or, type SQL } from "drizzle-orm";

import { requestObservabilityFact } from "../../../db/schema";
import type {
	NormalizedOperatorOverviewFilters,
	NormalizedOperatorSafetyAnomalyListFilters,
	OperatorCostSummaryResult,
	OperatorCostTimeseriesResult,
	OperatorSafetyAnomalyListResult,
	OperatorSafetySummaryResult,
} from "../service";
import { decodeSafetyAnomalyCursor, encodeSafetyAnomalyCursor } from "./cursors";
import { loadObservabilityRows } from "./loaders";
import type { OperatorQueryRuntime } from "./runtime";
import { buildSafetyAnomalyId, inferSafetyAnomalySeverity, summarizeSafetyAnomaly } from "./safety";
import {
	addGranularity,
	aggregateCostByModel,
	aggregateCostBySurface,
	buildResultWindow,
	loadTraceBacklinksByRequestIds,
	resolveBucketStart,
	resolveResultGranularity,
	resolveWindowBounds,
	sumNullableInteger,
	toLinks,
	toRatio,
} from "./shared";

function buildHighSeveritySafetyAnomalyCodeCondition(): SQL {
	const condition = or(
		ilike(requestObservabilityFact.aclAnomalyCode, "%projection_missing%"),
		ilike(requestObservabilityFact.aclAnomalyCode, "%projection_conflict%"),
		ilike(requestObservabilityFact.aclAnomalyCode, "%fail_open%"),
		ilike(requestObservabilityFact.aclAnomalyCode, "%unauthorized%"),
	);
	if (!condition) {
		throw new Error("high severity safety anomaly code condition must be constructible.");
	}
	return condition;
}

function buildHighSeveritySafetyAnomalyCondition(): SQL {
	const condition = or(
		eq(requestObservabilityFact.failClosed, true),
		buildHighSeveritySafetyAnomalyCodeCondition(),
	);
	if (!condition) {
		throw new Error("high severity safety anomaly condition must be constructible.");
	}
	return condition;
}

function buildMediumSeveritySafetyAnomalyCondition(): SQL {
	const condition = and(
		or(isNull(requestObservabilityFact.failClosed), eq(requestObservabilityFact.failClosed, false)),
		not(buildHighSeveritySafetyAnomalyCodeCondition()),
	);
	if (!condition) {
		throw new Error("medium severity safety anomaly condition must be constructible.");
	}
	return condition;
}

export function createSafetyCostMetricHandlers(runtime: OperatorQueryRuntime) {
	return {
		async getSafetySummary(filters: NormalizedOperatorOverviewFilters) {
			const { bounds, rows } = await loadObservabilityRows(runtime, filters);
			const total = rows.length;

			return {
				asOf: bounds.to.toISOString(),
				summary: {
					aclAnomalyRate: toRatio(rows.filter((row) => Boolean(row.aclAnomalyCode)).length, total),
					decisionDistribution: {
						allowed: rows.filter((row) => row.aclDecision === "allowed").length,
						approvalRequired: rows.filter((row) => row.aclDecision === "approval_required").length,
						denied: rows.filter((row) => row.aclDecision === "denied").length,
						failClosed: rows.filter((row) => row.failClosed === true).length,
					},
					failClosedRate: toRatio(rows.filter((row) => row.failClosed === true).length, total),
					restrictedDenyRate: toRatio(
						rows.filter((row) => row.aclDecision === "denied").length,
						total,
					),
				},
				window: buildResultWindow(bounds),
			} satisfies OperatorSafetySummaryResult;
		},

		async listSafetyAnomalies(filters: NormalizedOperatorSafetyAnomalyListFilters) {
			if (filters.status && filters.status !== "open") {
				return {
					anomalies: [],
					page: {
						nextCursor: null,
					},
				} satisfies OperatorSafetyAnomalyListResult;
			}

			const db = await runtime.getDb();
			const conditions: SQL[] = [isNotNull(requestObservabilityFact.aclAnomalyCode)];

			if (filters.anomalyCode) {
				conditions.push(eq(requestObservabilityFact.aclAnomalyCode, filters.anomalyCode));
			}
			if (filters.surface) {
				conditions.push(eq(requestObservabilityFact.surface, filters.surface));
			}
			if (filters.selectedTool) {
				conditions.push(eq(requestObservabilityFact.selectedTool, filters.selectedTool));
			}
			if (filters.window) {
				const bounds = resolveWindowBounds(filters.window, runtime.now());
				conditions.push(gte(requestObservabilityFact.startedAt, bounds.from));
				conditions.push(lt(requestObservabilityFact.startedAt, bounds.to));
			}
			if (filters.severity) {
				const highSeverityCondition = buildHighSeveritySafetyAnomalyCondition();
				if (filters.severity === "high") {
					conditions.push(highSeverityCondition);
				} else if (filters.severity === "medium") {
					conditions.push(buildMediumSeveritySafetyAnomalyCondition());
				} else {
					return {
						anomalies: [],
						page: {
							nextCursor: null,
						},
					} satisfies OperatorSafetyAnomalyListResult;
				}
			}

			const cursor = filters.cursor ? decodeSafetyAnomalyCursor(filters.cursor) : null;
			if (cursor) {
				const cursorDetectedAt = new Date(cursor.detectedAt);
				const cursorCondition = or(
					lt(requestObservabilityFact.startedAt, cursorDetectedAt),
					and(
						eq(requestObservabilityFact.startedAt, cursorDetectedAt),
						lt(requestObservabilityFact.requestId, cursor.requestId),
					),
				);
				if (cursorCondition) {
					conditions.push(cursorCondition);
				}
			}

			const rows = await db
				.select()
				.from(requestObservabilityFact)
				.where(and(...conditions))
				.orderBy(desc(requestObservabilityFact.startedAt), desc(requestObservabilityFact.requestId))
				.limit(filters.limit + 1);

			const visibleRows = rows.slice(0, filters.limit);
			const cursorRow = rows.length > filters.limit ? visibleRows.at(-1) : null;
			const backlinksByRequestId = await loadTraceBacklinksByRequestIds(
				db,
				visibleRows.map((row) => row.requestId),
			);

			return {
				anomalies: visibleRows.map((row) => ({
					anomalyCode: row.aclAnomalyCode ?? "unknown",
					anomalyId: buildSafetyAnomalyId({
						anomalyCode: row.aclAnomalyCode ?? "unknown",
						requestId: row.requestId,
					}),
					detectedAt: row.startedAt.toISOString(),
					links: toLinks(backlinksByRequestId.get(row.requestId)),
					principalType: row.principalType,
					requestId: row.requestId,
					selectedTool: row.selectedTool ?? null,
					severity: inferSafetyAnomalySeverity(row),
					status: "open" as const,
					summary: summarizeSafetyAnomaly(row),
					surface: row.surface,
					traceId: row.traceId,
				})),
				page: {
					nextCursor: cursorRow
						? encodeSafetyAnomalyCursor({
								detectedAt: cursorRow.startedAt.toISOString(),
								requestId: cursorRow.requestId,
							})
						: null,
				},
			} satisfies OperatorSafetyAnomalyListResult;
		},

		async getCostSummary(filters: NormalizedOperatorOverviewFilters) {
			const { bounds, rows } = await loadObservabilityRows(runtime, filters);

			return {
				asOf: bounds.to.toISOString(),
				summary: {
					byModel: aggregateCostByModel(rows),
					bySurface: aggregateCostBySurface(rows),
					estimatedCost: {
						currency: "USD",
						microusd: sumNullableInteger(rows, (row) => row.estimatedCostMicrousd),
					},
					tokens: {
						cachedInput: sumNullableInteger(rows, (row) => row.cachedInputTokens),
						input: sumNullableInteger(rows, (row) => row.inputTokens),
						output: sumNullableInteger(rows, (row) => row.outputTokens),
					},
				},
				window: buildResultWindow(bounds),
			} satisfies OperatorCostSummaryResult;
		},

		async getCostTimeseries(filters: NormalizedOperatorOverviewFilters) {
			const { bounds, rows } = await loadObservabilityRows(runtime, filters);
			const granularity = resolveResultGranularity(filters, bounds);
			const grouped = new Map<
				string,
				{
					bucketStart: string;
					bucketEnd: string;
					inputTokens: number;
					outputTokens: number;
					cachedInputTokens: number;
					estimatedCostMicrousd: number;
				}
			>();

			for (const row of rows) {
				const bucketStartDate = resolveBucketStart(row.startedAt.toISOString(), granularity);
				const bucketStart = bucketStartDate.toISOString();
				const current = grouped.get(bucketStart) ?? {
					bucketEnd: addGranularity(bucketStartDate, granularity).toISOString(),
					bucketStart,
					cachedInputTokens: 0,
					estimatedCostMicrousd: 0,
					inputTokens: 0,
					outputTokens: 0,
				};
				current.inputTokens += row.inputTokens ?? 0;
				current.outputTokens += row.outputTokens ?? 0;
				current.cachedInputTokens += row.cachedInputTokens ?? 0;
				current.estimatedCostMicrousd += row.estimatedCostMicrousd ?? 0;
				grouped.set(bucketStart, current);
			}

			return {
				asOf: bounds.to.toISOString(),
				series: [...grouped.values()].sort((left, right) =>
					left.bucketStart.localeCompare(right.bucketStart),
				),
				window: {
					from: bounds.from.toISOString(),
					granularity,
					to: bounds.to.toISOString(),
				},
			} satisfies OperatorCostTimeseriesResult;
		},
	};
}
