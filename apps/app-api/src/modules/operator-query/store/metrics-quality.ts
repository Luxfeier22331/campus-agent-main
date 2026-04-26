import { and, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";

import { qualityBadcaseProjection, qualityGradeProjection } from "../../../db/schema";
import type {
	NormalizedOperatorOverviewFilters,
	NormalizedOperatorQualityBadcaseListFilters,
	OperatorQualityBadcaseListResult,
	OperatorQualitySummaryResult,
	OperatorQualityTimeseriesResult,
} from "../service";
import { decodeQualityBadcaseCursor, encodeQualityBadcaseCursor } from "./cursors";
import { loadObservabilityRows, loadQualityGradeRows, loadQualityRollupRows } from "./loaders";
import type { OperatorQueryRuntime } from "./runtime";
import {
	buildGradeBucketMap,
	buildResultWindow,
	inferGradeDomainFromCauseClass,
	loadTraceBacklinksByRequestIds,
	resolveBucketStart,
	toLinks,
	toRatio,
	toScore,
} from "./shared";

export function createQualityMetricHandlers(runtime: OperatorQueryRuntime) {
	return {
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
			const intentRows = gradeRows.filter((row) => row.gradeDomain === "intent");
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
							intentPassRate: toRatio(
								intentRows.filter((row) => row.verdict === "pass").length,
								intentRows.length,
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

					const bucketEnd = bucketRows[0]?.bucketEnd ?? new Date(bucketStart);
					return {
						bucketEnd: bucketEnd.toISOString(),
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

		async listQualityBadcases(filters: NormalizedOperatorQualityBadcaseListFilters) {
			const db = await runtime.getDb();
			const conditions: SQL[] = [];

			if (filters.status) {
				conditions.push(eq(qualityBadcaseProjection.status, filters.status));
			}
			if (filters.causeClass) {
				conditions.push(eq(qualityBadcaseProjection.causeClass, filters.causeClass));
			}
			if (filters.detectedBy) {
				conditions.push(eq(qualityBadcaseProjection.detectedBy, filters.detectedBy));
			}
			const cursor = filters.cursor ? decodeQualityBadcaseCursor(filters.cursor) : null;
			if (cursor) {
				const cursorOpenedAt = new Date(cursor.openedAt);
				const cursorCondition = or(
					lt(qualityBadcaseProjection.openedAt, cursorOpenedAt),
					and(
						eq(qualityBadcaseProjection.openedAt, cursorOpenedAt),
						lt(qualityBadcaseProjection.badcaseId, cursor.badcaseId),
					),
				);
				if (cursorCondition) {
					conditions.push(cursorCondition);
				}
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
			const requestIdsWithInferredGrades = new Set<string>();
			for (const row of visibleRows) {
				const inferred = inferGradeDomainFromCauseClass(row.causeClass);
				if (inferred) {
					requestIdsWithInferredGrades.add(row.requestId);
				}
			}
			const gradeRows =
				requestIdsWithInferredGrades.size === 0
					? []
					: await db
							.select()
							.from(qualityGradeProjection)
							.where(inArray(qualityGradeProjection.requestId, [...requestIdsWithInferredGrades]))
							.orderBy(
								desc(qualityGradeProjection.requestStartedAt),
								desc(qualityGradeProjection.sampledAt),
								desc(qualityGradeProjection.gradeId),
							);
			const latestGrades = buildGradeBucketMap(gradeRows);

			const items = visibleRows.map((row) => {
				const inferredDomain = inferGradeDomainFromCauseClass(row.causeClass);
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
			const cursorRow = rows.length > filters.limit ? visibleRows.at(-1) : null;

			return {
				badcases: items,
				page: {
					nextCursor: cursorRow
						? encodeQualityBadcaseCursor({
								badcaseId: cursorRow.badcaseId,
								openedAt: cursorRow.openedAt.toISOString(),
							})
						: null,
				},
			} satisfies OperatorQualityBadcaseListResult;
		},
	};
}
