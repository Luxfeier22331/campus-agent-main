// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { AppApiRouteError } from "../src/http";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { OperatorQueryService } from "../src/modules/operator-query";

const env = {
  APP_API_NAME: "campus-agent-app-api",
  APP_API_ENVIRONMENT: "test" as const,
  BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
  PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
  SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
  SUPERVISOR_API_SHARED_SECRET: "shared-secret",
  APP_API_DB: {
    connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
  },
};

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

function createCampusPrincipal(): ResolvedAppPrincipal {
  return {
    actor: {
      departments: [],
      principalId: "user_01HQ",
      principalType: "campus_member",
      roles: ["campus_member"],
      userId: "user_01HQ",
    },
    permissions: {
      chat: true,
      operator: false,
    },
    principal: {
      displayName: "Jane Doe",
      email: "jane@example.edu",
      principalId: "user_01HQ",
      type: "campus_member",
    },
    session: {
      expiresAt: "2026-03-29T07:00:00.000Z",
      sessionId: "sess_01HQ",
    },
  };
}

describe("GET /api/operator/requests", () => {
  it("returns request projections for operator principals only", async () => {
    const service: OperatorQueryService = {
      getById: vi.fn(),
      getAuditById: vi.fn(),
      getObservabilityById: vi.fn(),
      getOverview: vi.fn(),
      getQualitySummary: vi.fn(),
      getQualityTimeseries: vi.fn(),
      getSafetySummary: vi.fn(),
      getCostSummary: vi.fn(),
      listQualityBadcases: vi.fn(),
      listAudit: vi.fn(),
      list: vi.fn().mockResolvedValue({
        page: {
          nextCursor: "cursor_01HQ",
        },
        requests: [
          {
            answerPreview: "图书馆开放到 22:00。",
            applicabilityScope: "undergraduate",
            completedAt: "2026-03-28T08:00:01.000Z",
            conversationId: "conv_01HQ",
            durationMs: 842,
            errorCode: null,
            entitlementGroups: ["students"],
            entitlementSnapshotId: "entitlements-2026-03-29",
            principalId: "user_01HQ",
            principalLabel: "Jane Doe",
            principalType: "student",
            projectedAt: "2026-03-28T08:00:02.000Z",
            questionPreview: "图书馆开放到几点？",
            requestId: "req_01HQ",
            requestedCapability: "knowledge",
            requestedScope: {
              collection: "student_handbook",
              corpus: "regulations",
            },
            selectedTarget: "rag-specialist",
            sourceDocIds: ["handbook:library-hours"],
            startedAt: "2026-03-28T08:00:00.000Z",
            status: "completed",
            surface: "public_chat_web",
            traceId: "trace_01HQ",
            visibilityScope: "main",
          },
        ],
      }),
    };
    const principal = createOperatorPrincipal();
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      operatorQueryService: service,
    });

    const response = await app.fetch(
      new Request(
        "https://app-api.internal/api/operator/requests?limit=10&status=completed",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      page: {
        nextCursor: "cursor_01HQ",
      },
      requests: [
        {
          answerPreview: "图书馆开放到 22:00。",
          applicabilityScope: "undergraduate",
          completedAt: "2026-03-28T08:00:01.000Z",
          conversationId: "conv_01HQ",
          durationMs: 842,
          errorCode: null,
          entitlementGroups: ["students"],
          entitlementSnapshotId: "entitlements-2026-03-29",
          principalId: "user_01HQ",
          principalLabel: "Jane Doe",
          principalType: "student",
          projectedAt: "2026-03-28T08:00:02.000Z",
          questionPreview: "图书馆开放到几点？",
          requestId: "req_01HQ",
          requestedCapability: "knowledge",
          requestedScope: {
            collection: "student_handbook",
            corpus: "regulations",
          },
          selectedTarget: "rag-specialist",
          sourceDocIds: ["handbook:library-hours"],
          startedAt: "2026-03-28T08:00:00.000Z",
          status: "completed",
          surface: "public_chat_web",
          traceId: "trace_01HQ",
          visibilityScope: "main",
        },
      ],
    });
    expect(service.list).toHaveBeenCalledWith({
      filters: {
        conversationId: null,
        cursor: null,
        limit: 10,
        requestId: null,
        status: "completed",
        surface: null,
      },
      principal,
    });
  });

  it("fails closed for missing or non-operator principals", async () => {
    const appWithoutPrincipal = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(null),
      operatorQueryService: {
        getById: vi.fn(),
        getAuditById: vi.fn(),
        getObservabilityById: vi.fn(),
        getOverview: vi.fn(),
        getQualitySummary: vi.fn(),
        getQualityTimeseries: vi.fn(),
        getSafetySummary: vi.fn(),
        getCostSummary: vi.fn(),
        listQualityBadcases: vi.fn(),
        listAudit: vi.fn(),
        list: vi.fn(),
      },
    });

    const anonymous = await appWithoutPrincipal.fetch(
      new Request("https://app-api.internal/api/operator/requests"),
    );

    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toEqual({
      error: {
        code: "session_required",
        details: null,
        message: "Sign in required.",
        requestId: null,
        retryable: false,
        traceId: null,
      },
    });

    const appWithUserPrincipal = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
      operatorQueryService: {
        getById: vi.fn(),
        getAuditById: vi.fn(),
        getObservabilityById: vi.fn(),
        getOverview: vi.fn(),
        getQualitySummary: vi.fn(),
        getQualityTimeseries: vi.fn(),
        getSafetySummary: vi.fn(),
        getCostSummary: vi.fn(),
        listQualityBadcases: vi.fn(),
        listAudit: vi.fn(),
        list: vi.fn(),
      },
    });

    const forbidden = await appWithUserPrincipal.fetch(
      new Request("https://app-api.internal/api/operator/requests"),
    );

    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      error: {
        code: "forbidden",
        details: null,
        message: "Operator access is not available for this principal.",
        requestId: null,
        retryable: false,
        traceId: null,
      },
    });
  });
});

