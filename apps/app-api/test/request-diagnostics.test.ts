// @vitest-environment node

import { describe, expect, it } from "vitest";

import { extractRequestDiagnosticsSummary } from "../src/modules/request-diagnostics";

describe("request diagnostics", () => {
	it("extracts semantic outcome fields from rag diagnostics", () => {
		const summary = extractRequestDiagnosticsSummary({
			diagnostics: {
				claim_supports: [
					{
						claim_type: "offering_unit_or_owning_school",
						claim_text: "马克思主义学院",
						supported: false,
						support_source_doc_id: "",
						support_snippet: "",
					},
					{
						claim_type: "audience_or_major_or_program_or_class_family",
						claim_text: "法学专业",
						supported: false,
						support_source_doc_id: "",
						support_snippet: "",
					},
					{
						claim_type: "semester_or_grade_or_term_placement",
						claim_text: "第四学期",
						supported: true,
						support_source_doc_id: "curriculum:law-ethnic-experimental",
						support_snippet: "第四学期开设习近平新时代中国特色社会主义思想概论。",
					},
				],
				freshness_fail_closed: true,
				grounding_downgraded: true,
				grounding_verdict: "unsupported",
				no_answer_reason: "out_of_scope",
				policy_reason: "product_scope_boundary",
				retrieval_adequacy_reason: "policy_object_missing",
				retrieval_adequacy_verdict: "ambiguous",
				scope_class: "out_of_scope",
				semantic_outcome: "out_of_scope",
				unsupported_fields: ["offering_unit_claims", "audience_claims"],
			},
		});

		expect(summary).toEqual({
			claimSupportSummary: {
				supportedClaims: 1,
				totalClaims: 3,
				unsupportedClaimTypes: [
					"audience_or_major_or_program_or_class_family",
					"offering_unit_or_owning_school",
				],
				unsupportedClaims: 2,
				unsupportedFields: ["offering_unit_claims", "audience_claims"],
			},
			clarificationReason: null,
			freshnessFailClosed: true,
			groundingDowngraded: true,
			groundingVerdict: "unsupported",
			noAnswerReason: "out_of_scope",
			policyReason: "product_scope_boundary",
			retrievalAdequacyReason: "policy_object_missing",
			retrievalAdequacyVerdict: "ambiguous",
			resolvedEntityType: null,
			resolvedPolicyDocumentId: null,
			resolvedPolicyTitle: null,
			resolvedProgramFamilyTitle: null,
			retrievedTitleSummary: [],
			rewrittenQuery: null,
			retrievalPlanSummary: null,
			scopeClass: "out_of_scope",
			semanticOutcome: "out_of_scope",
			sessionProgram: null,
			sessionProgramFamily: null,
			sessionSemester: null,
			remoteContentSuspicionSummary: null,
			sourceTrustSummary: null,
			unsupportedFields: ["offering_unit_claims", "audience_claims"],
		});
	});

	it("extracts source trust summary from rag diagnostics", () => {
		const summary = extractRequestDiagnosticsSummary({
			diagnostics: {
				source_trust_summary: {
					answer_bearing_tiers: ["T0"],
					authorization_claim_blocked: false,
					blocked_claim_types: ["freshness_sensitive_status"],
					freshness_claim_blocked: true,
					observed_tiers: ["T0", "T1"],
				},
			},
		});

		expect(summary).toEqual({
			claimSupportSummary: null,
			clarificationReason: null,
			freshnessFailClosed: null,
			groundingDowngraded: null,
			groundingVerdict: null,
			noAnswerReason: null,
			policyReason: null,
			retrievalAdequacyReason: null,
			retrievalAdequacyVerdict: null,
			resolvedEntityType: null,
			resolvedPolicyDocumentId: null,
			resolvedPolicyTitle: null,
			resolvedProgramFamilyTitle: null,
			retrievedTitleSummary: [],
			rewrittenQuery: null,
			retrievalPlanSummary: null,
			scopeClass: null,
			semanticOutcome: null,
			sessionProgram: null,
			sessionProgramFamily: null,
			sessionSemester: null,
			sourceTrustSummary: {
				answerBearingTiers: ["T0"],
				authorizationClaimBlocked: false,
				blockedClaimTypes: ["freshness_sensitive_status"],
				freshnessClaimBlocked: true,
				observedTiers: ["T0", "T1"],
			},
			remoteContentSuspicionSummary: null,
			unsupportedFields: [],
		});
	});

	it("extracts remote content suspicion summary from rag diagnostics", () => {
		const summary = extractRequestDiagnosticsSummary({
			diagnostics: {
				remote_content_suspicion_summary: {
					flag_labels: ["prompt_override_signal", "tool_or_browser_action_request"],
					flagged_source_count: 1,
					generation_blocked: true,
				},
			},
		});

		expect(summary).toEqual({
			claimSupportSummary: null,
			clarificationReason: null,
			freshnessFailClosed: null,
			groundingDowngraded: null,
			groundingVerdict: null,
			noAnswerReason: null,
			policyReason: null,
			remoteContentSuspicionSummary: {
				flagLabels: ["prompt_override_signal", "tool_or_browser_action_request"],
				flaggedSourceCount: 1,
				generationBlocked: true,
			},
			retrievalAdequacyReason: null,
			retrievalAdequacyVerdict: null,
			resolvedEntityType: null,
			resolvedPolicyDocumentId: null,
			resolvedPolicyTitle: null,
			resolvedProgramFamilyTitle: null,
			retrievedTitleSummary: [],
			rewrittenQuery: null,
			retrievalPlanSummary: null,
			scopeClass: null,
			semanticOutcome: null,
			sessionProgram: null,
			sessionProgramFamily: null,
			sessionSemester: null,
			sourceTrustSummary: null,
			unsupportedFields: [],
		});
	});

	it("extracts retrieval plan summary from rag diagnostics", () => {
		const summary = extractRequestDiagnosticsSummary({
			diagnostics: {
				retrieval_plan_summary: {
					plan_id: "regulations:student_rules:current",
					query_mode: "current",
					replan_count: 0,
					terminal_state: "completed",
					step_activities: [
						{
							step_id: "indexed-lookup",
							step_type: "indexed_lookup",
							corpus: "regulations",
							collection: "student_rules",
							status: "succeeded",
							top_k: 3,
							latency_ms: 11,
							candidate_count: 2,
							reference_count: 2,
							failure_kind: "",
						},
					],
				},
			},
		});

		expect(summary).toEqual({
			claimSupportSummary: null,
			clarificationReason: null,
			freshnessFailClosed: null,
			groundingDowngraded: null,
			groundingVerdict: null,
			noAnswerReason: null,
			policyReason: null,
			remoteContentSuspicionSummary: null,
			resolvedEntityType: null,
			resolvedPolicyDocumentId: null,
			resolvedPolicyTitle: null,
			resolvedProgramFamilyTitle: null,
			retrievedTitleSummary: [],
			retrievalAdequacyReason: null,
			retrievalAdequacyVerdict: null,
			retrievalPlanSummary: {
				planId: "regulations:student_rules:current",
				queryMode: "current",
				replanCount: 0,
				terminalState: "completed",
				stepActivities: [
					{
						candidateCount: 2,
						collection: "student_rules",
						corpus: "regulations",
						failureKind: null,
						latencyMs: 11,
						referenceCount: 2,
						status: "succeeded",
						stepId: "indexed-lookup",
						stepType: "indexed_lookup",
						topK: 3,
					},
				],
			},
			rewrittenQuery: null,
			scopeClass: null,
			semanticOutcome: null,
			sessionProgram: null,
			sessionProgramFamily: null,
			sessionSemester: null,
			sourceTrustSummary: null,
			unsupportedFields: [],
		});
	});
});
