import { describe, expect, it, vi } from "vitest";

import packageManifestRaw from "../package.json?raw";
import worker, { createWorkerRuntime } from "../src/index";
import wranglerConfig from "../wrangler.toml?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
  scripts?: Record<string, string | undefined>;
};

const env = {
  APP_API_NAME: "campus-agent-app-api",
  BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
  PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
  SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
  SUPERVISOR_API_SHARED_SECRET: "shared-secret",
  APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
  APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
  APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
  APP_API_ENVIRONMENT: "test" as const,
  APP_API_DB: {
    connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
  },
};

function createCampusPrincipal() {
  return {
    actor: {
      departments: [],
      principalId: "user_01HQ",
      principalType: "campus_member" as const,
      roles: ["campus_member"],
      userId: "user_01HQ",
    },
    permissions: {
      chat: true,
      operator: false,
    },
    principal: {
      displayName: "Jane Doe",
      email: "jane@muc.edu.cn",
      principalId: "user_01HQ",
      type: "campus_member" as const,
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

function createRuntimeReadinessResult() {
  return {
    dependencies: {
      auth: "ready",
      database: "ready",
      officialWebHandoff: "not_configured",
      operatorBridge: "configured",
      publicChatOrigin: "configured",
      supervisorApi: "ready",
    },
    failed: {},
  };
}

describe("app-api worker foundation", () => {
  it("declares the staging custom domain, hyperdrive binding, and deploy gate", () => {
    expect(wranglerConfig).toContain("workers_dev = false");
    expect(wranglerConfig).toContain("preview_urls = false");
    expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
    expect(wranglerConfig).toContain("[[env.local.hyperdrive]]");
    expect(wranglerConfig).toContain('binding = "APP_API_DB"');
    expect(wranglerConfig).toContain("[[env.staging.routes]]");
    expect(wranglerConfig).toContain('pattern = "api-staging.ayafeed.com"');
    expect(wranglerConfig).toContain("custom_domain = true");
    expect(wranglerConfig).toContain("[[env.staging.hyperdrive]]");
    expect(wranglerConfig).toContain("[env.staging.vars]");
    expect(wranglerConfig).toContain('APP_API_ENVIRONMENT = "staging"');
    expect(wranglerConfig).toContain('PUBLIC_CHAT_WEB_ORIGIN = "https://chat-staging.ayafeed.com"');
    expect(wranglerConfig).toContain('APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST = "muc.edu.cn"');
    expect(wranglerConfig).not.toContain("SUPERVISOR_API_BASE_URL");
    expect(wranglerConfig).toContain('APP_API_OPERATOR_EMAIL_ALLOWLIST = "ops@example.com"');
    expect(wranglerConfig).toContain('SENTRY_ENVIRONMENT = "staging"');
    expect(wranglerConfig).toContain('SENTRY_RELEASE = "app-api@staging-20260405-05c3d45"');
    expect(wranglerConfig).toContain('AXIOM_ENDPOINT = "https://us-east-1.aws.edge.axiom.co"');
    expect(wranglerConfig).toContain('AXIOM_DATASET = "campus-agent-runtime-dev"');
    expect(packageManifest.scripts?.deploy).not.toContain("XDG_CONFIG_HOME=./.wrangler-home");
    expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy-staging.mjs");
    expect(packageManifest.scripts?.["deploy:staging"]).not.toContain(
      "XDG_CONFIG_HOME=./.wrangler-home",
    );
  });

  it("serves healthz and readyz from the worker shell", async () => {
    const runtime = createWorkerRuntime(env, {
      runtimeReadinessProbe: vi.fn().mockResolvedValue(createRuntimeReadinessResult()),
    });
    const health = await runtime.fetch(
      new Request("https://app-api.internal/healthz"),
      createExecutionContext(),
    );
    const ready = await runtime.fetch(
      new Request("https://app-api.internal/readyz"),
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
        auth: "ready",
        database: "ready",
        officialWebHandoff: "not_configured",
        operatorBridge: "configured",
        publicChatOrigin: "configured",
        supervisorApi: "ready",
      },
    });
  });

  it("fails readyz closed when required config is missing", async () => {
    const runtime = createWorkerRuntime(
      {
        APP_API_NAME: "campus-agent-app-api",
        APP_API_ENVIRONMENT: "test",
      },
      {
        runtimeReadinessProbe: vi.fn(),
      },
    );
    const response = await runtime.fetch(
      new Request("https://app-api.internal/readyz"),
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
            "APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST",
            "APP_API_OPERATOR_EMAIL_ALLOWLIST",
            "APP_API_INTERNAL_SHARED_SECRET",
          ],
        },
      },
    });
  });

  it("fails readyz closed when runtime probes detect unavailable dependencies", async () => {
    const runtime = createWorkerRuntime(env, {
      runtimeReadinessProbe: vi.fn().mockResolvedValue({
        dependencies: {
          auth: "not_ready",
          database: "ready",
          officialWebHandoff: "not_configured",
          operatorBridge: "configured",
          publicChatOrigin: "configured",
          supervisorApi: "not_ready",
        },
        failed: {
          auth: "better-auth session runtime failed probe",
          supervisorApi: "supervisor /readyz returned 503",
        },
      }),
    });

    const response = await runtime.fetch(
      new Request("https://app-api.internal/readyz"),
      createExecutionContext(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        message: "Runtime dependencies are not ready.",
        retryable: true,
        traceId: null,
        requestId: null,
        details: {
          failed: {
            auth: "better-auth session runtime failed probe",
            supervisorApi: "supervisor /readyz returned 503",
          },
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
      getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
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

  it("does not schedule a request projection drain after a successful internal eval request", async () => {
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
    expect(waitUntil).not.toHaveBeenCalled();
    expect(requestProjector.drainRequest).not.toHaveBeenCalled();
    expect(requestProjector.drain).not.toHaveBeenCalled();
  });

  it("falls back to a local async drain when executionCtx.waitUntil is unavailable", async () => {
    const requestProjector = {
      drain: vi.fn().mockResolvedValue({ failed: 0, processed: 0 }),
      drainRequest: vi.fn().mockResolvedValue({ failed: 0, processed: 1 }),
    };
    const chatCommandService = {
      submit: vi.fn().mockResolvedValue({
        answer: {
          conversation: {
            createdAt: "2026-03-28T07:59:00.000Z",
            id: "conv_fallback_01HQ",
            messages: [],
            title: "图书馆开放时间",
            updatedAt: "2026-03-28T08:00:01.000Z",
          },
          result: {
            kind: "answer",
            requestId: "req_fallback_01HQ",
            text: "图书馆开放到 22:00。",
            traceId: "trace_fallback_01HQ",
          },
        },
        requestId: "req_fallback_01HQ",
        traceId: "trace_fallback_01HQ",
      }),
    };
    const runtime = createWorkerRuntime(env, {
      chatCommandService,
      getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
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
    );

    expect(response.status).toBe(200);
    await Promise.resolve();
    expect(requestProjector.drainRequest).toHaveBeenCalledWith("req_fallback_01HQ");
    expect(requestProjector.drain).not.toHaveBeenCalled();
  });
});