describe("GET /api/operator/requests/:requestId", () => {
  it("returns one request projection detail", async () => {
    const service: OperatorQueryService = {
      getById: vi.fn().mockResolvedValue({
        answerPreview: "图书馆开放到 22:00。",
        applicabilityScope: "undergraduate",
        completedAt: "2026-03-28T08:00:01.000Z",
        conversationId: "conv_01HQ",
        durationMs: 842,
        errorCode: null,
        entitlementGroups: ["students"],
        entitlementSnapshotId: "entitlements-2026-03-29",
        principalId: "user_01HQ",
        principalLabel: "Jane Doe",
        principalType: "student",
        projectedAt: "2026-03-28T08:00:02.000Z",
        questionPreview: "图书馆开放到几点？",
        requestId: "req_01HQ",
        requestedCapability: "knowledge",
        requestedScope: {
          collection: "student_handbook",
          corpus: "regulations",
        },
        selectedTarget: "rag-specialist",
        sourceDocIds: ["handbook:library-hours"],
        startedAt: "2026-03-28T08:00:00.000Z",
        status: "completed",
        surface: "public_chat_web",
        traceId: "trace_01HQ",
        visibilityScope: "main",
      }),
      getAuditById: vi.fn(),
      getObservabilityById: vi.fn(),
      getOverview: vi.fn(),
      getQualitySummary: vi.fn(),
      getQualityTimeseries: vi.fn(),
      getSafetySummary: vi.fn(),
      getCostSummary: vi.fn(),
      listQualityBadcases: vi.fn(),
      listAudit: vi.fn(),
      list: vi.fn(),
    };
    const principal = createOperatorPrincipal();
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      operatorQueryService: service,
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/operator/requests/req_01HQ"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      request: {
        answerPreview: "图书馆开放到 22:00。",
        applicabilityScope: "undergraduate",
        completedAt: "2026-03-28T08:00:01.000Z",
        conversationId: "conv_01HQ",
        durationMs: 842,
        errorCode: null,
        entitlementGroups: ["students"],
        entitlementSnapshotId: "entitlements-2026-03-29",
        principalId: "user_01HQ",
        principalLabel: "Jane Doe",
        principalType: "student",
        projectedAt: "2026-03-28T08:00:02.000Z",
        questionPreview: "图书馆开放到几点？",
        requestId: "req_01HQ",
        requestedCapability: "knowledge",
        requestedScope: {
          collection: "student_handbook",
          corpus: "regulations",
        },
        selectedTarget: "rag-specialist",
        sourceDocIds: ["handbook:library-hours"],
        startedAt: "2026-03-28T08:00:00.000Z",
        status: "completed",
        surface: "public_chat_web",
        traceId: "trace_01HQ",
        visibilityScope: "main",
      },
    });
    expect(service.getById).toHaveBeenCalledWith({
      principal,
      requestId: "req_01HQ",
    });
  });

  it("maps missing projections onto the shared error envelope", async () => {
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
      operatorQueryService: {
        getById: vi.fn().mockRejectedValue(
          new AppApiRouteError({
            code: "request_not_found",
            message: "Request projection not found.",
            retryable: false,
            status: 404,
          }),
        ),
        getAuditById: vi.fn(),
        getObservabilityById: vi.fn(),
        getOverview: vi.fn(),
        getQualitySummary: vi.fn(),
        getQualityTimeseries: vi.fn(),
        getSafetySummary: vi.fn(),
        getCostSummary: vi.fn(),
        listQualityBadcases: vi.fn(),
        listAudit: vi.fn(),
        list: vi.fn(),
      },
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/operator/requests/req_missing"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "request_not_found",
        details: null,
        message: "Request projection not found.",
        requestId: null,
        retryable: false,
        traceId: null,
      },
    });
  });

  it("includes summary diagnostics in request detail when projection carries them", async () => {
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
      operatorQueryService: {
        getById: vi.fn().mockResolvedValue({
          answerPreview:
            "在《中央民族大学本科学生国家奖学金评审办法》中，当前未检索到足够依据支持回答这个问题；请确认是否有更具体的条款表述。",
          completedAt: "2026-03-28T08:00:01.000Z",
          conversationId: "conv_01HQ",
          diagnostics: {
            clarificationReason: null,
            noAnswerReason: "resolved_policy_clause_not_found",
            policyReason: null,
            resolvedPolicyDocumentId:
              "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
            resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
            retrievedTitleSummary: ["中央民族大学本科学生国家奖学金评审办法"],
            rewrittenQuery:
              "中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
            scopeClass: null,
            semanticOutcome: null,
          },
          durationMs: 842,
          errorCode: null,
          principalId: "user_01HQ",
          principalLabel: "Jane Doe",
          principalType: "campus_member",
          projectedAt: "2026-03-28T08:00:02.000Z",
          questionPreview: "民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
          requestId: "req_01HQ",
          requestedCapability: "knowledge",
          requestedScope: {
            collection: "student_handbook",
            corpus: "regulations",
          },
          selectedTarget: "rag-specialist",
          sourceDocIds: ["handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"],
          startedAt: "2026-03-28T08:00:00.000Z",
          status: "no_answer",
          surface: "public_chat_web",
          traceId: "trace_01HQ",
        }),
        getAuditById: vi.fn(),
        getObservabilityById: vi.fn(),
        getOverview: vi.fn(),
        getQualitySummary: vi.fn(),
        getQualityTimeseries: vi.fn(),
        getSafetySummary: vi.fn(),
        getCostSummary: vi.fn(),
        listQualityBadcases: vi.fn(),
        listAudit: vi.fn(),
        list: vi.fn(),
      },
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/operator/requests/req_01HQ"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      request: {
        answerPreview:
          "在《中央民族大学本科学生国家奖学金评审办法》中，当前未检索到足够依据支持回答这个问题；请确认是否有更具体的条款表述。",
        completedAt: "2026-03-28T08:00:01.000Z",
        conversationId: "conv_01HQ",
        diagnostics: {
          clarificationReason: null,
          noAnswerReason: "resolved_policy_clause_not_found",
          policyReason: null,
          resolvedPolicyDocumentId:
            "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
          resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
          retrievedTitleSummary: ["中央民族大学本科学生国家奖学金评审办法"],
          rewrittenQuery:
            "中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
          scopeClass: null,
          semanticOutcome: null,
        },
        durationMs: 842,
        errorCode: null,
        principalId: "user_01HQ",
        principalLabel: "Jane Doe",
        principalType: "campus_member",
        projectedAt: "2026-03-28T08:00:02.000Z",
        questionPreview: "民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
        requestId: "req_01HQ",
        requestedCapability: "knowledge",
        requestedScope: {
          collection: "student_handbook",
          corpus: "regulations",
        },
        selectedTarget: "rag-specialist",
        sourceDocIds: ["handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"],
        startedAt: "2026-03-28T08:00:00.000Z",
        status: "no_answer",
        surface: "public_chat_web",
        traceId: "trace_01HQ",
      },
    });
  });
});

