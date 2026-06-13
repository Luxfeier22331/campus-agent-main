// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
	createOperatorPrincipal,
	createOperatorQueryServiceMock,
	env,
} from "./operator-query.route.test-support";

describe("operator query route eval diagnostic badcases", () => {
	it("returns app-safe RAGAS diagnostic eval candidates without runtime request links", async () => {
		const service = createOperatorQueryServiceMock({
			listQualityEvalCandidates: vi.fn().mockResolvedValue({
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
						selectedCapability: null,
						summary: "RAGAS faithfulness=0.31 below 0.80 at evidence_selection.",
						surface: "regulations/student_rules",
						traceId: null,
					},
				],
				page: {
					nextCursor: null,
				},
			}),
		});
		const principal = createOperatorPrincipal();
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal),
			operatorQueryService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/quality/eval-candidates?window=30d&surface=regulations%2Fstudent_rules&status=pending_review&causeClass=evidence_selection_failed&detectedBy=ragas_diagnostic",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			candidates: [
				{
					candidateId: "eval_candidate:ragas_diagnostic:student-scholarship-condition:faithfulness",
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
		expect(service.listQualityEvalCandidates).toHaveBeenCalledWith({
			filters: {
				causeClass: "evidence_selection_failed",
				cursor: null,
				detectedBy: "ragas_diagnostic",
				limit: null,
				selectedCapability: null,
				status: "pending_review",
				surface: "regulations/student_rules",
				window: "30d",
			},
			principal,
		});
	});
});
