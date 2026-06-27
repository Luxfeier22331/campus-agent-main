// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { buildOperatorObservabilityCommandService } from "../src/modules/operator-observability-command";

const trajectoryAttribution = {
	status: "attributed",
	stepId: "evidence.selection",
	stepKind: "selection",
	tool: "knowledge_query",
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
};

const diagnosticPayload = {
	schemaVersion: "eval_diagnostic_badcases.v1",
	evalRunId: "ragas_diagnostic_combined",
	snapshotId: "eval_diagnostic_badcases:2026-05-21T090000Z",
	generatedAt: "2026-05-21T09:00:00.000Z",
	sourceGitHead: "git-main",
	sourceReportSchema: "ragas-diagnostic-combined-report.v1",
	badcases: [
		{
			badcaseId: "ragas_diagnostic:student-scholarship-condition:faithfulness",
			caseId: "student-scholarship-condition",
			surfaceKey: "regulations/student_rules",
			metricName: "faithfulness",
			score: 0.31,
			threshold: 0.8,
			failureStage: "evidence_selection",
			causeClass: "evidence_selection_failed",
			metricFailureReason: "evidence_selection",
			queryPreview: "奖学金要满足什么条件",
			expectedDocIds: ["doc:scholarship"],
			retrievedContextIds: ["chunk:wrong", "chunk:scholarship"],
			retrievedDocIds: ["doc:wrong", "doc:scholarship"],
			supportingDocIds: ["doc:wrong"],
			supportingChunkIds: ["chunk:wrong"],
			answerShape: "eligibility_judgment",
			presentationKind: "condition_table",
			trajectoryAttribution,
		},
	],
};

function createCommandStore() {
	return {
		enqueueExecutionAuditEvents: vi.fn(),
		getRequestObservabilitySeed: vi.fn(),
		upsertEvalCoverageSnapshot: vi.fn(),
		upsertEvalDiagnosticBadcases: vi.fn().mockResolvedValue(undefined),
		upsertQualityGrades: vi.fn(),
		upsertTemporalTaskQueueRuntime: vi.fn(),
		upsertTraceBacklinks: vi.fn(),
	};
}