describe("GET /api/operator/requests/:requestId/observability", () => {
  it("returns request-scoped observability detail for operator principals", async () => {
    const service = {
      getById: vi.fn(),
      getAuditById: vi.fn(),
      getObservabilityById: vi.fn().mockResolvedValue({
        auditSummary: {
          auditEventCount: 0,
          latestTerminalCode: "completed",
        },
        links: {
          issueFingerprint: "timeout:supervisor-api",
          issueLink: "https://sentry.example/issues/123",
          traceLink: "https://sentry.example/traces/trace_01HQ",
        },
        observability: {
          aclAnomalyCode: null,
          aclDecision: "allowed",
          cachedInputTokens: 0,
          candidateCount: 4,
          citationCount: 2,
          citationExpected: true,
          citationMissing: false,
          durationMs: 842,
          emptyRecall: false,
          estimatedCost: {
            currency: "USD",
            microusd: 3810,
          },
          failClosed: false,
          inputTokens: 812,
          measuredAt: "2026-03-28T08:00:01.000Z",
          model: {
            name: "gpt-5.2-mini",
            provider: "openai",
          },
          outputTokens: 229,
          projectionLagMs: 420,
          refusalClass: null,
          retrievedSourceCount: 2,
          retrievalAttempted: true,
          traceAvailable: true,
        },
        request: {
          completedAt: "2026-03-28T08:00:01.000Z",
          conversationId: "conv_01HQ",
          requestId: "req_01HQ",
          requestedCapability: "knowledge",
          requestedScope: {
            collection: "student_handbook",
            corpus: "regulations",
          },
          selectedTarget: "rag-specialist",
          startedAt: "2026-03-28T08:00:00.000Z",
          status: "completed",
          surface: "public_chat_web",
          traceId: "trace_01HQ",
        },
      }),
      getOverview: vi.fn(),
      listAudit: vi.fn(),
      list: vi.fn(),
    } as unknown as OperatorQueryService;
    const principal = createOperatorPrincipal();
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      operatorQueryService: service,
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/operator/requests/req_01HQ/observability"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      auditSummary: {
        auditEventCount: 0,
        latestTerminalCode: "completed",
      },
      links: {
        issueFingerprint: "timeout:supervisor-api",
        issueLink: "https://sentry.example/issues/123",
        traceLink: "https://sentry.example/traces/trace_01HQ",
      },
      observability: {
        aclAnomalyCode: null,
        aclDecision: "allowed",
        cachedInputTokens: 0,
        candidateCount: 4,
        citationCount: 2,
        citationExpected: true,
        citationMissing: false,
        durationMs: 842,
        emptyRecall: false,
        estimatedCost: {
          currency: "USD",
          microusd: 3810,
        },
        failClosed: false,
        inputTokens: 812,
        measuredAt: "2026-03-28T08:00:01.000Z",
        model: {
          name: "gpt-5.2-mini",
          provider: "openai",
        },
        outputTokens: 229,
        projectionLagMs: 420,
        refusalClass: null,
        retrievedSourceCount: 2,
        retrievalAttempted: true,
        traceAvailable: true,
      },
      request: {
        completedAt: "2026-03-28T08:00:01.000Z",
        conversationId: "conv_01HQ",
        requestId: "req_01HQ",
        requestedCapability: "knowledge",
        requestedScope: {
          collection: "student_handbook",
          corpus: "regulations",
        },
        selectedTarget: "rag-specialist",
        startedAt: "2026-03-28T08:00:00.000Z",
        status: "completed",
        surface: "public_chat_web",
        traceId: "trace_01HQ",
      },
    });
    expect(service.getObservabilityById).toHaveBeenCalledWith({
      principal,
      requestId: "req_01HQ",
    });
  });
});

