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
				surface: "public_chat_web",
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
				surface: "public_chat_web",
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
				surface: "public_chat_web",
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
				surface: "public_chat_web",
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
			selectedTarget: null,
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
				surface: [{ count: 2, value: "public_chat_web" }],
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
			selectedTarget: null,
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

	it("exports negative feedback as reviewable eval candidates without raw sensitive payload", async () => {
		const observabilityRows = [
			{
				citationExpected: true,
				citationMissing: true,
				conversationId: "conv_feedback_01",
				intentCapability: "knowledge",
				intentClassifierVersion: "intent-classifier@2026-04-20",
				intentLaunchState: "open",
				intentNextAction: "delegate",
				intentScopeClass: "in_scope",
				intentTaskKind: "knowledge_lookup",
				requestId: "req_feedback_01",
				requestedCapability: "knowledge",
				selectedTarget: "rag-agent",
				startedAt: new Date("2026-03-28T08:10:00.000Z"),
				status: "completed",
				surface: "public_chat_web",
				traceId: "trace_feedback_01",
			},
			{
				citationExpected: false,
				citationMissing: false,
				conversationId: "conv_feedback_02",
				intentCapability: "campus_services",
				intentClassifierVersion: "intent-classifier@2026-04-20",
				intentLaunchState: "candidate_only",
				intentNextAction: "clarify",
				intentScopeClass: "in_scope",
				intentTaskKind: "campus_services_lookup",
				requestId: "req_feedback_02",
				requestedCapability: "campus_services",
				selectedTarget: null,
				startedAt: new Date("2026-03-28T08:20:00.000Z"),
				status: "no_answer",
				surface: "public_chat_web",
				traceId: "trace_feedback_02",
			},
		];
		const feedbackRows = [
			{
				conversationId: "conv_feedback_01",
				feedbackId: "feedback_01",
				messageId: "msg_assistant_01",
				reasonCodesJson: ["wrong_intent", "outdated_or_missing_source"],
				requestId: "req_feedback_01",
				updatedAt: new Date("2026-03-28T08:11:00.000Z"),
				vote: "unhelpful",
			},
			{
				conversationId: "conv_feedback_02",
				feedbackId: "feedback_02",
				messageId: "msg_assistant_02",
				reasonCodesJson: ["not_enough_detail"],
				requestId: "req_feedback_02",
				updatedAt: new Date("2026-03-28T08:21:00.000Z"),
				vote: "helpful",
			},
		];
		const backlinkRows = [
			{
				issueFingerprint: "feedback-wrong-intent",
				issueLink: null,
				requestId: "req_feedback_01",
				traceLink: "https://sentry.example/traces/trace_feedback_01",
			},
		];
		const observabilityWhere = vi.fn().mockResolvedValue(observabilityRows);
		const feedbackWhere = vi.fn().mockResolvedValue(feedbackRows);
		const backlinkWhere = vi.fn().mockResolvedValue(backlinkRows);
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: observabilityWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: feedbackWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: backlinkWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never, {
			now: () => new Date("2026-03-28T09:00:00.000Z"),
		});

		const result = await store.listQualityFeedbackEvalCandidates({
			causeClass: null,
			cursor: null,
			detectedBy: "negative_feedback",
			limit: 20,
			selectedTarget: null,
			status: null,
			surface: "public_chat_web",
			window: "1h",
		});

		expect(result).toEqual({
			candidates: [
				{
					candidateId: "eval_candidate:negative_feedback:feedback_01",
					causeClass: "wrong_intent",
					correlation: {
						answerKind: "answer",
						assistantMessageId: "msg_assistant_01",
						citationPosture: "citation_missing",
						conversationId: "conv_feedback_01",
						intent: {
							capability: "knowledge",
							classifierVersion: "intent-classifier@2026-04-20",
							launchState: "open",
							nextAction: "delegate",
							scopeClass: "in_scope",
							taskKind: "knowledge_lookup",
						},
					},
					feedback: {
						feedbackId: "feedback_01",
						reasonCodes: ["wrong_intent", "outdated_or_missing_source"],
						updatedAt: "2026-03-28T08:11:00.000Z",
						vote: "unhelpful",
					},
					grade: null,
					intake: {
						createdAt: "2026-03-28T08:11:00.000Z",
						source: "negative_feedback",
						status: "pending_review",
						suggestedEvalFamily: "intent",
					},
					links: {
						issueFingerprint: "feedback-wrong-intent",
						issueLink: null,
						traceLink: "https://sentry.example/traces/trace_feedback_01",
					},
					privacy: {
						providerRawResponseIncluded: false,
						rawAuthMaterialIncluded: false,
						rawTranscriptIncluded: false,
					},
					requestId: "req_feedback_01",
					review: {
						suggestedLabels: ["wrong_intent", "stale_missing_evidence"],
					},
					selectedTarget: "rag-agent",
					summary: "Negative answer feedback for answer: wrong_intent, outdated_or_missing_source.",
					surface: "public_chat_web",
					traceId: "trace_feedback_01",
				},
			],
			page: {
				nextCursor: null,
			},
		});
		expect(JSON.stringify(result)).not.toContain("rawPrompt");
		expect(JSON.stringify(result)).not.toContain("providerResponse");
		expect(JSON.stringify(result)).not.toContain("authMaterialSecret");
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
			selectedTarget: null,
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
				selectedTarget: "navigation-agent",
				status: "open",
				summary: "Intent classifier selected the wrong target",
				surface: "public_chat_web",
				traceId: "trace_intent_01",
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
			selectedTarget: null,
			status: null,
			surface: null,
			window: null,
		});

		expect(result.badcases[0]?.grade).toEqual({
			graderVersion: "intent-grader@2026-04-20",
			result: "fail",
			score: 0.12,
		});
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
				selectedTarget: "rag-agent",
				status: "open",
				summary: "Citation missing",
				surface: "public_chat_web",
				traceId: "trace_shared_01",
			},
			{
				badcaseId: "badcase_intent_01",
				causeClass: "intent_classifier_mismatch",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T09:59:00.000Z"),
				requestId: "req_shared_01",
				selectedTarget: "navigation-agent",
				status: "open",
				summary: "Intent classifier selected the wrong target",
				surface: "public_chat_web",
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
			selectedTarget: null,
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
