import { and, desc, eq, gte, inArray, lt, or, type SQL } from "drizzle-orm";

import {
	qualityBadcaseProjection,
	qualityGradeProjection,
	requestObservabilityFact,
} from "../../../db/schema";
import type {
	NormalizedOperatorOverviewFilters,
	NormalizedOperatorQualityBadcaseListFilters,
	OperatorDistributionBucket,
	OperatorQualityBadcaseListResult,
	OperatorQualityEvalCandidateListResult,
	OperatorQualitySummaryResult,
	OperatorQualityTimeseriesResult,
} from "../service";
import { decodeQualityBadcaseCursor, encodeQualityBadcaseCursor } from "./cursors";
import {
	loadMessageFeedbackRowsByRequestIds,
	loadObservabilityRows,
	loadQualityGradeRows,
	loadQualityRollupRows,
} from "./loaders";
import type {
	MessageFeedbackRow,
	OperatorQueryRuntime,
	RequestObservabilityFactRow,
} from "./runtime";
import {
	buildGradeBucketMap,
	buildResultWindow,
	inferGradeDomainFromCauseClass,
	inferStepDiagnosisStage,
	loadRunBacklinksByRequestIds,
	loadTraceBacklinksByRequestIds,
	resolveBucketStart,
	resolveWindowBounds,
	toLinks,
	toRatio,
	toScore,
} from "./shared";

const FEEDBACK_ELIGIBLE_STATUSES = new Set(["completed", "needs_clarification", "no_answer"]);
const NEGATIVE_FEEDBACK_DETECTED_BY = "negative_feedback";

type QualityEvalCandidate = OperatorQualityEvalCandidateListResult["candidates"][number];
type RuntimeQualityEvalCandidate = QualityEvalCandidate & {
	requestId: string;
	runId: string | null;
	traceId: string;
};
type SuggestedReviewLabel = NonNullable<QualityEvalCandidate["review"]>["suggestedLabels"][number];

function isFeedbackEligibleAnswer(row: Pick<RequestObservabilityFactRow, "status">): boolean {
	return FEEDBACK_ELIGIBLE_STATUSES.has(row.status);
}

function toRate(count: number, eligibleCount: number): number {
	return eligibleCount > 0 ? Number((count / eligibleCount).toFixed(4)) : 0;
}

function incrementBucket(map: Map<string, number>, value: string): void {
	map.set(value, (map.get(value) ?? 0) + 1);
}

function toDistribution(map: Map<string, number>): OperatorDistributionBucket[] {
	return [...map.entries()].map(([value, count]) => ({ count, value }));
}

function reasonCodesFor(row: Pick<MessageFeedbackRow, "reasonCodesJson">): string[] {
	const reasonCodes = row.reasonCodesJson;
	if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
		return ["unspecified"];
	}

	return reasonCodes.filter((reasonCode): reasonCode is string => typeof reasonCode === "string");
}

function latestFeedbackByRequestId(rows: MessageFeedbackRow[]): MessageFeedbackRow[] {
	const latestByRequestId = new Map<string, MessageFeedbackRow>();

	for (const row of rows) {
		const current = latestByRequestId.get(row.requestId);
		if (!current || row.updatedAt.valueOf() >= current.updatedAt.valueOf()) {
			latestByRequestId.set(row.requestId, row);
		}
	}

	return [...latestByRequestId.values()];
}

function answerKindFor(row: Pick<RequestObservabilityFactRow, "status">): string {
	if (row.status === "completed") {
		return "answer";
	}
	if (row.status === "needs_clarification") {
		return "clarification";
	}
	return row.status;
}

function capabilityFor(
	row: Pick<RequestObservabilityFactRow, "intentCapability" | "requestedCapability">,
): string {
	return row.intentCapability ?? row.requestedCapability ?? "unknown";
}

function citationPostureFor(
	row: Pick<RequestObservabilityFactRow, "citationExpected" | "citationMissing">,
): string {
	if (row.citationExpected === true && row.citationMissing === true) {
		return "citation_missing";
	}
	if (row.citationExpected === true) {
		return "citation_present";
	}
	if (row.citationExpected === false) {
		return "citation_not_expected";
	}
	return "unknown";
}

