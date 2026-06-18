import { beforeEach, expect, it, vi } from "vitest";

import type { OperatorQueryStoreSuiteContext } from "./operator-query.store.suite-context";

export function registerOperatorQueryStoreQualitySuite(ctx: OperatorQueryStoreSuiteContext): void {
	const {
		createPgOperatorQueryStore,
		createRuntimeDatabase,
		encodeBase64UrlJson,
		resetOperatorQueryStoreMocks,
	} = ctx;

	beforeEach(() => {
		resetOperatorQueryStoreMocks();
	});

	it("summarizes answer feedback quality signals with explicit denominators", async () => {
		const observabilityRows = [
			{
				citationExpected: true,
				citationMissing: false,
				emptyRecall: false,
				intentCapability: "knowledge",
				requestId: "req_answer_01",
				requestedCapability: "knowledge",
				retrievalAttempted: true,
				startedAt: new Date("2026-03-28T08:10:00.000Z"),
				status: "completed",
				surface: "campus_web",
			},
			{
				citationExpected: false,
				citationMissing: false,
				emptyRecall: null,
				intentCapability: "campus_services",
				requestId: "req_no_answer_01",
				requestedCapability: "campus_services",
				retrievalAttempted: false,
				startedAt: new Date("2026-03-28T08:20:00.000Z"),
				status: "no_answer",
				surface: "campus_web",
			},
			{
				citationExpected: false,
				citationMissing: false,
				emptyRecall: null,
				intentCapability: "knowledge",
				requestId: "req_clarify_01",
				requestedCapability: "knowledge",
				retrievalAttempted: false,
				startedAt: new Date("2026-03-28T08:30:00.000Z"),
				status: "needs_clarification",
				surface: "campus_web",
			},
			{
				citationExpected: false,
				citationMissing: false,
				emptyRecall: null,
				intentCapability: "knowledge",
				requestId: "req_rejected_01",
				requestedCapability: "knowledge",
				retrievalAttempted: false,
				startedAt: new Date("2026-03-28T08:40:00.000Z"),
				status: "rejected",
				surface: "campus_web",
			},
		];
		const feedbackRows = [
			{
				feedbackId: "feedback_answer_01",
				reasonCodesJson: [],
				requestId: "req_answer_01",
				updatedAt: new Date("2026-03-28T08:11:00.000Z"),
				vote: "helpful",
			},
			{
				feedbackId: "feedback_no_answer_01",
				reasonCodesJson: ["wrong_intent"],
				requestId: "req_no_answer_01",
				updatedAt: new Date("2026-03-28T08:21:00.000Z"),
				vote: "unhelpful",
			},
			{
				feedbackId: "feedback_rejected_01",
				reasonCodesJson: ["unsafe"],
				requestId: "req_rejected_01",
				updatedAt: new Date("2026-03-28T08:41:00.000Z"),
				vote: "unhelpful",
			},
		];
		const observabilityWhere = vi.fn().mockResolvedValue(observabilityRows);
		const gradeOrderBy = vi.fn().mockResolvedValue([]);
		const gradeWhere = vi.fn(() => ({ orderBy: gradeOrderBy }));
		const feedbackWhere = vi.fn().mockResolvedValue(feedbackRows);
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: observabilityWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: gradeWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: feedbackWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never, {
			now: () => new Date("2026-03-28T09:00:00.000Z"),
		});

		const result = await store.getQualitySummary({
			collection: null,
			granularity: null,
			modelName: null,
			principalType: null,
			requestedCapability: null,
			selectedCapability: null,
			surface: null,
			window: "1h",
		});

		expect(result.runtime.feedback).toEqual({
			coverageRate: {
				count: 2,
				eligibleCount: 3,
				value: 0.6667,
			},
			distributions: {
				answerKind: [
					{ count: 1, value: "answer" },
					{ count: 1, value: "no_answer" },
				],
				capability: [
					{ count: 1, value: "knowledge" },
					{ count: 1, value: "campus_services" },
				],
				citationPosture: [
					{ count: 1, value: "citation_present" },
					{ count: 1, value: "citation_not_expected" },
				],
				reasonCode: [
					{ count: 1, value: "unspecified" },
					{ count: 1, value: "wrong_intent" },
				],
				surface: [{ count: 2, value: "campus_web" }],
				vote: [
					{ count: 1, value: "helpful" },
					{ count: 1, value: "unhelpful" },
				],
			},
			feedbackCount: 2,
			helpfulRate: {
				count: 1,
				eligibleCount: 2,
				value: 0.5,
			},
			noAnswerUnhelpfulRate: {
				count: 1,
				eligibleCount: 1,
				value: 1,
			},
			unhelpfulRate: {
				count: 1,
				eligibleCount: 2,
				value: 0.5,
			},
		});
	});

	it("adds feedback denominator fields to quality timeseries buckets", async () => {
		const bucketStart = new Date("2026-03-28T08:00:00.000Z");
		const bucketEnd = new Date("2026-03-28T09:00:00.000Z");
		const rollupRows = [
			{
				bucketEnd,
				bucketStart,
				metricsJson: {
					citationEligibleCount: 1,
					citationMissCount: 0,
					emptyRecallCount: 0,
					needsClarificationCount: 1,
					noAnswerCount: 1,
					requestCount: 3,
					retrievalEligibleCount: 1,
				},
			},
		];
		const observabilityRows = [
			{
				requestId: "req_answer_01",
				startedAt: new Date("2026-03-28T08:10:00.000Z"),
				status: "completed",
			},
			{
				requestId: "req_no_answer_01",
				startedAt: new Date("2026-03-28T08:20:00.000Z"),
				status: "no_answer",
			},
			{
				requestId: "req_clarify_01",
				startedAt: new Date("2026-03-28T08:30:00.000Z"),
				status: "needs_clarification",
			},
		];
		const feedbackRows = [
			{
				feedbackId: "feedback_answer_01",
				reasonCodesJson: [],
				requestId: "req_answer_01",
				updatedAt: new Date("2026-03-28T08:11:00.000Z"),
				vote: "helpful",
			},
			{
				feedbackId: "feedback_no_answer_01",
				reasonCodesJson: ["wrong_intent"],
				requestId: "req_no_answer_01",
				updatedAt: new Date("2026-03-28T08:21:00.000Z"),
				vote: "unhelpful",
			},
		];
		const rollupOrderBy = vi.fn().mockResolvedValue(rollupRows);
		const rollupWhere = vi.fn(() => ({ orderBy: rollupOrderBy }));
		const gradeOrderBy = vi.fn().mockResolvedValue([]);
		const gradeWhere = vi.fn(() => ({ orderBy: gradeOrderBy }));
		const observabilityWhere = vi.fn().mockResolvedValue(observabilityRows);
		const feedbackWhere = vi.fn().mockResolvedValue(feedbackRows);
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: rollupWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: gradeWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: observabilityWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: feedbackWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never, {
			now: () => new Date("2026-03-28T09:00:00.000Z"),
		});

		const result = await store.getQualityTimeseries({
			collection: null,
			granularity: "1h",
			modelName: null,
			principalType: null,
			requestedCapability: null,
			selectedCapability: null,
			surface: null,
			window: "1h",
		});

		expect(result.series[0]).toMatchObject({
			feedbackCount: 2,
			feedbackCoverageRate: 0.6667,
			feedbackEligibleAnswerCount: 3,
			feedbackHelpfulCount: 1,
			feedbackHelpfulRate: 0.5,
			feedbackNoAnswerEligibleCount: 1,
			feedbackNoAnswerUnhelpfulCount: 1,
			feedbackNoAnswerUnhelpfulRate: 1,
			feedbackUnhelpfulCount: 1,
			feedbackUnhelpfulRate: 0.5,
		});
	});

	it("applies quality badcase cursor filters before ordering the next page", async () => {
		const cursor = encodeBase64UrlJson({
			badcaseId: "badcase_02",
			openedAt: "2026-04-01T09:00:00.000Z",
		});
		const badcaseLimit = vi.fn().mockResolvedValue([]);
		const badcaseOrderBy = vi.fn(() => ({ limit: badcaseLimit }));
		const badcaseWhere = vi.fn(() => ({ orderBy: badcaseOrderBy }));
		const select = vi.fn().mockReturnValueOnce({
			from: vi.fn(() => ({
				orderBy: badcaseOrderBy,
				where: badcaseWhere,
			})),
		});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		await store.listQualityBadcases({
			causeClass: null,
			cursor,
			detectedBy: null,
			limit: 10,
			selectedCapability: null,
			status: null,
			surface: null,
			window: null,
		});

		expect(badcaseWhere).toHaveBeenCalledTimes(1);
	});
	it("attaches intent grades to intent classifier badcases", async () => {
		const badcaseRows = [
			{
				badcaseId: "badcase_intent_01",
				causeClass: "intent_classifier_mismatch",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T10:00:00.000Z"),
				requestId: "req_intent_01",
				selectedCapability: "navigation",
				status: "open",
				summary: "Intent classifier selected the wrong target",
				surface: "campus_web",
				traceId: "trace_intent_01",
			},
		];
		const runBacklinkRows = [
			{
				requestId: "req_intent_01",
				runId: "run_intent_01",
			},
		];
		const gradeRows = [
			{
				gradeDomain: "intent",
				gradeId: "grade_intent_01",
				graderVersion: "intent-grader@2026-04-20",
				projectedAt: new Date("2026-04-01T10:00:04.000Z"),
				requestId: "req_intent_01",
				requestStartedAt: new Date("2026-04-01T09:59:58.000Z"),
				sampledAt: new Date("2026-04-01T10:00:03.000Z"),
				scoreMilli: 120,
				verdict: "fail",
			},
		];
		const badcaseLimit = vi.fn().mockResolvedValue(badcaseRows);
		const badcaseOrderBy = vi.fn(() => ({ limit: badcaseLimit }));
		const backlinkWhere = vi.fn().mockResolvedValue([]);
		const runBacklinkLimit = vi.fn().mockResolvedValue(runBacklinkRows);
		const runBacklinkWhere = vi.fn(() => ({ limit: runBacklinkLimit }));
		const gradeOrderBy = vi.fn().mockResolvedValue(gradeRows);
		const gradeWhere = vi.fn(() => ({ orderBy: gradeOrderBy }));

		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					orderBy: badcaseOrderBy,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: backlinkWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: runBacklinkWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: gradeWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.listQualityBadcases({
			causeClass: null,
			cursor: null,
			detectedBy: null,
			limit: 10,
			selectedCapability: null,
			status: null,
			surface: null,
			window: null,
		});

		expect(result.badcases[0]?.grade).toEqual({
			graderVersion: "intent-grader@2026-04-20",
			result: "fail",
			score: 0.12,
		});
		expect(result.badcases[0]?.runId).toBe("run_intent_01");
	});
	it("keeps same-request badcase grades scoped to each inferred quality domain", async () => {
		const badcaseRows = [
			{
				badcaseId: "badcase_citation_01",
				causeClass: "citation_missing",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T10:00:00.000Z"),
				requestId: "req_shared_01",
				selectedCapability: "knowledge",
				status: "open",
				summary: "Citation missing",
				surface: "campus_web",
				traceId: "trace_shared_01",
			},
			{
				badcaseId: "badcase_intent_01",
				causeClass: "intent_classifier_mismatch",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T09:59:00.000Z"),
				requestId: "req_shared_01",
				selectedCapability: "navigation",
				status: "open",
				summary: "Intent classifier selected the wrong target",
				surface: "campus_web",
				traceId: "trace_shared_01",
			},
		];
		const gradeRows = [
			{
				gradeDomain: "intent",
				gradeId: "grade_intent_01",
				graderVersion: "intent-grader@2026-04-20",
				projectedAt: new Date("2026-04-01T10:00:04.000Z"),
				requestId: "req_shared_01",
				requestStartedAt: new Date("2026-04-01T09:59:58.000Z"),
				sampledAt: new Date("2026-04-01T10:00:03.000Z"),
				scoreMilli: 120,
				verdict: "fail",
			},
			{
				gradeDomain: "citation",
				gradeId: "grade_citation_01",
				graderVersion: "citation-grader@2026-04-20",
				projectedAt: new Date("2026-04-01T10:00:02.000Z"),
				requestId: "req_shared_01",
				requestStartedAt: new Date("2026-04-01T09:59:58.000Z"),
				sampledAt: new Date("2026-04-01T10:00:01.000Z"),
				scoreMilli: 900,
				verdict: "pass",
			},
		];
		const badcaseLimit = vi.fn().mockResolvedValue(badcaseRows);
		const badcaseOrderBy = vi.fn(() => ({ limit: badcaseLimit }));
		const backlinkWhere = vi.fn().mockResolvedValue([]);
		const runBacklinkLimit = vi.fn().mockResolvedValue([]);
		const runBacklinkWhere = vi.fn(() => ({ limit: runBacklinkLimit }));
		const gradeOrderBy = vi.fn().mockResolvedValue(gradeRows);
		const gradeWhere = vi.fn(() => ({ orderBy: gradeOrderBy }));

		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					orderBy: badcaseOrderBy,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: backlinkWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: runBacklinkWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: gradeWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.listQualityBadcases({
			causeClass: null,
			cursor: null,
			detectedBy: null,
			limit: 10,
			selectedCapability: null,
			status: null,
			surface: null,
			window: null,
		});

		expect(result.badcases).toEqual([
			expect.objectContaining({
				badcaseId: "badcase_citation_01",
				grade: {
					graderVersion: "citation-grader@2026-04-20",
					result: "pass",
					score: 0.9,
				},
			}),
			expect.objectContaining({
				badcaseId: "badcase_intent_01",
				grade: {
					graderVersion: "intent-grader@2026-04-20",
					result: "fail",
					score: 0.12,
				},
			}),
		]);
	});
}
