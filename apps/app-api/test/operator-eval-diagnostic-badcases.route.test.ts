// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { env } from "./operator-query.route.test-support";

const internalEnv = {
	...env,
	APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
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
			trajectoryAttribution: {
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
			},
		},
	],
};

describe("operator eval diagnostic badcase routes", () => {
	it("accepts RAGAS diagnostic badcases through the internal publish seam", async () => {
		const commandService = {
			ingestEvalDiagnosticBadcases: vi.fn().mockResolvedValue({
				accepted: 1,
				snapshotId: diagnosticPayload.snapshotId,
			}),
		};
		const app = createApp(internalEnv as never, {
			operatorObservabilityCommandService: commandService as never,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/operator/evals/diagnostic-badcases", {
				body: JSON.stringify(diagnosticPayload),
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth": "trusted-secret",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			accepted: 1,
			snapshotId: diagnosticPayload.snapshotId,
		});
		expect(commandService.ingestEvalDiagnosticBadcases).toHaveBeenCalledWith({
			payload: diagnosticPayload,
		});
	});

	it("fails closed when diagnostic badcase publish lacks the internal credential", async () => {
		const commandService = {
			ingestEvalDiagnosticBadcases: vi.fn(),
		};
		const app = createApp(internalEnv as never, {
			operatorObservabilityCommandService: commandService as never,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/operator/evals/diagnostic-badcases", {
				body: JSON.stringify(diagnosticPayload),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "service_credential_required",
			},
		});
		expect(commandService.ingestEvalDiagnosticBadcases).not.toHaveBeenCalled();
	});
});
