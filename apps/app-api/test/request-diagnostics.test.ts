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
      scopeClass: "out_of_scope",
      semanticOutcome: "out_of_scope",
      sessionProgram: null,
      sessionProgramFamily: null,
      sessionSemester: null,
      unsupportedFields: ["offering_unit_claims", "audience_claims"],
    });
  });
});