function buildFeedbackSummary(
	rows: RequestObservabilityFactRow[],
	feedbackRows: MessageFeedbackRow[],
): OperatorQualitySummaryResult["runtime"]["feedback"] {
	const eligibleRows = rows.filter(isFeedbackEligibleAnswer);
	const eligibleByRequestId = new Map(eligibleRows.map((row) => [row.requestId, row]));
	const feedbackEntries = latestFeedbackByRequestId(feedbackRows)
		.map((feedback) => ({
			feedback,
			request: eligibleByRequestId.get(feedback.requestId) ?? null,
		}))
		.filter(
			(entry): entry is { feedback: MessageFeedbackRow; request: RequestObservabilityFactRow } =>
				entry.request !== null,
		);
	const helpfulCount = feedbackEntries.filter((entry) => entry.feedback.vote === "helpful").length;
	const unhelpfulCount = feedbackEntries.filter(
		(entry) => entry.feedback.vote === "unhelpful",
	).length;
	const noAnswerEligibleCount = eligibleRows.filter((row) => row.status === "no_answer").length;
	const noAnswerUnhelpfulCount = feedbackEntries.filter(
		(entry) => entry.request.status === "no_answer" && entry.feedback.vote === "unhelpful",
	).length;

	const surface = new Map<string, number>();
	const answerKind = new Map<string, number>();
	const capability = new Map<string, number>();
	const citationPosture = new Map<string, number>();
	const reasonCode = new Map<string, number>();
	const vote = new Map<string, number>();

	for (const entry of feedbackEntries) {
		incrementBucket(surface, entry.request.surface);
		incrementBucket(answerKind, answerKindFor(entry.request));
		incrementBucket(capability, capabilityFor(entry.request));
		incrementBucket(citationPosture, citationPostureFor(entry.request));
		incrementBucket(vote, entry.feedback.vote);
		for (const code of reasonCodesFor(entry.feedback)) {
			incrementBucket(reasonCode, code);
		}
	}

	return {
		coverageRate: toRatio(feedbackEntries.length, eligibleRows.length),
		distributions: {
			answerKind: toDistribution(answerKind),
			capability: toDistribution(capability),
			citationPosture: toDistribution(citationPosture),
			reasonCode: toDistribution(reasonCode),
			surface: toDistribution(surface),
			vote: toDistribution(vote),
		},
		feedbackCount: feedbackEntries.length,
		helpfulRate: toRatio(helpfulCount, feedbackEntries.length),
		noAnswerUnhelpfulRate: toRatio(noAnswerUnhelpfulCount, noAnswerEligibleCount),
		unhelpfulRate: toRatio(unhelpfulCount, feedbackEntries.length),
	};
}

function buildFeedbackMetricsByBucket(
	rows: RequestObservabilityFactRow[],
	feedbackRows: MessageFeedbackRow[],
	granularity: OperatorQualityTimeseriesResult["window"]["granularity"],
) {
	const eligibleRows = rows.filter(isFeedbackEligibleAnswer);
	const eligibleByRequestId = new Map(eligibleRows.map((row) => [row.requestId, row]));
	const metricsByBucket = new Map<
		string,
		{
			eligibleAnswerCount: number;
			feedbackCount: number;
			helpfulCount: number;
			unhelpfulCount: number;
			noAnswerEligibleCount: number;
			noAnswerUnhelpfulCount: number;
		}
	>();
	const ensureBucket = (bucketStart: string) => {
		const current = metricsByBucket.get(bucketStart);
		if (current) {
			return current;
		}
		const next = {
			eligibleAnswerCount: 0,
			feedbackCount: 0,
			helpfulCount: 0,
			noAnswerEligibleCount: 0,
			noAnswerUnhelpfulCount: 0,
			unhelpfulCount: 0,
		};
		metricsByBucket.set(bucketStart, next);
		return next;
	};

	for (const row of eligibleRows) {
		const bucketStart = resolveBucketStart(row.startedAt.toISOString(), granularity).toISOString();
		const metrics = ensureBucket(bucketStart);
		metrics.eligibleAnswerCount += 1;
		if (row.status === "no_answer") {
			metrics.noAnswerEligibleCount += 1;
		}
	}

	for (const feedback of latestFeedbackByRequestId(feedbackRows)) {
		const request = eligibleByRequestId.get(feedback.requestId);
		if (!request) {
			continue;
		}
		const bucketStart = resolveBucketStart(
			request.startedAt.toISOString(),
			granularity,
		).toISOString();
		const metrics = ensureBucket(bucketStart);
		metrics.feedbackCount += 1;
		if (feedback.vote === "helpful") {
			metrics.helpfulCount += 1;
		}
		if (feedback.vote === "unhelpful") {
			metrics.unhelpfulCount += 1;
			if (request.status === "no_answer") {
				metrics.noAnswerUnhelpfulCount += 1;
			}
		}
	}

	return metricsByBucket;
}

function inferFeedbackReviewLabels(
	reasonCodes: string[],
	row: RequestObservabilityFactRow,
): SuggestedReviewLabel[] {
	const labels = new Set<SuggestedReviewLabel>();

	for (const reasonCode of reasonCodes) {
		if (reasonCode === "wrong_intent") {
			labels.add("wrong_intent");
		}
		if (reasonCode === "outdated_or_missing_source") {
			labels.add("stale_missing_evidence");
		}
		if (reasonCode === "incorrect_answer") {
			labels.add("false_positive");
		}
		if (
			reasonCode === "not_enough_detail" ||
			reasonCode === "unclear_or_hard_to_use" ||
			reasonCode === "other"
		) {
			labels.add("answer_style_issue");
		}
	}

	if (row.status === "no_answer") {
		labels.add("false_negative");
	}

	if (labels.size === 0) {
		labels.add("answer_style_issue");
	}

	return [...labels];
}

