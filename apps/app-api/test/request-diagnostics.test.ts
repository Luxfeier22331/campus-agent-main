// @vitest-environment node

import { describe, expect, it } from "vitest";

import { extractRequestDiagnosticsSummary } from "../src/modules/request-diagnostics";

describe("request diagnostics", () => {
  it("extracts semantic outcome fields from rag diagnostics", () => {
    const summary = extractRequestDiagnosticsSummary({
      diagnostics: {
        no_answer_reason: "out_of_scope",
        policy_reason: "product_scope_boundary",
        scope_class: "out_of_scope",
        semantic_outcome: "out_of_scope",
      },
    });

    expect(summary).toEqual({
      clarificationReason: null,
      noAnswerReason: "out_of_scope",
      policyReason: "product_scope_boundary",
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
    });
  });
});
