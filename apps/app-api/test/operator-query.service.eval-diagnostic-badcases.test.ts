// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import { buildOperatorQueryService } from "../src/modules/operator-query";

function createOperatorPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: ["ops"],
			principalId: "ops@example.com",
			principalType: "operator",
			roles: ["operator"],
			userId: "ops@example.com",
		},
		permissions: {
			chat: false,
			operator: true,
		},
		principal: {
			displayName: "Ops Team",
			email: "ops@example.com",
			principalId: "ops@example.com",
			type: "operator",
		},
		session: null,
	};
}

describe("operator query service eval diagnostic badcases", () => {
	it("exports RAGAS diagnostic candidates without runtime request identity", async () => {
		const store = {
			getById: vi.fn(),
			getObservabilityById: vi.fn(),
			getOverview: vi.fn(),
			getQualitySummary: vi.fn(),
			getQualityTimeseries: vi.fn(),
			getAuditById: vi.fn(),
			getSafetySummary: vi.fn(),
			getCostSummary: vi.fn(),
			listQualityBadcases: vi.fn(),
			listQualityFeedbackEvalCandidates: vi.fn(),
			listEvalDiagnosticCandidates: vi.fn().mockResolvedValue({
				candidates: [
					{
						candidateId:
							"eval_candidate:ragas_diagnostic:student-scholarship-condition:faithfulness",
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
			listAudit: vi.fn(),
			list: vi.fn(),
		};
		const service = buildOperatorQueryService({
			store: store as never,
		});

		const result = await service.listQualityEvalCandidates({
			filters: {
				causeClass: " evidence_selection_failed ",
				cursor: null,
				detectedBy: " ragas_diagnostic ",
				limit: 10,
				selectedCapability: null,
				status: " pending_review ",
				surface: " regulations/student_rules ",
				window: " 30d ",
			},
			principal: createOperatorPrincipal(),
		});

		expect(store.listQualityBadcases).not.toHaveBeenCalled();
		expect(store.listQualityFeedbackEvalCandidates).not.toHaveBeenCalled();
		expect(store.listEvalDiagnosticCandidates).toHaveBeenCalledWith({
			causeClass: "evidence_selection_failed",
			cursor: null,
			detectedBy: "ragas_diagnostic",
			limit: 10,
			selectedCapability: null,
			status: "pending_review",
			surface: "regulations/student_rules",
			window: "30d",
		});
		expect(result.candidates[0]).toMatchObject({
			intake: {
				source: "ragas_diagnostic",
			},
			requestId: null,
			traceId: null,
		});
	});
});