function feedbackCauseClass(labels: SuggestedReviewLabel[]): string {
	return labels[0] ?? "answer_style_issue";
}

function feedbackEvalFamily(
	causeClass: string,
): QualityEvalCandidate["intake"]["suggestedEvalFamily"] {
	if (causeClass === "wrong_intent") {
		return "intent";
	}
	if (causeClass === "stale_missing_evidence") {
		return "citation";
	}
	if (causeClass === "false_positive" || causeClass === "false_negative") {
		return "grounding";
	}

	return "unknown";
}

function compactIntent(
	row: RequestObservabilityFactRow,
): NonNullable<QualityEvalCandidate["correlation"]>["intent"] {
	const intent: NonNullable<QualityEvalCandidate["correlation"]>["intent"] = {};
	if (row.intentCapability) {
		intent.capability = row.intentCapability;
	}
	if (row.intentTaskKind) {
		intent.taskKind = row.intentTaskKind;
	}
	if (row.intentLaunchState) {
		intent.launchState = row.intentLaunchState;
	}
	if (row.intentNextAction) {
		intent.nextAction = row.intentNextAction;
	}
	if (row.intentScopeClass) {
		intent.scopeClass = row.intentScopeClass;
	}
	if (row.intentClassifierVersion) {
		intent.classifierVersion = row.intentClassifierVersion;
	}
	return intent;
}

