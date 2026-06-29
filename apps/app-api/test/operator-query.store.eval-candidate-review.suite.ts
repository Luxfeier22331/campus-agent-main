import { beforeEach, expect, it, vi } from "vitest";

import type { OperatorQueryStoreSuiteContext } from "./operator-query.store.suite-context";

export function registerOperatorQueryStoreEvalCandidateReviewSuite(
	ctx: OperatorQueryStoreSuiteContext,
): void {
	const { createPgOperatorQueryStore, createRuntimeDatabase, resetOperatorQueryStoreMocks } = ctx;

	beforeEach(() => {
		resetOperatorQueryStoreMocks();
	});

	it("exports negative feedback as reviewable eval candidates without raw sensitive payload", async () => {
		const observabilityRows = [
			{
				citationExpected: true,
				citationMissing: true,
				conversationId: "conv_feedback_01",
				intentTool: "knowledge_query",
				intentClassifierVersion: "intent-classifier@2026-04-20",
				intentLaunchState: "open",
				intentNextAction: "delegate",
				intentScopeClass: "in_scope",
				intentTaskKind: "knowledge_lookup",
				requestId: "req_feedback_01",
				requestedTool: "knowledge_query",
				selectedTool: "knowledge_query",
				startedAt: new Date("2026-03-28T08:10:00.000Z"),
				status: "completed",
				surface: "campus_web",
				traceId: "trace_feedback_01",
			},
			{
				citationExpected: false,
				citationMissing: false,
				conversationId: "conv_feedback_02",
				intentTool: "transport_schedule_lookup",
				intentClassifierVersion: "intent-classifier@2026-04-20",
				intentLaunchState: "candidate_only",
				intentNextAction: "clarify",
				intentScopeClass: "in_scope",
				intentTaskKind: "campus_services_lookup",
				requestId: "req_feedback_02",
				requestedTool: "transport_schedule_lookup",
				selectedTool: null,
				startedAt: new Date("2026-03-28T08:20:00.000Z"),
				status: "no_answer",
				surface: "campus_web",
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
		const runBacklinkRows = [
			{
				requestId: "req_feedback_01",
				runId: "run_feedback_01",
			},
		];
		const observabilityWhere = vi.fn().mockResolvedValue(observabilityRows);
		const feedbackWhere = vi.fn().mockResolvedValue(feedbackRows);
		const backlinkWhere = vi.fn().mockResolvedValue(backlinkRows);
		const runBacklinkLimit = vi.fn().mockResolvedValue(runBacklinkRows);
		const runBacklinkWhere = vi.fn(() => ({ limit: runBacklinkLimit }));
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
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: runBacklinkWhere,
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
			selectedTool: null,
			status: null,
			surface: "campus_web",
			window: "1h",
		});

		expect(result).toEqual({
			candidates: [
				{
					candidateId: "eval_candidate:negative_feedback:feedback_01",
					causeClass: "wrong_intent",
					diagnosisStage: "routing",
					correlation: {
						answerKind: "answer",
						assistantMessageId: "msg_assistant_01",
						citationPosture: "citation_missing",
						conversationId: "conv_feedback_01",
						intent: {
							tool: "knowledge_query",
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
					runId: "run_feedback_01",
					selectedTool: "knowledge_query",
					summary: "Negative answer feedback for answer: wrong_intent, outdated_or_missing_source.",
					surface: "campus_web",
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
}
