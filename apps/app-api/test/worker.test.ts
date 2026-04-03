import { describe, expect, it, vi } from "vitest";

import worker, { createWorkerRuntime } from "../src/index";
import wranglerConfig from "../wrangler.toml?raw";

const env = {
  APP_API_NAME: "campus-agent-app-api",
  BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
  PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
  SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
  SUPERVISOR_API_SHARED_SECRET: "shared-secret",
  APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
  APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
  APP_API_ENVIRONMENT: "test" as const,
  APP_API_DB: {
    connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
  },
};

function createPublicPrincipal() {
  return {
    actor: {
      departments: [],
      principalId: "user_01HQ",
      principalType: "public_user" as const,
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

function createExecutionContext(waitUntil = vi.fn()): ExecutionContext {
  return {
    passThroughOnException() {},
    props: {},
    waitUntil,
  } as unknown as ExecutionContext;
}

describe("app-api worker foundation", () => {
  it("closes workers.dev and preview urls in config", () => {
    expect(wranglerConfig).toContain("workers_dev = false");
    expect(wranglerConfig).toContain("preview_urls = false");
    expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
    expect(wranglerConfig).toContain("[[env.local.hyperdrive]]");
    expect(wranglerConfig).toContain('binding = "APP_API_DB"');
  });

  it("serves healthz and readyz from the worker shell", async () => {
    const health = await worker.fetch(
      new Request("https://app-api.internal/healthz"),
      env,
      createExecutionContext(),
    );
    const ready = await worker.fetch(
      new Request("https://app-api.internal/readyz"),
      env,
      createExecutionContext(),
    );

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      status: "ok",
      app: "campus-agent-app-api",
    });

    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({
      status: "ready",
      dependencies: {
        auth: "configured",
        database: "configured",
        officialWebHandoff: "not_configured",
        operatorBridge: "configured",
        publicChatOrigin: "configured",
        supervisorApi: "configured",
      },
    });
  });

  it("fails readyz closed when required config is missing", async () => {
    const response = await worker.fetch(
      new Request("https://app-api.internal/readyz"),
      {
        APP_API_NAME: "campus-agent-app-api",
        APP_API_ENVIRONMENT: "test",
      },
      createExecutionContext(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        message: "Runtime configuration is incomplete.",
        retryable: true,
        traceId: null,
        requestId: null,
        details: {
          missing: [
            "APP_API_DB.connectionString",
            "BETTER_AUTH_SECRET",
            "PUBLIC_CHAT_WEB_ORIGIN",
            "SUPERVISOR_API_BASE_URL",
            "SUPERVISOR_API_SHARED_SECRET",
            "APP_API_OPERATOR_EMAIL_ALLOWLIST",
            "APP_API_INTERNAL_SHARED_SECRET",
          ],
        },
      },
    });
  });

  it("schedules a request projection drain after a successful public chat request", async () => {
    const requestProjector = {
      drain: vi.fn().mockResolvedValue({ failed: 0, processed: 0 }),
      drainRequest: vi.fn().mockResolvedValue({ failed: 0, processed: 1 }),
    };
    const chatCommandService = {
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
    const waitUntil = vi.fn();
    const runtime = createWorkerRuntime(env, {
      chatCommandService,
      getPrincipal: vi.fn().mockResolvedValue(createPublicPrincipal()),
      requestProjector,
    });

    const response = await runtime.fetch(
      new Request("https://app-api.internal/api/chat/requests", {
        body: JSON.stringify({
          prompt: "图书馆开放到几点？",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
      createExecutionContext(waitUntil),
    );

    expect(response.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    expect(requestProjector.drainRequest).toHaveBeenCalledWith("req_01HQ");
    expect(requestProjector.drain).not.toHaveBeenCalled();
  });

  it("schedules a request projection drain after a successful internal eval request", async () => {
    const requestProjector = {
      drain: vi.fn().mockResolvedValue({ failed: 0, processed: 0 }),
      drainRequest: vi.fn().mockResolvedValue({ failed: 0, processed: 1 }),
    };
    const chatCommandService = {
      submit: vi.fn().mockResolvedValue({
        answer: {
          conversation: {
            createdAt: "2026-03-28T07:59:00.000Z",
            id: "conv_eval_01HQ",
            messages: [],
            title: "图书馆开放时间",
            updatedAt: "2026-03-28T08:00:01.000Z",
          },
          result: {
            kind: "answer",
            requestId: "req_eval_01HQ",
            text: "图书馆开放到 22:00。",
            traceId: "trace_eval_01HQ",
          },
        },
        requestId: "req_eval_01HQ",
        traceId: "trace_eval_01HQ",
      }),
    };
    const waitUntil = vi.fn();
    const runtime = createWorkerRuntime(env, {
      chatCommandService,
      requestProjector,
    });

    const response = await runtime.fetch(
      new Request("https://app-api.internal/api/internal/evals/chat/requests", {
        body: JSON.stringify({
          prompt: "图书馆开放到几点？",
        }),
        headers: {
          "content-type": "application/json",
          "x-app-internal-auth": "app-api-internal-secret",
          "x-eval-user-email": "eval-benchmark@example.edu",
        },
        method: "POST",
      }),
      createExecutionContext(waitUntil),
    );

    expect(response.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    expect(requestProjector.drainRequest).toHaveBeenCalledWith("req_eval_01HQ");
    expect(requestProjector.drain).not.toHaveBeenCalled();
  });
});
