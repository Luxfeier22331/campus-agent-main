import { describe, expect, it, vi } from "vitest";

import { protectedPanelDataProvider } from "../src/panel/data-provider";
import { createJsonResponse } from "./data-provider.test-support";

describe("protected panel data provider eval diagnostic badcases", () => {
	it("loads RAGAS diagnostic eval candidates without runtime request links", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				candidates: [
					{
						candidateId:
							"eval_candidate:ragas_diagnostic:student-scholarship-condition:faithfulness",
						causeClass: "evidence_selection_failed",
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
						selectedTarget: null,
						summary: "RAGAS faithfulness=0.31 below 0.80 at evidence_selection.",
						surface: "regulations/student_rules",
						traceId: null,
					},
				],
				page: {
					nextCursor: null,
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.listOperatorQualityEvalCandidates({
				causeClass: "evidence_selection_failed",
				detectedBy: "ragas_diagnostic",
				page: 1,
				perPage: 10,
				selectedTarget: null,
				signal: undefined,
				status: "pending_review",
				surface: "regulations/student_rules",
				window: "30d",
			}),
		).resolves.toMatchObject({
			data: [
				{
					candidateId: "eval_candidate:ragas_diagnostic:student-scholarship-condition:faithfulness",
					diagnostic: {
						caseId: "student-scholarship-condition",
						failureStage: "evidence_selection",
						metricName: "faithfulness",
						score: 0.31,
						threshold: 0.8,
					},
					id: "eval_candidate:ragas_diagnostic:student-scholarship-condition:faithfulness",
					intake: {
						source: "ragas_diagnostic",
					},
					requestId: null,
					traceId: null,
				},
			],
			pageInfo: {
				hasNextPage: false,
				hasPreviousPage: false,
			},
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/quality/eval-candidates?limit=10&window=30d&surface=regulations%2Fstudent_rules&status=pending_review&causeClass=evidence_selection_failed&detectedBy=ragas_diagnostic",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});
});