describe("GET /api/operator/overview", () => {
  it("returns an operator overview snapshot for operator principals", async () => {
    const service = {
      getById: vi.fn(),
      getAuditById: vi.fn(),
      getObservabilityById: vi.fn(),
      getOverview: vi.fn().mockResolvedValue({
        alerts: [],
        asOf: "2026-03-28T08:00:10.000Z",
        overview: {
          aclAnomalyRate: {
            count: 0,
            eligibleCount: 4,
            value: 0,
          },
          citationMissRate: {
            count: 1,
            eligibleCount: 3,
            value: 0.3333,
          },
          emptyRecallRate: {
            count: 1,
            eligibleCount: 4,
            value: 0.25,
          },
          estimatedCost: {
            currency: "USD",
            microusd: 7620,
          },
          failureRate: {
            count: 1,
            eligibleCount: 4,
            value: 0.25,
          },
          latency: {
            p50Ms: 842,
            p95Ms: 1600,
            p99Ms: 1600,
          },
          refusalRate: {
            count: 1,
            eligibleCount: 4,
            value: 0.25,
          },
          requestVolume: {
            accepted: 4,
            completed: 3,
            errored: 1,
          },
          sinkHealth: {
            missingTraceRate: {
              count: 0,
              eligibleCount: 4,
              value: 0,
            },
            projectionFailureCount: 0,
          },
        },
        window: {
          from: "2026-03-27T08:00:10.000Z",
          granularity: "1h",
          to: "2026-03-28T08:00:10.000Z",
        },
      }),
      listAudit: vi.fn(),
      list: vi.fn(),
    } as unknown as OperatorQueryService;
    const principal = createOperatorPrincipal();
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      operatorQueryService: service,
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/operator/overview?window=24h"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      alerts: [],
      asOf: "2026-03-28T08:00:10.000Z",
      overview: {
        aclAnomalyRate: {
          count: 0,
          eligibleCount: 4,
          value: 0,
        },
        citationMissRate: {
          count: 1,
          eligibleCount: 3,
          value: 0.3333,
        },
        emptyRecallRate: {
          count: 1,
          eligibleCount: 4,
          value: 0.25,
        },
        estimatedCost: {
          currency: "USD",
          microusd: 7620,
        },
        failureRate: {
          count: 1,
          eligibleCount: 4,
          value: 0.25,
        },
        latency: {
          p50Ms: 842,
          p95Ms: 1600,
          p99Ms: 1600,
        },
        refusalRate: {
          count: 1,
          eligibleCount: 4,
          value: 0.25,
        },
        requestVolume: {
          accepted: 4,
          completed: 3,
          errored: 1,
        },
        sinkHealth: {
          missingTraceRate: {
            count: 0,
            eligibleCount: 4,
            value: 0,
          },
          projectionFailureCount: 0,
        },
      },
      window: {
        from: "2026-03-27T08:00:10.000Z",
        granularity: "1h",
        to: "2026-03-28T08:00:10.000Z",
      },
    });
    expect(service.getOverview).toHaveBeenCalledWith({
      filters: {
        collection: null,
        granularity: null,
        modelName: null,
        principalType: null,
        requestedCapability: null,
        selectedTarget: null,
        surface: null,
        window: "24h",
      },
      principal,
    });
  });
});

