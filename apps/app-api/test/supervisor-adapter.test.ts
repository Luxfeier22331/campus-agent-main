// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SupervisorTransportError,
  createSupervisorExecutionClient,
} from "../src/modules/integration/supervisor";

function createActor() {
  return {
    campusScope: "main",
    departments: [],
    groups: ["students"],
    principalId: "principal_01HQ",
    principalType: "student" as const,
    roles: ["student"],
    userId: "user_01HQ",
  };
}

function createAuthorization() {
  return {
    applicabilityScope: "undergraduate",
    approvalState: "not_required",
    entitlementGroups: ["students"],
    entitlementSnapshotId: "entitlements-2026-03-29",
    ownershipScopes: ["conversation:user_01HQ"],
    principalId: "principal_01HQ",
    projectionSource: "campus_identity" as const,
    retrievalFilter: {
      aclGroups: ["students"],
      campusScope: "main",
      entitlementGroups: ["students"],
      policyProjectionVersion: "phase1-authorization-projection-v1",
      visibilityLevel: "public",
      visibilityScope: "main",
    },
    visibilityScope: "main",
  };
}

function createContext(turnCount = 0) {
  return {
    actor: createActor(),
    authorization: createAuthorization(),
    profileMemory: {
      items: [],
    },
    session: {
      confirmedSlots: [],
      turnCount,
    },
  };
}

