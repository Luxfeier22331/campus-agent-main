import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import {
	qualityBadcaseProjection,
	qualityGradeProjection,
	requestObservabilityFact,
} from "../../../db/schema";
import type {
	NormalizedOperatorOverviewFilters,
	NormalizedOperatorQualityBadcaseListFilters,
	NormalizedOperatorSafetyAnomalyListFilters,
	OperatorCostSummaryResult,
	OperatorCostTimeseriesResult,
	OperatorOverviewResult,
	OperatorQualityBadcaseListResult,
	OperatorQualitySummaryResult,
	OperatorQualityTimeseriesResult,
	OperatorSafetyAnomalyListResult,
	OperatorSafetySummaryResult,
} from "../service";
import { decodeSafetyAnomalyCursor, encodeSafetyAnomalyCursor } from "./cursors";
import { loadObservabilityRows, loadQualityGradeRows, loadQualityRollupRows } from "./loaders";
import type { OperatorQueryRuntime } from "./runtime";
import {
	buildSafetyAlerts,
	buildSafetyAnomalyId,
	inferSafetyAnomalySeverity,
	summarizeSafetyAnomaly,
} from "./safety";
import {
	addGranularity,
	aggregateCostByModel,
	aggregateCostBySurface,
	buildGradeBucketMap,
	buildResultWindow,
	inferGradeDomainFromCauseClass,
	loadTraceBacklinksByRequestIds,
	percentile,
	resolveBucketStart,
	resolveResultGranularity,
	sumNullableInteger,
	toLinks,
	toRatio,
	toScore,
} from "./shared";