describe("GET /api/operator/quality/summary", () => {
  it("returns a quality summary snapshot for operator principals", async () => {
    const service = {
      getById: vi.fn(),
      getAuditById: vi.fn(),
      getObservabilityById: vi.fn(),
      getOverview: vi.fn(),
      getQualitySummary: vi.fn().mockResolvedValue({
        asOf: "2026-03-28T08:00:10.000Z",
        runtime: {
          citationMissRate: {
            count: 1,
            eligibleCount: 2,
            value: 0.5,
          },
          emptyRecallRate: {
            count: 1,
            eligibleCount: 3,
            value: 0.3333,
          },
          refusalDistribution: {
            approvalRequired: 1,
            needsClarification: 1,
            noAnswer: 1,
            rejected: 0,
          },
          requestCount: 4,
        },
        sampledGrades: {
          badcaseOpenCount: 1,
          citationPassRate: {
            count: 1,
            eligibleCount: 2,
            value: 0.5,
          },
          coverageRate: {
            count: 2,
            eligibleCount: 4,
            value: 0.5,
          },
          groundingPassRate: {
            count: 1,
            eligibleCount: 2,
            value: 0.5,
          },
          policyPassRate: {
            count: 2,
            eligibleCount: 2,
            value: 1,
          },
        },
        window: {
          from: "2026-03-27T08:00:10.000Z",
          granularity: "1h",
          to: "2026-03-28T08:00:10.000Z",
        },
      }),
      getQualityTimeseries: vi.fn(),
      getSafetySummary: vi.fn(),
      getCostSummary: vi.fn(),
      listQualityBadcases: vi.fn(),
      listAudit: vi.fn(),
      list: vi.fn(),
    };
    const principal = createOperatorPrincipal();
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      operatorQueryService: service as unknown as OperatorQueryService,
    });

    const response = await app.fetch(
      new Request(
        "https://app-api.internal/api/operator/quality/summary?window=24h&surface=public_chat_web",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      asOf: "2026-03-28T08:00:10.000Z",
      runtime: {
        citationMissRate: {
          count: 1,
          eligibleCount: 2,
          value: 0.5,
        },
        emptyRecallRate: {
          count: 1,
          eligibleCount: 3,
          value: 0.3333,
        },
        refusalDistribution: {
          approvalRequired: 1,
          needsClarification: 1,
          noAnswer: 1,
          rejected: 0,
        },
        requestCount: 4,
      },
      sampledGrades: {
        badcaseOpenCount: 1,
        citationPassRate: {
          count: 1,
          eligibleCount: 2,
          value: 0.5,
        },
        coverageRate: {
          count: 2,
          eligibleCount: 4,
          value: 0.5,
        },
        groundingPassRate: {
          count: 1,
          eligibleCount: 2,
          value: 0.5,
        },
        policyPassRate: {
          count: 2,
          eligibleCount: 2,
          value: 1,
        },
      },
      window: {
        from: "2026-03-27T08:00:10.000Z",
        granularity: "1h",
        to: "2026-03-28T08:00:10.000Z",
      },
    });
    expect(service.getQualitySummary).toHaveBeenCalledWith({
      filters: {
        collection: null,
        granularity: null,
        modelName: null,
        principalType: null,
        requestedCapability: null,
        selectedTarget: null,
        surface: "public_chat_web",
        window: "24h",
      },
      principal,
    });
  });
});