function feedbackSummary(answerKind: string, reasonCodes: string[]): string {
	const reasons = reasonCodes.length > 0 ? reasonCodes.join(", ") : "unspecified";
	return `Negative answer feedback for ${answerKind}: ${reasons}.`;
}

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
			const feedbackRows = await loadMessageFeedbackRowsByRequestIds(runtime, [...requestIds]);

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
					feedback: buildFeedbackSummary(rows, feedbackRows),
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
			const { rows: observabilityRows } = await loadObservabilityRows(runtime, filters);
			const feedbackRows = await loadMessageFeedbackRowsByRequestIds(
				runtime,
				observabilityRows.map((row) => row.requestId),
			);
			const feedbackByBucket = buildFeedbackMetricsByBucket(
				observabilityRows,
				feedbackRows,
				granularity,
			);
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
					const feedbackMetrics = feedbackByBucket.get(bucketStart) ?? {
						eligibleAnswerCount: 0,
						feedbackCount: 0,
						helpfulCount: 0,
						noAnswerEligibleCount: 0,
						noAnswerUnhelpfulCount: 0,
						unhelpfulCount: 0,
					};
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
						feedbackCount: feedbackMetrics.feedbackCount,
						feedbackCoverageRate: toRate(
							feedbackMetrics.feedbackCount,
							feedbackMetrics.eligibleAnswerCount,
						),
						feedbackEligibleAnswerCount: feedbackMetrics.eligibleAnswerCount,
						feedbackHelpfulCount: feedbackMetrics.helpfulCount,
						feedbackHelpfulRate: toRate(
							feedbackMetrics.helpfulCount,
							feedbackMetrics.feedbackCount,
						),
						feedbackNoAnswerEligibleCount: feedbackMetrics.noAnswerEligibleCount,
						feedbackNoAnswerUnhelpfulCount: feedbackMetrics.noAnswerUnhelpfulCount,
						feedbackNoAnswerUnhelpfulRate: toRate(
							feedbackMetrics.noAnswerUnhelpfulCount,
							feedbackMetrics.noAnswerEligibleCount,
						),
						feedbackUnhelpfulCount: feedbackMetrics.unhelpfulCount,
						feedbackUnhelpfulRate: toRate(
							feedbackMetrics.unhelpfulCount,
							feedbackMetrics.feedbackCount,
						),
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
			if (filters.surface) {
				conditions.push(eq(qualityBadcaseProjection.surface, filters.surface));
			}
			if (filters.selectedTarget) {
				conditions.push(eq(qualityBadcaseProjection.selectedTarget, filters.selectedTarget));
			}
			if (filters.window) {
				const bounds = resolveWindowBounds(filters.window, runtime.now());
				conditions.push(gte(qualityBadcaseProjection.openedAt, bounds.from));
				conditions.push(lt(qualityBadcaseProjection.openedAt, bounds.to));
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
			const runBacklinksByRequestId = await loadRunBacklinksByRequestIds(
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
					diagnosisStage: inferStepDiagnosisStage({ causeClass: row.causeClass }),
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
					runId: runBacklinksByRequestId.get(row.requestId) ?? null,
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

		async listQualityFeedbackEvalCandidates(filters: NormalizedOperatorQualityBadcaseListFilters) {
			if (
				(filters.detectedBy && filters.detectedBy !== NEGATIVE_FEEDBACK_DETECTED_BY) ||
				(filters.status && filters.status !== "pending_review")
			) {
				return {
					candidates: [],
					page: {
						nextCursor: null,
					},
				} satisfies OperatorQualityEvalCandidateListResult;
			}

			const db = await runtime.getDb();
			const conditions: SQL[] = [];
			if (filters.window) {
				const bounds = resolveWindowBounds(filters.window, runtime.now());
				conditions.push(gte(requestObservabilityFact.startedAt, bounds.from));
				conditions.push(lt(requestObservabilityFact.startedAt, bounds.to));
			}
			if (filters.surface) {
				conditions.push(eq(requestObservabilityFact.surface, filters.surface));
			}
			if (filters.selectedTarget) {
				conditions.push(eq(requestObservabilityFact.selectedTarget, filters.selectedTarget));
			}

			const observabilityQuery = db.select().from(requestObservabilityFact);
			const observabilityRows =
				conditions.length > 0
					? await observabilityQuery.where(and(...conditions))
					: await observabilityQuery;
			const requestRowsById = new Map(
				observabilityRows.filter(isFeedbackEligibleAnswer).map((row) => [row.requestId, row]),
			);
			const feedbackRows = await loadMessageFeedbackRowsByRequestIds(runtime, [
				...requestRowsById.keys(),
			]);
			const candidates = latestFeedbackByRequestId(feedbackRows)
				.filter((feedback) => feedback.vote === "unhelpful")
				.map((feedback): RuntimeQualityEvalCandidate | null => {
					const requestRow = requestRowsById.get(feedback.requestId);
					if (!requestRow) {
						return null;
					}
					const reasonCodes = reasonCodesFor(feedback).filter((code) => code !== "unspecified");
					const reviewLabels = inferFeedbackReviewLabels(reasonCodes, requestRow);
					const causeClass = feedbackCauseClass(reviewLabels);
					if (filters.causeClass && filters.causeClass !== causeClass) {
						return null;
					}
					const answerKind = answerKindFor(requestRow);

					return {
						candidateId: `eval_candidate:negative_feedback:${feedback.feedbackId}`,
						causeClass,
						diagnosisStage: inferStepDiagnosisStage({ causeClass }),
						correlation: {
							answerKind,
							assistantMessageId: feedback.messageId,
							citationPosture: citationPostureFor(requestRow),
							conversationId: feedback.conversationId,
							intent: compactIntent(requestRow),
						},
						feedback: {
							feedbackId: feedback.feedbackId,
							reasonCodes,
							updatedAt: feedback.updatedAt.toISOString(),
							vote: "unhelpful",
						},
						grade: null,
						intake: {
							createdAt: feedback.updatedAt.toISOString(),
							source: NEGATIVE_FEEDBACK_DETECTED_BY,
							status: "pending_review",
							suggestedEvalFamily: feedbackEvalFamily(causeClass),
						},
						links: {
							issueFingerprint: null,
							issueLink: null,
							traceLink: null,
						},
						privacy: {
							providerRawResponseIncluded: false,
							rawAuthMaterialIncluded: false,
							rawTranscriptIncluded: false,
						},
						requestId: feedback.requestId,
						review: {
							suggestedLabels: reviewLabels,
						},
						runId: null,
						selectedTarget: requestRow.selectedTarget ?? null,
						summary: feedbackSummary(answerKind, reasonCodes),
						surface: requestRow.surface,
						traceId: requestRow.traceId,
					};
				})
				.filter((candidate): candidate is RuntimeQualityEvalCandidate => candidate !== null)
				.sort((left, right) => {
					const byTime = Date.parse(right.intake.createdAt) - Date.parse(left.intake.createdAt);
					if (byTime !== 0) {
						return byTime;
					}
					return right.candidateId.localeCompare(left.candidateId);
				})
				.slice(0, filters.limit);

			const backlinksByRequestId = await loadTraceBacklinksByRequestIds(
				db,
				candidates.map((candidate) => candidate.requestId),
			);
			const runBacklinksByRequestId = await loadRunBacklinksByRequestIds(
				db,
				candidates.map((candidate) => candidate.requestId),
			);

			return {
				candidates: candidates.map((candidate) => ({
					...candidate,
					links: toLinks(backlinksByRequestId.get(candidate.requestId)),
					runId: runBacklinksByRequestId.get(candidate.requestId) ?? null,
				})),
				page: {
					nextCursor: null,
				},
			} satisfies OperatorQualityEvalCandidateListResult;
		},
	};
}