describe("operator eval diagnostic badcases command service", () => {
	it("normalizes and persists RAGAS diagnostic badcases as operator-safe projection data", async () => {
		const store = createCommandStore();
		const service = buildOperatorObservabilityCommandService({
			now: () => new Date("2026-05-21T10:00:00.000Z"),
			store,
		});

		await expect(
			service.ingestEvalDiagnosticBadcases({ payload: diagnosticPayload }),
		).resolves.toEqual({
			accepted: 1,
			snapshotId: "eval_diagnostic_badcases:2026-05-21T090000Z",
		});

		expect(store.upsertEvalDiagnosticBadcases).toHaveBeenCalledWith({
			badcases: [
				{
					answerShape: "eligibility_judgment",
					badcaseId: "ragas_diagnostic:student-scholarship-condition:faithfulness",
					caseId: "student-scholarship-condition",
					causeClass: "evidence_selection_failed",
					evalRunId: "ragas_diagnostic_combined",
					expectedDocIds: ["doc:scholarship"],
					failureStage: "evidence_selection",
					generatedAt: "2026-05-21T09:00:00.000Z",
					metricFailureReason: "evidence_selection",
					metricName: "faithfulness",
					presentationKind: "condition_table",
					projectedAt: "2026-05-21T10:00:00.000Z",
					queryPreview: "奖学金要满足什么条件",
					retrievedContextIds: ["chunk:wrong", "chunk:scholarship"],
					retrievedDocIds: ["doc:wrong", "doc:scholarship"],
					scoreMilli: 310,
					snapshotId: "eval_diagnostic_badcases:2026-05-21T090000Z",
					sourceGitHead: "git-main",
					sourceReportSchema: "ragas-diagnostic-combined-report.v1",
					supportingChunkIds: ["chunk:wrong"],
					supportingDocIds: ["doc:wrong"],
					surfaceKey: "regulations/student_rules",
					thresholdMilli: 800,
					trajectoryAttribution,
				},
			],
			snapshotId: "eval_diagnostic_badcases:2026-05-21T090000Z",
		});
	});

	it("accepts replan trajectory attribution as an operator-safe diagnostic stage", async () => {
		const store = createCommandStore();
		const service = buildOperatorObservabilityCommandService({
			now: () => new Date("2026-05-21T10:00:00.000Z"),
			store,
		});
		const replanAttribution = {
			status: "attributed",
			stepId: "plan.replan.1",
			stepKind: "replan",
			tool: "transport_schedule_lookup",
			toolName: "transport_schedule_lookup",
			stepStatus: "completed",
			outcome: {
				failCloseReason: null,
				terminalReason: null,
				replanReason: "bounded_replan_after_provider_timeout",
				cancelOutcome: "not_requested",
				timeoutOutcome: "provider_timeout",
				lateCompletionOutcome: "ignored_after_timeout",
			},
			projectionRefs: ["projection://runs/run_01HQ/plan-replan-1"],
		};

		await expect(
			service.ingestEvalDiagnosticBadcases({
				payload: {
					...diagnosticPayload,
					badcases: [
						{
							...diagnosticPayload.badcases[0],
							badcaseId: "ragas_diagnostic:transport-replan:faithfulness",
							caseId: "transport-replan",
							causeClass: "replan_failed",
							failureStage: "replan",
							metricFailureReason: "replan",
							trajectoryAttribution: replanAttribution,
						},
					],
				},
			}),
		).resolves.toEqual({
			accepted: 1,
			snapshotId: "eval_diagnostic_badcases:2026-05-21T090000Z",
		});

		expect(store.upsertEvalDiagnosticBadcases).toHaveBeenCalledWith({
			badcases: [
				expect.objectContaining({
					badcaseId: "ragas_diagnostic:transport-replan:faithfulness",
					causeClass: "replan_failed",
					failureStage: "replan",
					metricFailureReason: "replan",
					trajectoryAttribution: replanAttribution,
				}),
			],
			snapshotId: "eval_diagnostic_badcases:2026-05-21T090000Z",
		});
	});

	it("accepts terminal outcome diagnostic stages attributed to finalization", async () => {
		const store = createCommandStore();
		const service = buildOperatorObservabilityCommandService({
			now: () => new Date("2026-05-21T10:00:00.000Z"),
			store,
		});
		const terminalAttribution = {
			status: "attributed",
			stepId: "finalization.write",
			stepKind: "finalization",
			tool: null,
			toolName: null,
			stepStatus: "completed",
			outcome: {
				failCloseReason: null,
				terminalReason: "clarification_required",
				replanReason: null,
				cancelOutcome: "not_requested",
				timeoutOutcome: "not_timed_out",
				lateCompletionOutcome: "not_late",
			},
			projectionRefs: ["projection://runs/run_01HQ/finalization/write"],
		};

		await expect(
			service.ingestEvalDiagnosticBadcases({
				payload: {
					...diagnosticPayload,
					badcases: [
						{
							...diagnosticPayload.badcases[0],
							badcaseId: "ragas_diagnostic:terminal-clarification:answer_relevancy",
							caseId: "terminal-clarification",
							causeClass: "clarification_required",
							failureStage: "clarification",
							metricFailureReason: "clarification",
							trajectoryAttribution: terminalAttribution,
						},
						{
							...diagnosticPayload.badcases[0],
							badcaseId: "ragas_diagnostic:terminal-rejected:answer_relevancy",
							caseId: "terminal-rejected",
							causeClass: "request_rejected",
							failureStage: "rejected",
							metricFailureReason: "rejected",
							trajectoryAttribution: terminalAttribution,
						},
						{
							...diagnosticPayload.badcases[0],
							badcaseId: "ragas_diagnostic:terminal-no-answer:answer_relevancy",
							caseId: "terminal-no-answer",
							causeClass: "no_answer",
							failureStage: "no_answer",
							metricFailureReason: "no_answer",
							trajectoryAttribution: terminalAttribution,
						},
					],
				},
			}),
		).resolves.toEqual({
			accepted: 3,
			snapshotId: "eval_diagnostic_badcases:2026-05-21T090000Z",
		});

		expect(store.upsertEvalDiagnosticBadcases).toHaveBeenCalledWith({
			badcases: [
				expect.objectContaining({
					failureStage: "clarification",
					trajectoryAttribution: terminalAttribution,
				}),
				expect.objectContaining({
					failureStage: "rejected",
					trajectoryAttribution: terminalAttribution,
				}),
				expect.objectContaining({
					failureStage: "no_answer",
					trajectoryAttribution: terminalAttribution,
				}),
			],
			snapshotId: "eval_diagnostic_badcases:2026-05-21T090000Z",
		});
	});

	it("rejects diagnostic trajectory attribution that includes raw or local artifact fields", async () => {
		const store = createCommandStore();
		const service = buildOperatorObservabilityCommandService({ store });

		await expect(
			service.ingestEvalDiagnosticBadcases({
				payload: {
					...diagnosticPayload,
					badcases: [
						{
							...diagnosticPayload.badcases[0],
							trajectoryAttribution: {
								...trajectoryAttribution,
								outcome: {
									...trajectoryAttribution.outcome,
									artifactPath: "/tmp/raw-result.json",
								},
							},
						},
					],
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
		expect(store.upsertEvalDiagnosticBadcases).not.toHaveBeenCalled();
	});

	it("rejects diagnostic badcases that include raw answer or local artifact fields", async () => {
		const store = createCommandStore();
		const service = buildOperatorObservabilityCommandService({ store });

		await expect(
			service.ingestEvalDiagnosticBadcases({
				payload: {
					...diagnosticPayload,
					badcases: [
						{
							...diagnosticPayload.badcases[0],
							rawAnswer: "full answer text",
						},
					],
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
		expect(store.upsertEvalDiagnosticBadcases).not.toHaveBeenCalled();
	});
});