describe("GET /api/operator/quality/timeseries", () => {
  it("returns a quality timeseries snapshot for operator principals", async () => {
    const service = {
      getById: vi.fn(),
      getAuditById: vi.fn(),
      getObservabilityById: vi.fn(),
      getOverview: vi.fn(),
      getQualitySummary: vi.fn(),
      getQualityTimeseries: vi.fn().mockResolvedValue({
        asOf: "2026-03-28T08:00:10.000Z",
        series: [
          {
            bucketEnd: "2026-03-28T08:00:00.000Z",
            bucketStart: "2026-03-28T07:00:00.000Z",
            citationMissRate: 0.5,
            emptyRecallRate: 0.25,
            needsClarificationRate: 0.25,
            noAnswerRate: 0.25,
            requestCount: 4,
            sampledGroundingPassRate: 0.5,
          },
        ],
        window: {
          from: "2026-03-27T08:00:10.000Z",
          granularity: "1h",
          to: "2026-03-28T08:00:10.000Z",
        },
      }),
      getSafetySummary: vi.fn(),
      getCostSummary: vi.fn(),
      listQualityBadcases: vi.fn(),
      listAudit: vi.fn(),
      list: vi.fn(),
    };
    const principal = createOperatorPrincipal();
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      operatorQueryService: service as unknown as OperatorQueryService,
    });

    const response = await app.fetch(
      new Request(
        "https://app-api.internal/api/operator/quality/timeseries?window=24h&granularity=1h&surface=public_chat_web",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      asOf: "2026-03-28T08:00:10.000Z",
      series: [
        {
          bucketEnd: "2026-03-28T08:00:00.000Z",
          bucketStart: "2026-03-28T07:00:00.000Z",
          citationMissRate: 0.5,
          emptyRecallRate: 0.25,
          needsClarificationRate: 0.25,
          noAnswerRate: 0.25,
          requestCount: 4,
          sampledGroundingPassRate: 0.5,
        },
      ],
      window: {
        from: "2026-03-27T08:00:10.000Z",
        granularity: "1h",
        to: "2026-03-28T08:00:10.000Z",
      },
    });
    expect(service.getQualityTimeseries).toHaveBeenCalledWith({
      filters: {
        collection: null,
        granularity: "1h",
        modelName: null,
        principalType: null,
        requestedCapability: null,
        selectedTarget: null,
        surface: "public_chat_web",
        window: "24h",
      },
      principal,
    });
  });
});

describe("GET /api/operator/quality/badcases", () => {
  it("returns a quality badcase queue for operator principals", async () => {
    const service = {
      getById: vi.fn(),
      getAuditById: vi.fn(),
      getObservabilityById: vi.fn(),
      getOverview: vi.fn(),
      getQualitySummary: vi.fn(),
      getQualityTimeseries: vi.fn(),
      getSafetySummary: vi.fn(),
      getCostSummary: vi.fn(),
      listQualityBadcases: vi.fn().mockResolvedValue({
        badcases: [
          {
            badcaseId: "qbad_01HQ",
            causeClass: "citation_missing",
            detectedBy: "runtime_monitor",
            grade: {
              graderVersion: "grader@2026-04-03",
              result: "fail",
              score: 0.42,
            },
            links: {
              issueFingerprint: "citation-missing",
              issueLink: "https://sentry.example/issues/456",
              traceLink: "https://sentry.example/traces/trace_01HQ",
            },
            openedAt: "2026-03-28T08:00:10.000Z",
            requestId: "req_01HQ",
            selectedTarget: "rag-specialist",
            status: "open",
            summary: "citationExpected=true 但 citationCount=0",
            surface: "public_chat_web",
            traceId: "trace_01HQ",
          },
        ],
        page: {
          nextCursor: null,
        },
      }),
      listAudit: vi.fn(),
      list: vi.fn(),
    };
    const principal = createOperatorPrincipal();
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      operatorQueryService: service as unknown as OperatorQueryService,
    });

    const response = await app.fetch(
      new Request(
        "https://app-api.internal/api/operator/quality/badcases?status=open&causeClass=citation_missing&detectedBy=runtime_monitor",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      badcases: [
        {
          badcaseId: "qbad_01HQ",
          causeClass: "citation_missing",
          detectedBy: "runtime_monitor",
          grade: {
            graderVersion: "grader@2026-04-03",
            result: "fail",
            score: 0.42,
          },
          links: {
            issueFingerprint: "citation-missing",
            issueLink: "https://sentry.example/issues/456",
            traceLink: "https://sentry.example/traces/trace_01HQ",
          },
          openedAt: "2026-03-28T08:00:10.000Z",
          requestId: "req_01HQ",
          selectedTarget: "rag-specialist",
          status: "open",
          summary: "citationExpected=true 但 citationCount=0",
          surface: "public_chat_web",
          traceId: "trace_01HQ",
        },
      ],
      page: {
        nextCursor: null,
      },
    });
    expect(service.listQualityBadcases).toHaveBeenCalledWith({
      filters: {
        causeClass: "citation_missing",
        cursor: null,
        detectedBy: "runtime_monitor",
        limit: null,
        status: "open",
      },
      principal,
    });
  });
});