describe("supervisor execution adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends canonical snake_case execution payload without legacy retrieval carrier fields", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          answer_text: "图书馆开放到 22:00。",
          error: null,
          follow_up_question: "",
          result: {
            evidence: {
              sources: [{ doc_id: "handbook:library-hours" }],
            },
          },
          selected_target: "rag-specialist",
          status: "completed",
          trace_id: "trace_01HQ",
        }),
        { status: 200 },
      ),
    );
    const client = createSupervisorExecutionClient(
      {
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      },
      { fetchImplementation },
    );

    const result = await client.execute({
      actor: createActor(),
      context: createContext(),
      conversationId: "conv_01HQ",
      requestId: "req_01HQ",
      requestedCapability: "knowledge",
      requestedScope: {
        collection: "student_handbook",
        corpus: "regulations",
      },
      traceHeaders: {
        baggage: "sentry-environment=test",
        sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
      },
      traceId: "trace_01HQ",
      userGoal: "图书馆开放到几点？",
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://supervisor.internal/api/v1/answer",
      expect.objectContaining({
        headers: {
          baggage: "sentry-environment=test",
          "content-type": "application/json",
          "sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
          "x-trace-id": "trace_01HQ",
          "x-worker-origin-auth": "shared-secret",
        },
        method: "POST",
      }),
    );
    expect(JSON.parse(fetchImplementation.mock.calls[0]![1]!.body as string)).toEqual({
      context: {
        actor: {
          departments: [],
          principal_id: "principal_01HQ",
          principal_type: "student",
          roles: ["student"],
          user_id: "user_01HQ",
        },
        authorization: {
          applicability_scope: "undergraduate",
          approval_state: "not_required",
          entitlement_groups: ["students"],
          entitlement_snapshot_id: "entitlements-2026-03-29",
          ownership_scopes: ["conversation:user_01HQ"],
          principal_id: "principal_01HQ",
          projection_source: "campus_identity",
          retrieval_filter: {
            entitlement_groups: ["students"],
            policy_projection_version: "phase1-authorization-projection-v1",
            visibility_level: "public",
            visibility_scope: "main",
          },
          visibility_scope: "main",
        },
        profile_memory: {
          items: [],
        },
        session: {
          confirmed_slots: [],
          turn_count: 0,
        },
      },
      conversation_id: "conv_01HQ",
      request_id: "req_01HQ",
      requested_capability: "knowledge",
      requested_scope: {
        collection: "student_handbook",
        corpus: "regulations",
      },
      user_goal: "图书馆开放到几点？",
    });
    expect(result).toEqual({
      answerText: "图书馆开放到 22:00。",
      error: null,
      followUpQuestion: "",
      observability: null,
      result: {
        evidence: {
          sources: [{ doc_id: "handbook:library-hours" }],
        },
      },
      selectedTarget: "rag-specialist",
      status: "completed",
      traceId: "trace_01HQ",
    });
  });

  it("ignores legacy target fallback and only trusts selected_target", async () => {
    const client = createSupervisorExecutionClient(
      {
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      },
      {
        fetchImplementation: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              answer_text: "图书馆开放到 22:00。",
              error: null,
              follow_up_question: "",
              result: null,
              status: "completed",
              target: "rag-specialist",
              trace_id: "trace_01HQ",
            }),
            { status: 200 },
          ),
        ),
      },
    );

    await expect(
      client.execute({
        actor: createActor(),
        context: createContext(),
        conversationId: "conv_01HQ",
        requestId: "req_01HQ",
        traceId: "trace_01HQ",
        userGoal: "图书馆开放到几点？",
      }),
    ).resolves.toEqual({
      answerText: "图书馆开放到 22:00。",
      error: null,
      followUpQuestion: "",
      observability: null,
      result: null,
      selectedTarget: null,
      status: "completed",
      traceId: "trace_01HQ",
    });
  });

  it("preserves approval_required without forcing a specialist target", async () => {
    const client = createSupervisorExecutionClient(
      {
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      },
      {
        fetchImplementation: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              answer_text: "该请求涉及需要人工确认的操作，必须先经过审批。",
              error: null,
              follow_up_question: "",
              result: null,
              selected_target: null,
              status: "approval_required",
              trace_id: "trace_01HQ",
            }),
            { status: 200 },
          ),
        ),
      },
    );

    await expect(
      client.execute({
        actor: createActor(),
        context: createContext(2),
        conversationId: "conv_01HQ",
        requestId: "req_01HQ",
        traceId: "trace_01HQ",
        userGoal: "帮我提交奖学金申请",
      }),
    ).resolves.toEqual({
      answerText: "该请求涉及需要人工确认的操作，必须先经过审批。",
      error: null,
      followUpQuestion: "",
      observability: null,
      result: null,
      selectedTarget: null,
      status: "approval_required",
      traceId: "trace_01HQ",
    });
  });

  it("parses typed request observability facts from the supervisor response", async () => {
    const client = createSupervisorExecutionClient(
      {
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      },
      {
        fetchImplementation: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              answer_text: "图书馆开放到 22:00。",
              error: null,
              follow_up_question: "",
              observability: {
                acl_decision: "allowed",
                acl_anomaly_code: null,
                cached_input_tokens: 120,
                candidate_count: 5,
                citation_count: 2,
                citation_expected: true,
                citation_missing: false,
                estimated_cost_microusd: 3810,
                fail_closed: false,
                input_tokens: 812,
                model_name: "gpt-5.2-mini",
                model_provider: "openai",
                output_tokens: 229,
                refusal_class: null,
                retrieved_source_count: 2,
                retrieval_attempted: true,
              },
              result: {
                evidence: {
                  sources: [{ doc_id: "handbook:library-hours" }],
                },
              },
              selected_target: "rag-specialist",
              status: "completed",
              trace_id: "trace_01HQ",
            }),
            { status: 200 },
          ),
        ),
      },
    );

    await expect(
      client.execute({
        actor: createActor(),
        context: createContext(),
        conversationId: "conv_01HQ",
        requestId: "req_01HQ",
        traceId: "trace_01HQ",
        userGoal: "图书馆开放到几点？",
      }),
    ).resolves.toEqual({
      answerText: "图书馆开放到 22:00。",
      error: null,
      followUpQuestion: "",
      observability: {
        aclAnomalyCode: null,
        aclDecision: "allowed",
        cachedInputTokens: 120,
        candidateCount: 5,
        citationCount: 2,
        citationExpected: true,
        citationMissing: false,
        estimatedCostMicrousd: 3810,
        failClosed: false,
        inputTokens: 812,
        modelName: "gpt-5.2-mini",
        modelProvider: "openai",
        outputTokens: 229,
        refusalClass: null,
        retrievedSourceCount: 2,
        retrievalAttempted: true,
      },
      result: {
        evidence: {
          sources: [{ doc_id: "handbook:library-hours" }],
        },
      },
      selectedTarget: "rag-specialist",
      status: "completed",
      traceId: "trace_01HQ",
    });
  });

  it("raises a typed transport error for non-200 upstream responses", async () => {
    const client = createSupervisorExecutionClient(
      {
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      },
      {
        fetchImplementation: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "unauthorized",
                message: "Invalid shared secret.",
                retryable: false,
              },
            }),
            { status: 502 },
          ),
        ),
      },
    );

    await expect(
      client.execute({
        actor: createActor(),
        context: createContext(),
        conversationId: "conv_01HQ",
        requestId: "req_01HQ",
        traceId: "trace_01HQ",
        userGoal: "图书馆开放到几点？",
      }),
    ).rejects.toBeInstanceOf(SupervisorTransportError);
  });

  it("raises execution_timeout when the supervisor call exceeds the timeout budget", async () => {
    vi.useFakeTimers();
    const client = createSupervisorExecutionClient(
      {
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
        SUPERVISOR_API_TIMEOUT_MS: "25",
      },
      {
        fetchImplementation: vi.fn().mockImplementation(
          () => new Promise<Response>(() => undefined),
        ),
      },
    );

    const pending = client.execute({
      actor: createActor(),
      context: createContext(),
      conversationId: "conv_01HQ",
      requestId: "req_01HQ",
      traceId: "trace_01HQ",
      userGoal: "图书馆开放到几点？",
    });

    const assertion = expect(pending).rejects.toMatchObject({
      code: "execution_timeout",
      retryable: true,
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("raises supervisor_invalid_response when the upstream body is not valid json", async () => {
    const client = createSupervisorExecutionClient(
      {
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      },
      {
        fetchImplementation: vi.fn().mockResolvedValue(
          new Response("not-json", {
            headers: {
              "content-type": "application/json",
            },
            status: 200,
          }),
        ),
      },
    );

    await expect(
      client.execute({
        actor: createActor(),
        context: createContext(),
        conversationId: "conv_01HQ",
        requestId: "req_01HQ",
        traceId: "trace_01HQ",
        userGoal: "图书馆开放到几点？",
      }),
    ).rejects.toMatchObject({
      code: "supervisor_invalid_response",
      retryable: true,
      status: 502,
    });
  });
});
