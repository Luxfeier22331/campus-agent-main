// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { AppApiRouteError, type ChatCommandService } from "../src/modules/runtime-command";

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

function createPublicPrincipal() {
  return {
    actor: {
      campusScope: null,
      departments: [],
      groups: ["public_chat_users"],
      principalId: "user_01HQ",
      principalType: "public_user",
      roles: ["public_user"],
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
      type: "public_user" as const,
    },
    session: {
      expiresAt: "2026-03-29T07:00:00.000Z",
      sessionId: "sess_01HQ",
    },
  };
}

describe("POST /api/chat/requests", () => {
  it("returns a product-layer answer payload plus request/trace headers", async () => {
    const service: ChatCommandService = {
      submit: vi.fn().mockResolvedValue({
        answer: {
          conversation: {
            createdAt: "2026-03-28T07:59:00.000Z",
            id: "conv_01HQ",
            messages: [],
            title: "图书馆开放时间",
            updatedAt: "2026-03-28T08:00:01.000Z",
          },
          result: {
            kind: "answer",
            requestId: "req_01HQ",
            text: "图书馆开放到 22:00。",
            traceId: "trace_01HQ",
          },
        },
        requestId: "req_01HQ",
        traceId: "trace_01HQ",
      }),
    };
    const app = createApp(env, {
      chatCommandService: service,
      getPrincipal: vi.fn().mockResolvedValue(createPublicPrincipal()),
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/chat/requests", {
        body: JSON.stringify({
          prompt: "图书馆开放到几点？",
        }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem-001",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_01HQ");
    expect(response.headers.get("x-trace-id")).toBe("trace_01HQ");
    await expect(response.json()).resolves.toEqual({
      answer: {
        conversation: {
          createdAt: "2026-03-28T07:59:00.000Z",
          id: "conv_01HQ",
          messages: [],
          title: "图书馆开放时间",
          updatedAt: "2026-03-28T08:00:01.000Z",
        },
        result: {
          kind: "answer",
          requestId: "req_01HQ",
          text: "图书馆开放到 22:00。",
          traceId: "trace_01HQ",
        },
      },
    });
    expect(service.submit).toHaveBeenCalledWith({
      idempotencyKey: "idem-001",
      payload: {
        prompt: "图书馆开放到几点？",
      },
      principal: expect.objectContaining({
        principal: expect.objectContaining({
          principalId: "user_01HQ",
        }),
      }),
    });
  });

  it("fails closed when no principal is available", async () => {
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(null),
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/chat/requests", {
        body: JSON.stringify({
          prompt: "图书馆开放到几点？",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "session_required",
        details: null,
        message: "Sign in required.",
        requestId: null,
        retryable: false,
        traceId: null,
      },
    });
  });

  it("maps service-level pre-accept errors onto the shared error envelope", async () => {
    const app = createApp(env, {
      chatCommandService: {
        submit: vi.fn().mockRejectedValue(
          new AppApiRouteError({
            code: "conversation_not_found",
            message: "Conversation not found.",
            retryable: false,
            status: 404,
          }),
        ),
      },
      getPrincipal: vi.fn().mockResolvedValue(createPublicPrincipal()),
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/chat/requests", {
        body: JSON.stringify({
          conversationId: "conv_missing",
          prompt: "图书馆开放到几点？",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "conversation_not_found",
        details: null,
        message: "Conversation not found.",
        requestId: null,
        retryable: false,
        traceId: null,
      },
    });
  });
});