describe("GET /api/operator/safety/summary", () => {
  it("returns a safety summary snapshot for operator principals", async () => {
    const service = {
      getById: vi.fn(),
      getAuditById: vi.fn(),
      getObservabilityById: vi.fn(),
      getOverview: vi.fn(),
      getQualitySummary: vi.fn(),
      getQualityTimeseries: vi.fn(),
      getSafetySummary: vi.fn().mockResolvedValue({
        asOf: "2026-03-28T08:00:10.000Z",
        summary: {
          aclAnomalyRate: {
            count: 1,
            eligibleCount: 4,
            value: 0.25,
          },
          decisionDistribution: {
            allowed: 2,
            approvalRequired: 1,
            denied: 1,
            failClosed: 1,
          },
          failClosedRate: {
            count: 1,
            eligibleCount: 4,
            value: 0.25,
          },
          restrictedDenyRate: {
            count: 1,
            eligibleCount: 4,
            value: 0.25,
          },
        },
        window: {
          from: "2026-03-27T08:00:10.000Z",
          granularity: "1h",
          to: "2026-03-28T08:00:10.000Z",
        },
      }),
      listQualityBadcases: vi.fn(),
      getCostSummary: vi.fn(),
      listAudit: vi.fn(),
      list: vi.fn(),
    };
    const principal = createOperatorPrincipal();
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      operatorQueryService: service as unknown as OperatorQueryService,
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/operator/safety/summary?window=7d"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      asOf: "2026-03-28T08:00:10.000Z",
      summary: {
        aclAnomalyRate: {
          count: 1,
          eligibleCount: 4,
          value: 0.25,
        },
        decisionDistribution: {
          allowed: 2,
          approvalRequired: 1,
          denied: 1,
          failClosed: 1,
        },
        failClosedRate: {
          count: 1,
          eligibleCount: 4,
          value: 0.25,
        },
        restrictedDenyRate: {
          count: 1,
          eligibleCount: 4,
          value: 0.25,
        },
      },
      window: {
        from: "2026-03-27T08:00:10.000Z",
        granularity: "1h",
        to: "2026-03-28T08:00:10.000Z",
      },
    });
    expect(service.getSafetySummary).toHaveBeenCalledWith({
      filters: {
        collection: null,
        granularity: null,
        modelName: null,
        principalType: null,
        requestedCapability: null,
        selectedTarget: null,
        surface: null,
        window: "7d",
      },
      principal,
    });
  });
});

describe("GET /api/operator/cost/summary", () => {
  it("returns a cost summary snapshot for operator principals", async () => {
    const service = {
      getById: vi.fn(),
      getAuditById: vi.fn(),
      getObservabilityById: vi.fn(),
      getOverview: vi.fn(),
      getQualitySummary: vi.fn(),
      getQualityTimeseries: vi.fn(),
      getSafetySummary: vi.fn(),
      getCostSummary: vi.fn().mockResolvedValue({
        asOf: "2026-03-28T08:00:10.000Z",
        summary: {
          byModel: [
            {
              estimatedCostMicrousd: 3810,
              modelName: "gpt-5.2-mini",
              requestCount: 1,
            },
          ],
          bySurface: [
            {
              estimatedCostMicrousd: 3810,
              requestCount: 1,
              surface: "public_chat_web",
            },
          ],
          estimatedCost: {
            currency: "USD",
            microusd: 3810,
          },
          tokens: {
            cachedInput: 0,
            input: 812,
            output: 229,
          },
        },
        window: {
          from: "2026-03-27T08:00:10.000Z",
          granularity: "15m",
          to: "2026-03-28T08:00:10.000Z",
        },
      }),
      listQualityBadcases: vi.fn(),
      listAudit: vi.fn(),
      list: vi.fn(),
    };
    const principal = createOperatorPrincipal();
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      operatorQueryService: service as unknown as OperatorQueryService,
    });

    const response = await app.fetch(
      new Request(
        "https://app-api.internal/api/operator/cost/summary?window=1h&modelName=gpt-5.2-mini",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      asOf: "2026-03-28T08:00:10.000Z",
      summary: {
        byModel: [
          {
            estimatedCostMicrousd: 3810,
            modelName: "gpt-5.2-mini",
            requestCount: 1,
          },
        ],
        bySurface: [
          {
            estimatedCostMicrousd: 3810,
            requestCount: 1,
            surface: "public_chat_web",
          },
        ],
        estimatedCost: {
          currency: "USD",
          microusd: 3810,
        },
        tokens: {
          cachedInput: 0,
          input: 812,
          output: 229,
        },
      },
      window: {
        from: "2026-03-27T08:00:10.000Z",
        granularity: "15m",
        to: "2026-03-28T08:00:10.000Z",
      },
    });
    expect(service.getCostSummary).toHaveBeenCalledWith({
      filters: {
        collection: null,
        granularity: null,
        modelName: "gpt-5.2-mini",
        principalType: null,
        requestedCapability: null,
        selectedTarget: null,
        surface: null,
        window: "1h",
      },
      principal,
    });
  });
});

