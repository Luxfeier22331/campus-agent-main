import { beforeEach, expect, it, vi } from "vitest";

import type { OperatorQueryStoreSuiteContext } from "./operator-query.store.suite-context";

export function registerOperatorQueryStoreEvalCandidateReviewSuite(
	ctx: OperatorQueryStoreSuiteContext,
): void {
	const { createPgOperatorQueryStore, createRuntimeDatabase, resetOperatorQueryStoreMocks } = ctx;

	beforeEach(() => {
		resetOperatorQueryStoreMocks();
	});

	it("lists RAGAS diagnostic eval candidates without joining runtime request projections", async () => {
		const diagnosticRows = [
			{
				answerShape: "eligibility_judgment",
				badcaseId: "ragas_diagnostic:student-scholarship-condition:faithfulness",
				caseId: "student-scholarship-condition",
				causeClass: "evidence_selection_failed",
				evalRunId: "ragas_diagnostic_combined",
				expectedDocIdsJson: ["doc:scholarship"],
				failureStage: "evidence_selection",
				generatedAt: new Date("2026-05-21T09:00:00.000Z"),
				metricFailureReason: "evidence_selection",
				metricName: "faithfulness",
				presentationKind: "condition_table",
				queryPreview: "奖学金要满足什么条件",
				retrievedContextIdsJson: ["chunk:wrong", "chunk:scholarship"],
				retrievedDocIdsJson: ["doc:wrong", "doc:scholarship"],
				scoreMilli: 310,
				snapshotId: "eval_diagnostic_badcases:2026-05-21T090000Z",
				sourceGitHead: "git-main",
				sourceReportSchema: "ragas-diagnostic-combined-report.v1",
				supportingChunkIdsJson: ["chunk:wrong"],
				supportingDocIdsJson: ["doc:wrong"],
				surfaceKey: "regulations/student_rules",
				thresholdMilli: 800,
				trajectoryAttributionJson: {
					status: "attributed",
					stepId: "evidence.selection",
					stepKind: "selection",
					capability: "knowledge",
					toolName: null,
					stepStatus: "completed",
					outcome: {
						failCloseReason: null,
						terminalReason: null,
						replanReason: null,
						cancelOutcome: "not_requested",
						timeoutOutcome: "not_timed_out",
						lateCompletionOutcome: "not_late",
					},
					projectionRefs: ["projection://runs/run_01HQ/evidence-selection"],
				},
			},
		];
		const limit = vi.fn().mockResolvedValue(diagnosticRows);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const select = vi.fn(() => ({
			from: vi.fn(() => ({
				orderBy,
				where,
			})),
		}));

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never, {
			now: () => new Date("2026-05-21T10:00:00.000Z"),
		});

		const result = await store.listEvalDiagnosticCandidates({
			causeClass: "evidence_selection_failed",
			cursor: null,
			detectedBy: "ragas_diagnostic",
			limit: 10,
			selectedCapability: null,
			status: "pending_review",
			surface: "regulations/student_rules",
			window: "30d",
		});

		expect(result).toEqual({
			candidates: [
				{
					candidateId: "eval_candidate:ragas_diagnostic:student-scholarship-condition:faithfulness",
					causeClass: "evidence_selection_failed",
					diagnosisStage: "selection",
					diagnostic: {
						answerShape: "eligibility_judgment",
						caseId: "student-scholarship-condition",
						expectedDocIds: ["doc:scholarship"],
						failureStage: "evidence_selection",
						metricFailureReason: "evidence_selection",
						metricName: "faithfulness",
						presentationKind: "condition_table",
						retrievedContextIds: ["chunk:wrong", "chunk:scholarship"],
						retrievedDocIds: ["doc:wrong", "doc:scholarship"],
						score: 0.31,
						supportingDocIds: ["doc:wrong"],
						threshold: 0.8,
						trajectoryAttribution: {
							status: "attributed",
							stepId: "evidence.selection",
							stepKind: "selection",
							capability: "knowledge",
							toolName: null,
							stepStatus: "completed",
							outcome: {
								failCloseReason: null,
								terminalReason: null,
								replanReason: null,
								cancelOutcome: "not_requested",
								timeoutOutcome: "not_timed_out",
								lateCompletionOutcome: "not_late",
							},
							projectionRefs: ["projection://runs/run_01HQ/evidence-selection"],
						},
					},
					grade: {
						graderVersion: "ragas-diagnostic-combined-report.v1",
						result: "fail",
						score: 0.31,
					},
					intake: {
						createdAt: "2026-05-21T09:00:00.000Z",
						source: "ragas_diagnostic",
						status: "pending_review",
						suggestedEvalFamily: "grounding",
					},
					links: {
						issueFingerprint: null,
						issueLink: null,
						traceLink: null,
					},
					requestId: null,
					runId: null,
					selectedCapability: null,
					summary: "RAGAS faithfulness=0.31 below 0.80 at evidence_selection.",
					surface: "regulations/student_rules",
					traceId: null,
				},
			],
			page: {
				nextCursor: null,
			},
		});
		expect(limit).toHaveBeenCalledWith(11);
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
				selectedCapability: "knowledge",
				startedAt: new Date("2026-03-28T08:10:00.000Z"),
				status: "completed",
				surface: "campus_web",
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
				selectedCapability: null,
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
			selectedCapability: null,
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
					runId: "run_feedback_01",
					selectedCapability: "knowledge",
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