export function createMetricStoreHandlers(runtime: OperatorQueryRuntime) {
	return {
		async getOverview(filters: NormalizedOperatorOverviewFilters) {
			const { bounds, rows } = await loadObservabilityRows(runtime, filters);

			const total = rows.length;
			const durations = rows
				.map((row) => row.durationMs)
				.filter((value): value is number => typeof value === "number");
			const retrievalEligible = rows.filter((row) => row.retrievalAttempted === true);
			const citationEligible = rows.filter((row) => row.citationExpected === true);
			const refusalCount = rows.filter(
				(row) =>
					row.status === "needs_clarification" ||
					row.status === "no_answer" ||
					row.status === "approval_required" ||
					row.status === "rejected",
			).length;
			const estimatedCostMicrousd = rows.reduce(
				(sum, row) => sum + (row.estimatedCostMicrousd ?? 0),
				0,
			);

			return {
				alerts: buildSafetyAlerts({
					asOf: bounds.to,
					rows,
				}),
				asOf: bounds.to.toISOString(),
				overview: {
					aclAnomalyRate: toRatio(rows.filter((row) => Boolean(row.aclAnomalyCode)).length, total),
					citationMissRate: toRatio(
						citationEligible.filter((row) => row.citationMissing === true).length,
						citationEligible.length,
					),
					emptyRecallRate: toRatio(
						retrievalEligible.filter((row) => row.emptyRecall === true).length,
						retrievalEligible.length,
					),
					estimatedCost: {
						currency: "USD",
						microusd: estimatedCostMicrousd,
					},
					failureRate: toRatio(rows.filter((row) => row.status === "error").length, total),
					latency: {
						p50Ms: percentile(durations, 50),
						p95Ms: percentile(durations, 95),
						p99Ms: percentile(durations, 99),
					},
					refusalRate: toRatio(refusalCount, total),
					requestVolume: {
						accepted: total,
						completed: rows.filter((row) => row.status === "completed").length,
						errored: rows.filter((row) => row.status === "error").length,
					},
					sinkHealth: {
						missingTraceRate: toRatio(
							rows.filter((row) => row.traceAvailable === false).length,
							total,
						),
						projectionFailureCount: 0,
					},
				},
				window: buildResultWindow(bounds),
			} satisfies OperatorOverviewResult;
		},

		async getQualitySummary(filters: NormalizedOperatorOverviewFilters) {
			const { bounds, rows } = await loadObservabilityRows(runtime, filters);
			const retrievalEligible = rows.filter((row) => row.retrievalAttempted === true);
			const citationEligible = rows.filter((row) => row.citationExpected === true);
			const { rows: gradeRows } = await loadQualityGradeRows(runtime, filters);
			const gradesByRequest = buildGradeBucketMap(gradeRows);
			const requestIds = new Set(rows.map((row) => row.requestId));
			const coveredRequestIds = [...gradesByRequest.keys()].filter((requestId) =>
				requestIds.has(requestId),
			);
			const groundingRows = gradeRows.filter((row) => row.gradeDomain === "grounding");
			const citationRows = gradeRows.filter((row) => row.gradeDomain === "citation");
			const policyRows = gradeRows.filter((row) => row.gradeDomain === "policy");
			const sampledGrades =
				gradeRows.length === 0
					? null
					: {
							badcaseOpenCount: rows.filter(
								(row) => row.citationExpected === true && row.citationMissing === true,
							).length,
							citationPassRate: toRatio(
								citationRows.filter((row) => row.verdict === "pass").length,
								citationRows.length,
							),
							coverageRate: toRatio(coveredRequestIds.length, rows.length),
							groundingPassRate: toRatio(
								groundingRows.filter((row) => row.verdict === "pass").length,
								groundingRows.length,
							),
							policyPassRate: toRatio(
								policyRows.filter((row) => row.verdict === "pass").length,
								policyRows.length,
							),
						};

			return {
				asOf: bounds.to.toISOString(),
				runtime: {
					citationMissRate: toRatio(
						citationEligible.filter((row) => row.citationMissing === true).length,
						citationEligible.length,
					),
					emptyRecallRate: toRatio(
						retrievalEligible.filter((row) => row.emptyRecall === true).length,
						retrievalEligible.length,
					),
					refusalDistribution: {
						approvalRequired: rows.filter((row) => row.status === "approval_required").length,
						needsClarification: rows.filter((row) => row.status === "needs_clarification").length,
						noAnswer: rows.filter((row) => row.status === "no_answer").length,
						rejected: rows.filter((row) => row.status === "rejected").length,
					},
					requestCount: rows.length,
				},
				sampledGrades,
				window: buildResultWindow(bounds),
			} satisfies OperatorQualitySummaryResult;
		},

		async getQualityTimeseries(filters: NormalizedOperatorOverviewFilters) {
			const { bounds, granularity, rows } = await loadQualityRollupRows(runtime, filters);
			const { rows: groundingGrades } = await loadQualityGradeRows(runtime, filters, {
				gradeDomain: "grounding",
			});
			const grouped = new Map<string, typeof rows>();
			const groundingByBucket = new Map<string, typeof groundingGrades>();

			for (const row of rows) {
				const key = row.bucketStart.toISOString();
				const current = grouped.get(key) ?? [];
				current.push(row);
				grouped.set(key, current);
			}

			for (const row of groundingGrades) {
				const bucketKey = resolveBucketStart(
					row.requestStartedAt.toISOString(),
					granularity,
				).toISOString();
				const current = groundingByBucket.get(bucketKey) ?? [];
				current.push(row);
				groundingByBucket.set(bucketKey, current);
			}

			return {
				asOf: bounds.to.toISOString(),
				series: [...grouped.entries()].map(([bucketStart, bucketRows]) => {
					const metrics = bucketRows.reduce(
						(acc, row) => {
							acc.requestCount += row.metricsJson.requestCount;
							acc.retrievalEligibleCount += row.metricsJson.retrievalEligibleCount;
							acc.emptyRecallCount += row.metricsJson.emptyRecallCount;
							acc.citationEligibleCount += row.metricsJson.citationEligibleCount;
							acc.citationMissCount += row.metricsJson.citationMissCount;
							acc.noAnswerCount += row.metricsJson.noAnswerCount;
							acc.needsClarificationCount += row.metricsJson.needsClarificationCount;
							return acc;
						},
						{
							citationEligibleCount: 0,
							citationMissCount: 0,
							emptyRecallCount: 0,
							needsClarificationCount: 0,
							noAnswerCount: 0,
							requestCount: 0,
							retrievalEligibleCount: 0,
						},
					);

					return {
						bucketEnd: bucketRows[0]!.bucketEnd.toISOString(),
						bucketStart,
						citationMissRate:
							metrics.citationEligibleCount > 0
								? Number((metrics.citationMissCount / metrics.citationEligibleCount).toFixed(4))
								: 0,
						emptyRecallRate:
							metrics.retrievalEligibleCount > 0
								? Number((metrics.emptyRecallCount / metrics.retrievalEligibleCount).toFixed(4))
								: 0,
						needsClarificationRate:
							metrics.requestCount > 0
								? Number((metrics.needsClarificationCount / metrics.requestCount).toFixed(4))
								: 0,
						noAnswerRate:
							metrics.requestCount > 0
								? Number((metrics.noAnswerCount / metrics.requestCount).toFixed(4))
								: 0,
						requestCount: metrics.requestCount,
						sampledGroundingPassRate: (() => {
							const gradeRows = groundingByBucket.get(bucketStart) ?? [];
							if (gradeRows.length === 0) {
								return null;
							}
							return Number(
								(
									gradeRows.filter((row) => row.verdict === "pass").length / gradeRows.length
								).toFixed(4),
							);
						})(),
					};
				}),
				window: {
					from: bounds.from.toISOString(),
					granularity,
					to: bounds.to.toISOString(),
				},
			} satisfies OperatorQualityTimeseriesResult;
		},

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
			const db = await runtime.getDb();
			const conditions = [isNotNull(requestObservabilityFact.aclAnomalyCode)];

			if (filters.anomalyCode) {
				conditions.push(eq(requestObservabilityFact.aclAnomalyCode, filters.anomalyCode));
			}

			const rows = await db
				.select()
				.from(requestObservabilityFact)
				.where(and(...conditions))
				.orderBy(
					desc(requestObservabilityFact.startedAt),
					desc(requestObservabilityFact.requestId),
				);

			const cursor = filters.cursor ? decodeSafetyAnomalyCursor(filters.cursor) : null;
			const filteredRows = rows.filter((row) => {
				const severity = inferSafetyAnomalySeverity(row);
				const status = "open" as const;

				if (filters.severity && severity !== filters.severity) {
					return false;
				}
				if (filters.status && status !== filters.status) {
					return false;
				}
				if (!cursor) {
					return true;
				}

				const detectedAt = row.startedAt.toISOString();
				return (
					detectedAt < cursor.detectedAt ||
					(detectedAt === cursor.detectedAt && row.requestId < cursor.requestId)
				);
			});

			const visibleRows = filteredRows.slice(0, filters.limit);
			const nextRow = filteredRows[filters.limit];
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
					selectedTarget: row.selectedTarget ?? null,
					severity: inferSafetyAnomalySeverity(row),
					status: "open" as const,
					summary: summarizeSafetyAnomaly(row),
					surface: row.surface,
					traceId: row.traceId,
				})),
				page: {
					nextCursor: nextRow
						? encodeSafetyAnomalyCursor({
								detectedAt: nextRow.startedAt.toISOString(),
								requestId: nextRow.requestId,
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

		async listQualityBadcases(filters: NormalizedOperatorQualityBadcaseListFilters) {
			const db = await runtime.getDb();
			const conditions = [];

			if (filters.status) {
				conditions.push(eq(qualityBadcaseProjection.status, filters.status));
			}
			if (filters.causeClass) {
				conditions.push(eq(qualityBadcaseProjection.causeClass, filters.causeClass));
			}
			if (filters.detectedBy) {
				conditions.push(eq(qualityBadcaseProjection.detectedBy, filters.detectedBy));
			}

			const baseQuery =
				conditions.length > 0
					? db
							.select()
							.from(qualityBadcaseProjection)
							.where(and(...conditions))
					: db.select().from(qualityBadcaseProjection);
			const rows = await baseQuery
				.orderBy(desc(qualityBadcaseProjection.openedAt), desc(qualityBadcaseProjection.badcaseId))
				.limit(filters.limit + 1);
			const visibleRows = rows.slice(0, filters.limit);
			const backlinksByRequestId = await loadTraceBacklinksByRequestIds(
				db,
				visibleRows.map((row) => row.requestId),
			);
			const gradeDomainsByRequest = new Map<string, string>();
			for (const row of visibleRows) {
				const inferred = inferGradeDomainFromCauseClass(row.causeClass);
				if (inferred) {
					gradeDomainsByRequest.set(row.requestId, inferred);
				}
			}
			const gradeRows =
				gradeDomainsByRequest.size === 0
					? []
					: await db
							.select()
							.from(qualityGradeProjection)
							.where(inArray(qualityGradeProjection.requestId, [...gradeDomainsByRequest.keys()]))
							.orderBy(
								desc(qualityGradeProjection.requestStartedAt),
								desc(qualityGradeProjection.sampledAt),
								desc(qualityGradeProjection.gradeId),
							);
			const latestGrades = buildGradeBucketMap(gradeRows);

			const items = visibleRows.map((row) => {
				const inferredDomain = gradeDomainsByRequest.get(row.requestId) ?? null;
				const latestGrade = inferredDomain
					? (latestGrades.get(row.requestId)?.byDomain.get(inferredDomain) ?? null)
					: (latestGrades.get(row.requestId)?.latest ?? null);

				return {
					badcaseId: row.badcaseId,
					causeClass: row.causeClass,
					detectedBy: row.detectedBy,
					grade: latestGrade
						? {
								graderVersion: latestGrade.graderVersion,
								result: latestGrade.verdict,
								score: toScore(latestGrade.scoreMilli),
							}
						: row.gradeJson,
					links: toLinks(backlinksByRequestId.get(row.requestId)),
					openedAt: row.openedAt.toISOString(),
					requestId: row.requestId,
					selectedTarget: row.selectedTarget ?? null,
					status: row.status,
					summary: row.summary,
					surface: row.surface,
					traceId: row.traceId,
				};
			});
			const nextRow = rows[filters.limit];

			return {
				badcases: items,
				page: {
					nextCursor: nextRow ? nextRow.badcaseId : null,
				},
			} satisfies OperatorQualityBadcaseListResult;
		},
	};
}