describe("GET /api/operator/audit", () => {
  it("returns an audit event list for operator principals", async () => {
    const service = {
      getById: vi.fn(),
      getAuditById: vi.fn(),
      getObservabilityById: vi.fn(),
      getOverview: vi.fn(),
      getQualitySummary: vi.fn(),
      getSafetySummary: vi.fn(),
      getCostSummary: vi.fn(),
      listAudit: vi.fn().mockResolvedValue({
        events: [
          {
            auditEventId: "aevt_01HQ",
            eventType: "request.completed",
            occurredAt: "2026-03-28T08:00:01.000Z",
            principalType: "campus_member",
            requestId: "req_01HQ",
            selectedTarget: "rag-specialist",
            status: "completed",
            summary: "Knowledge request completed via rag-specialist.",
            surface: "public_chat_web",
            traceId: "trace_01HQ",
          },
        ],
        page: {
          nextCursor: "cursor_01HQ",
        },
      }),
      list: vi.fn(),
    };
    const principal = createOperatorPrincipal();
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      operatorQueryService: service as unknown as OperatorQueryService,
    });

    const response = await app.fetch(
      new Request(
        "https://app-api.internal/api/operator/audit?limit=10&requestId=req_01HQ&eventType=request.completed",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      events: [
        {
          auditEventId: "aevt_01HQ",
          eventType: "request.completed",
          occurredAt: "2026-03-28T08:00:01.000Z",
          principalType: "campus_member",
          requestId: "req_01HQ",
          selectedTarget: "rag-specialist",
          status: "completed",
          summary: "Knowledge request completed via rag-specialist.",
          surface: "public_chat_web",
          traceId: "trace_01HQ",
        },
      ],
      page: {
        nextCursor: "cursor_01HQ",
      },
    });
    expect(service.listAudit).toHaveBeenCalledWith({
      filters: {
        cursor: null,
        eventType: "request.completed",
        limit: 10,
        principalType: null,
        requestId: "req_01HQ",
        selectedTarget: null,
        status: null,
        surface: null,
        traceId: null,
      },
      principal,
    });
  });
});

describe("GET /api/operator/audit/:auditEventId", () => {
  it("returns one audit event detail for operator principals", async () => {
    const service = {
      getById: vi.fn(),
      getAuditById: vi.fn().mockResolvedValue({
        event: {
          auditEventId: "aevt_01HQ",
          diagnostics: {
            aclAnomalyCode: null,
            failClosed: false,
            sourceDocIds: ["handbook:library-hours"],
          },
          entitlementSnapshotId: "entitlements-2026-03-29",
          eventType: "request.completed",
          occurredAt: "2026-03-28T08:00:01.000Z",
          policyProjectionVersion: "2026-03-29",
          principalType: "campus_member",
          requestId: "req_01HQ",
          requestedCapability: "knowledge",
          selectedTarget: "rag-specialist",
          status: "completed",
          summary: "Knowledge request completed via rag-specialist.",
          surface: "public_chat_web",
          terminalCode: "completed",
          traceId: "trace_01HQ",
        },
        links: {
          issueFingerprint: "timeout:supervisor-api",
          issueLink: "https://sentry.example/issues/123",
          traceLink: "https://sentry.example/traces/trace_01HQ",
        },
      }),
      getObservabilityById: vi.fn(),
      getOverview: vi.fn(),
      getQualitySummary: vi.fn(),
      getQualityTimeseries: vi.fn(),
      getSafetySummary: vi.fn(),
      getCostSummary: vi.fn(),
      listQualityBadcases: vi.fn(),
        listAudit: vi.fn(),
        list: vi.fn(),
    };
    const principal = createOperatorPrincipal();
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      operatorQueryService: service as unknown as OperatorQueryService,
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/operator/audit/aevt_01HQ"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      event: {
        auditEventId: "aevt_01HQ",
        diagnostics: {
          aclAnomalyCode: null,
          failClosed: false,
          sourceDocIds: ["handbook:library-hours"],
        },
        entitlementSnapshotId: "entitlements-2026-03-29",
        eventType: "request.completed",
        occurredAt: "2026-03-28T08:00:01.000Z",
        policyProjectionVersion: "2026-03-29",
        principalType: "campus_member",
        requestId: "req_01HQ",
        requestedCapability: "knowledge",
        selectedTarget: "rag-specialist",
        status: "completed",
        summary: "Knowledge request completed via rag-specialist.",
        surface: "public_chat_web",
        terminalCode: "completed",
        traceId: "trace_01HQ",
      },
      links: {
        issueFingerprint: "timeout:supervisor-api",
        issueLink: "https://sentry.example/issues/123",
        traceLink: "https://sentry.example/traces/trace_01HQ",
      },
    });
    expect(service.getAuditById).toHaveBeenCalledWith({
      auditEventId: "aevt_01HQ",
      principal,
    });
  });
});
