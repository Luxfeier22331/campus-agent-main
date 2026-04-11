// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { SupervisorExecutionResponse } from "../src/modules/integration";
import { buildFinalizedRequestObservabilityFact } from "../src/modules/request-observability";

function createPrincipal(): ResolvedAppPrincipal {
  return {
    actor: {
      departments: [],
      principalId: "principal_01HQ",
      principalType: "student",
      roles: [],
      userId: "user_01HQ",
    },
    authorization: {
      approvalState: "not_required",
      applicabilityScope: "undergraduate",
      entitlementGroups: ["students"],
      entitlementSnapshotId: "entitlements-2026-03-29",
      ownershipScopes: [],
      principalId: "principal_01HQ",
      projectionSource: "campus_identity",
      retrievalFilter: {
        entitlementGroups: ["students"],
        policyProjectionVersion: "phase1-authorization-projection-v1",
        visibilityLevel: "public",
        visibilityScope: "main",
      },
      visibilityScope: "main",
    },
    permissions: {
      chat: true,
      operator: false,
    },
    principal: {
      displayName: "Jane Doe",
      email: "jane@example.edu.cn",
      principalId: "principal_01HQ",
      type: "student",
    },
    session: null,
  };
}

function createResponse(
  overrides: Partial<SupervisorExecutionResponse> = {},
): SupervisorExecutionResponse {
  return {
    answerText: "当前没有足够依据回答这个问题。",
    error: null,
    followUpQuestion: "",
    observability: null,
    result: null,
    selectedTarget: "rag-specialist",
    status: "no_answer",
    traceId: "trace_01HQ",
    ...overrides,
  };
}

