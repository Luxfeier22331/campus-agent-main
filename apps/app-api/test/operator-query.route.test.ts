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
      campusScope: "main",
      departments: ["ops"],
      groups: ["panel"],
      roles: ["operator"],
      snapshot: {
        display_name: "Ops Team",
        email: "ops@example.com",
        principal_type: "operator",
      },
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

describe("GET /api/operator/requests", () => {
  it("returns request projections for operator principals only", async () => {
    const service: OperatorQueryService = {
      getById: vi.fn(),
      list: vi.fn().mockResolvedValue({
        page: {
          nextCursor: "cursor_01HQ",
        },
        requests: [
          {
            answerPreview: "图书馆开放到 22:00。",
            completedAt: "2026-03-28T08:00:01.000Z",
            conversationId: "conv_01HQ",
            durationMs: 842,
            errorCode: null,
            principalId: "user_01HQ",
            principalLabel: "Jane Doe",
            principalType: "public_user",
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
          completedAt: "2026-03-28T08:00:01.000Z",
          conversationId: "conv_01HQ",
          durationMs: 842,
          errorCode: null,
          principalId: "user_01HQ",
          principalLabel: "Jane Doe",
          principalType: "public_user",
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
      getPrincipal: vi.fn().mockResolvedValue({
        actor: {
          campusScope: "main",
          departments: [],
          groups: ["students"],
          roles: ["student"],
          snapshot: {
            principal_type: "public_user",
          },
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
          type: "public_user",
        },
        session: {
          expiresAt: "2026-03-29T07:00:00.000Z",
          sessionId: "sess_01HQ",
        },
      }),
      operatorQueryService: {
        getById: vi.fn(),
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
        completedAt: "2026-03-28T08:00:01.000Z",
        conversationId: "conv_01HQ",
        durationMs: 842,
        errorCode: null,
        principalId: "user_01HQ",
        principalLabel: "Jane Doe",
        principalType: "public_user",
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
      }),
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
        completedAt: "2026-03-28T08:00:01.000Z",
        conversationId: "conv_01HQ",
        durationMs: 842,
        errorCode: null,
        principalId: "user_01HQ",
        principalLabel: "Jane Doe",
        principalType: "public_user",
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
});
