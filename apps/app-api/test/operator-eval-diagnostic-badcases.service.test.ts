// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { buildOperatorObservabilityCommandService } from "../src/modules/operator-observability-command";

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
				},
			],
			snapshotId: "eval_diagnostic_badcases:2026-05-21T090000Z",
		});
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