describe("request observability", () => {
  it("derives semantic outcome fields for in-scope no-answer responses", () => {
    const fact = buildFinalizedRequestObservabilityFact({
      completedAt: "2026-04-05T08:00:01.000Z",
      conversationId: "conv_01HQ",
      diagnostics: {
        clarificationReason: null,
        freshnessFailClosed: null,
        groundingDowngraded: null,
        groundingVerdict: null,
        noAnswerReason: "resolved_policy_clause_not_found",
        policyReason: null,
        resolvedEntityType: null,
        resolvedPolicyDocumentId: "handbook:scholarship",
        resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
        resolvedProgramFamilyTitle: null,
        retrievedTitleSummary: ["中央民族大学本科学生国家奖学金评审办法"],
        rewrittenQuery: "中央民族大学本科学生国家奖学金评审办法 国奖看第一作者单位吗？",
        scopeClass: null,
        semanticOutcome: null,
        sessionProgram: null,
        sessionProgramFamily: null,
        sessionSemester: null,
      },
      durationMs: 1200,
      errorCode: null,
      principal: createPrincipal(),
      requestId: "req_01HQ",
      requestedCapability: "knowledge",
      requestedScope: {
        collection: "student_handbook",
        corpus: "regulations",
      },
      resolvedScope: {
        collection: "student_handbook",
        corpus: "regulations",
      },
      response: createResponse(),
      sourceDocIds: [],
      startedAt: "2026-04-05T08:00:00.000Z",
      status: "no_answer",
      surface: "public_chat_web",
      traceId: "trace_01HQ",
    });

    expect(fact).toMatchObject({
      policyReason: null,
      refusalClass: "no_answer",
      scopeClass: "in_scope",
      semanticOutcome: "unsupported_by_evidence",
    });
  });

  it("prefers explicit supervisor observability semantics when provided", () => {
    const fact = buildFinalizedRequestObservabilityFact({
      completedAt: "2026-04-05T08:00:01.000Z",
      conversationId: "conv_01HQ",
      diagnostics: null,
      durationMs: 800,
      errorCode: null,
      principal: createPrincipal(),
      requestId: "req_01HQ",
      requestedCapability: "knowledge",
      requestedScope: null,
      resolvedScope: null,
      response: createResponse({
        observability: {
          aclAnomalyCode: null,
          aclDecision: "allowed",
          cachedInputTokens: null,
          candidateCount: 0,
          citationCount: 0,
          citationExpected: false,
          citationMissing: false,
          estimatedCostMicrousd: null,
          failClosed: true,
          inputTokens: null,
          modelName: null,
          modelProvider: null,
          outputTokens: null,
          policyReason: "product_scope_boundary",
          refusalClass: "no_answer",
          retrievedSourceCount: 0,
          retrievalAttempted: false,
          scopeClass: "out_of_scope",
          semanticOutcome: "out_of_scope",
        },
      }),
      sourceDocIds: [],
      startedAt: "2026-04-05T08:00:00.000Z",
      status: "no_answer",
      surface: "public_chat_web",
      traceId: "trace_01HQ",
    });

    expect(fact).toMatchObject({
      policyReason: "product_scope_boundary",
      scopeClass: "out_of_scope",
      semanticOutcome: "out_of_scope",
    });
  });

  it("derives out-of-scope supervisor stop semantics from diagnostics when observability is absent", () => {
    const fact = buildFinalizedRequestObservabilityFact({
      completedAt: "2026-04-11T09:00:01.000Z",
      conversationId: "conv_01HQ",
      diagnostics: {
        clarificationReason: null,
        freshnessFailClosed: null,
        groundingDowngraded: null,
        groundingVerdict: null,
        noAnswerReason: "out_of_scope",
        policyReason: "product_scope_boundary",
        resolvedEntityType: null,
        resolvedPolicyDocumentId: null,
        resolvedPolicyTitle: null,
        resolvedProgramFamilyTitle: null,
        retrievedTitleSummary: [],
        rewrittenQuery: null,
        scopeClass: "out_of_scope",
        semanticOutcome: null,
        sessionProgram: null,
        sessionProgramFamily: null,
        sessionSemester: null,
      },
      durationMs: 200,
      errorCode: null,
      principal: createPrincipal(),
      requestId: "req_01HQ",
      requestedCapability: "knowledge",
      requestedScope: null,
      resolvedScope: null,
      response: createResponse({
        selectedTarget: null,
      }),
      sourceDocIds: [],
      startedAt: "2026-04-11T09:00:00.000Z",
      status: "no_answer",
      surface: "public_chat_web",
      traceId: "trace_01HQ",
    });

    expect(fact).toMatchObject({
      failClosed: true,
      policyReason: "product_scope_boundary",
      refusalClass: "out_of_scope",
      scopeClass: "out_of_scope",
      semanticOutcome: "out_of_scope",
      selectedTarget: null,
    });
  });

  it("derives specialist grounding downgrade semantics from diagnostics when observability is absent", () => {
    const fact = buildFinalizedRequestObservabilityFact({
      completedAt: "2026-04-11T09:00:01.000Z",
      conversationId: "conv_01HQ",
      diagnostics: {
        clarificationReason: null,
        freshnessFailClosed: null,
        groundingDowngraded: true,
        groundingVerdict: "unsupported",
        noAnswerReason: null,
        policyReason: null,
        resolvedEntityType: null,
        resolvedPolicyDocumentId: null,
        resolvedPolicyTitle: null,
        resolvedProgramFamilyTitle: null,
        retrievedTitleSummary: ["习近平新时代中国特色社会主义思想概论"],
        rewrittenQuery: null,
        scopeClass: "in_scope",
        semanticOutcome: null,
        sessionProgram: null,
        sessionProgramFamily: null,
        sessionSemester: null,
      },
      durationMs: 300,
      errorCode: null,
      principal: createPrincipal(),
      requestId: "req_01HQ",
      requestedCapability: "knowledge",
      requestedScope: {
        collection: "curriculum_plan",
        corpus: "curriculum",
      },
      resolvedScope: {
        collection: "curriculum_plan",
        corpus: "curriculum",
      },
      response: createResponse(),
      sourceDocIds: [],
      startedAt: "2026-04-11T09:00:00.000Z",
      status: "no_answer",
      surface: "public_chat_web",
      traceId: "trace_01HQ",
    });

    expect(fact).toMatchObject({
      failClosed: true,
      refusalClass: "no_answer",
      scopeClass: "in_scope",
      semanticOutcome: "unsupported_by_evidence",
      selectedTarget: "rag-specialist",
    });
  });
});
