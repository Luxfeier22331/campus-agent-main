import { describe, expect, it, vi } from "vitest";

import { createApp as createAppApi } from "../../app-api/src/app";
import packageManifestRaw from "../package.json?raw";
import worker from "../src/index";
import wranglerConfig from "../wrangler.toml?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
  scripts?: Record<string, string | undefined>;
};

describe("public chat web worker shell", () => {
  it("declares the app-api service binding and deploy verification gate", () => {
    expect(wranglerConfig).toContain("workers_dev = false");
    expect(wranglerConfig).toContain("preview_urls = false");
    expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
    expect(wranglerConfig).toMatch(/routes?\s*=/);
    expect(wranglerConfig).toContain("[[services]]");
    expect(wranglerConfig).toContain('binding = "APP_API"');
    expect(wranglerConfig).toContain('service = "app-api"');
    expect(packageManifest.scripts?.deploy).toContain("deploy:verify-config");
    expect(packageManifest.scripts?.["deploy:verify-config"]).toContain(
      "verify-worker-deploy-config.mjs",
    );
    expect(packageManifest.scripts?.["deploy:verify-config"]).toContain(
      "dist/public_chat_web/wrangler.json",
    );
  });

  it("serves healthz and readyz from the worker shell", async () => {
    const health = await worker.fetch(
      new Request("https://chat.example.com/healthz"),
      {
        APP_API: {
          fetch: async () => new Response(null, { status: 204 }),
        },
        APP_API_BASE_URL: "https://app-api.internal",
        ASSETS: {
          fetch: async () => new Response("ok", { status: 200 }),
        },
        PUBLIC_CHAT_APP_NAME: "campus-agent-public-chat-web",
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );
    const ready = await worker.fetch(
      new Request("https://chat.example.com/readyz"),
      {
        APP_API: {
          fetch: async () => new Response(null, { status: 204 }),
        },
        APP_API_BASE_URL: "https://app-api.internal",
        ASSETS: {
          fetch: async () => new Response("ok", { status: 200 }),
        },
        PUBLIC_CHAT_APP_NAME: "campus-agent-public-chat-web",
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );

    expect(health.status).toBe(200);
    expect(health.headers.get("cache-control")).toBe("no-store");
    await expect(health.json()).resolves.toEqual({
      status: "ok",
      app_name: "campus-agent-public-chat-web",
      surface: "public-chat-web",
      runtime: "cloudflare-worker",
    });

    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    await expect(ready.json()).resolves.toEqual({
      status: "ready",
      app_api_base_url: "https://app-api.internal",
      dependencies: {
        appApiBinding: "configured",
        assets: "configured",
      },
      public_hostname: "chat.example.com",
      runtime: "cloudflare-worker",
    });
  });

  it("fails readyz closed when runtime dependencies are missing", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/readyz"),
      {
        PUBLIC_CHAT_APP_NAME: "campus-agent-public-chat-web",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        details: {
          missing: [
            "APP_API binding",
            "ASSETS binding",
            "APP_API_BASE_URL",
            "PUBLIC_CHAT_HOSTNAME",
          ],
        },
        message: "Runtime configuration is incomplete.",
      },
    });
  });

  it("serves the public chat app shell when frontend assets are configured", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/"),
      {
        ASSETS: {
          fetch: async () =>
            new Response("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
              headers: {
                "content-type": "text/html; charset=utf-8",
              },
              status: 200,
            }),
        },
        APP_API_BASE_URL: "https://app-api.internal",
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toContain("<div id=\"root\"></div>");
  });

  it("fails closed when frontend assets are not configured for the public shell", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/"),
      {
        APP_API_BASE_URL: "https://app-api.internal",
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "frontend_assets_not_ready",
        message: "Public chat frontend assets are not configured.",
      },
    });
  });

  it("proxies same-site api requests to app-api and forwards auth/body headers only", async () => {
    let forwardedBody: string | null = null;
    let forwardedBaggage: string | null = null;
    let forwardedCookie: string | null = null;
    let forwardedIdempotencyKey: string | null = null;
    let forwardedOrigin: string | null = null;
    let forwardedReferer: string | null = null;
    let forwardedSentryTrace: string | null = null;
    let forwardedTraceId: string | null = null;
    let forwardedUrl: string | null = null;

    const response = await worker.fetch(
      new Request("https://chat.example.com/api/chat/requests", {
        method: "POST",
        headers: {
          accept: "application/json",
          cookie: "better-auth.session_token=test",
          "content-type": "application/json",
          "idempotency-key": "idem-001",
          baggage: "sentry-environment=test",
          "sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
          origin: "https://chat.example.com",
          referer: "https://chat.example.com/chat",
          "x-spoofed-header": "drop-me",
          "x-trace-id": "trace-001",
        },
        body: JSON.stringify({
          conversationId: "conv_01HQ",
          prompt: "图书馆开放到几点？",
        }),
      }),
      {
        APP_API: {
          fetch: async (request: Request) => {
            forwardedBody = await request.text();
            forwardedBaggage = request.headers.get("baggage");
            forwardedCookie = request.headers.get("cookie");
            forwardedIdempotencyKey = request.headers.get("idempotency-key");
            forwardedOrigin = request.headers.get("origin");
            forwardedReferer = request.headers.get("referer");
            forwardedSentryTrace = request.headers.get("sentry-trace");
            forwardedTraceId = request.headers.get("x-trace-id");
            forwardedUrl = request.url;

            return new Response(
              JSON.stringify({
                answer: {
                  result: {
                    kind: "answer",
                    requestId: "req_01HQ",
                  },
                },
              }),
              {
                headers: {
                  "content-type": "application/json; charset=utf-8",
                  "x-request-id": "req_01HQ",
                },
                status: 200,
              },
            );
          },
        },
        APP_API_BASE_URL: "https://app-api.internal",
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("req_01HQ");
    await expect(response.json()).resolves.toEqual({
      answer: {
        result: {
          kind: "answer",
          requestId: "req_01HQ",
        },
      },
    });
    expect(forwardedUrl).toBe("https://app-api.internal/api/chat/requests");
    expect(forwardedCookie).toBe("better-auth.session_token=test");
    expect(forwardedIdempotencyKey).toBe("idem-001");
    expect(forwardedBaggage).toBe("sentry-environment=test");
    expect(forwardedOrigin).toBeNull();
    expect(forwardedReferer).toBeNull();
    expect(forwardedSentryTrace).toBe(
      "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
    );
    expect(forwardedTraceId).toBe("trace-001");
    expect(forwardedBody).toBe(
      JSON.stringify({
        conversationId: "conv_01HQ",
        prompt: "图书馆开放到几点？",
      }),
    );
  });

  it("forwards origin and referer for same-site auth requests", async () => {
    let forwardedCookie: string | null = null;
    let forwardedOrigin: string | null = null;
    let forwardedReferer: string | null = null;
    let forwardedUrl: string | null = null;

    const response = await worker.fetch(
      new Request("https://chat.example.com/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          cookie: "better-auth.session_token=test",
          "content-type": "application/json",
          origin: "https://chat.example.com",
          referer: "https://chat.example.com/login",
        },
        body: JSON.stringify({
          email: "jane@example.edu",
          password: "password12345",
        }),
      }),
      {
        APP_API: {
          fetch: async (request: Request) => {
            forwardedCookie = request.headers.get("cookie");
            forwardedOrigin = request.headers.get("origin");
            forwardedReferer = request.headers.get("referer");
            forwardedUrl = request.url;

            return new Response(JSON.stringify({ ok: true }), {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            });
          },
        },
        APP_API_BASE_URL: "https://app-api.internal",
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(forwardedUrl).toBe("https://app-api.internal/api/auth/sign-in/email");
    expect(forwardedCookie).toBe("better-auth.session_token=test");
    expect(forwardedOrigin).toBe("https://chat.example.com");
    expect(forwardedReferer).toBe("https://chat.example.com/login");
  });

  it("smokes a chat request through public-chat-web into app-api", async () => {
    const appApiEnv = {
      APP_API_NAME: "campus-agent-app-api",
      APP_API_ENVIRONMENT: "test" as const,
      BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
      PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
      SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
      SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
      APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
      APP_API_DB: {
        connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      },
    };
    const appApi = createAppApi(appApiEnv, {
      chatCommandService: {
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
      },
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
    });

    const response = await worker.fetch(
      new Request("https://chat.example.com/api/chat/requests", {
        body: JSON.stringify({
          prompt: "图书馆开放到几点？",
        }),
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=test",
          "idempotency-key": "idem-001",
        },
        method: "POST",
      }),
      {
        APP_API: {
          fetch: async (request: Request) => appApi.fetch(request, appApiEnv),
        },
        APP_API_BASE_URL: "https://app-api.internal",
        ASSETS: {
          fetch: async () =>
            new Response("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
              headers: {
                "content-type": "text/html; charset=utf-8",
              },
              status: 200,
            }),
        },
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("req_01HQ");
    await expect(response.json()).resolves.toMatchObject({
      answer: {
        result: {
          kind: "answer",
          requestId: "req_01HQ",
        },
      },
    });
  });

  it("fails closed when app-api binding is missing", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/api/me"),
      {
        APP_API_BASE_URL: "https://app-api.internal",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        message: "App API binding is not configured.",
      },
    });
  });
});
