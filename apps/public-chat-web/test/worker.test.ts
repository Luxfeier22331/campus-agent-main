import { describe, expect, it, vi } from "vitest";

import { createApp as createAppApi } from "../../app-api/src/app";
import deployStagingSource from "../scripts/deploy-staging.mjs?raw";
import packageManifestRaw from "../package.json?raw";
import verifyStagingConfigSource from "../scripts/verify-staging-config.mjs?raw";
import worker from "../src/index";
import wranglerConfig from "../wrangler.toml?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
  scripts?: Record<string, string | undefined>;
};

describe("public chat web worker shell", () => {
  it("declares the staging custom domain, app-api staging binding, and deploy gates", () => {
    expect(wranglerConfig).toContain("workers_dev = false");
    expect(wranglerConfig).toContain("preview_urls = false");
    expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
    expect(wranglerConfig).toContain("[[env.staging.routes]]");
    expect(wranglerConfig).toContain('pattern = "campus-chat-staging.ayafeed.com"');
    expect(wranglerConfig).toContain("custom_domain = true");
    expect(wranglerConfig).toContain("[[env.staging.services]]");
    expect(wranglerConfig).toContain('binding = "APP_API"');
    expect(wranglerConfig).toContain('service = "app-api-staging"');
    expect(wranglerConfig).toContain("[env.staging.vars]");
    expect(wranglerConfig).toContain(
      'PUBLIC_CHAT_HOSTNAME = "campus-chat-staging.ayafeed.com"',
    );
    expect(wranglerConfig).toContain(
      'APP_API_BASE_URL = "https://campus-api-staging.ayafeed.com"',
    );
    expect(wranglerConfig).not.toContain("AUTH_TURNSTILE_SITE_KEY");
    expect(wranglerConfig).toContain('SENTRY_ENVIRONMENT = "staging"');
    expect(wranglerConfig).not.toContain("SENTRY_RELEASE = ");
    expect(packageManifest.scripts?.["build:staging"]).toContain("CLOUDFLARE_ENV=staging");
    expect(packageManifest.scripts?.deploy).not.toContain("XDG_CONFIG_HOME=./.wrangler-home");
    expect(packageManifest.scripts?.deploy).toContain("run-wrangler-command.mjs");
    expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy:preflight:staging");
    expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy-staging.mjs");
    expect(packageManifest.scripts?.["deploy:preflight:staging"]).toContain(
      "run-worker-staging-preflight.mjs",
    );
    expect(packageManifest.scripts?.["deploy:check-secrets:staging"]).toContain(
      "check_worker_secret_presence.py",
    );
    expect(deployStagingSource).toContain("buildWranglerCommandEnv");
    expect(deployStagingSource).toContain("loadRepoEnvFile");
    expect(deployStagingSource).toContain("resolveStagingSentryRelease");
    expect(deployStagingSource).toContain("STAGING_AUTH_TURNSTILE_SITE_KEY");
    expect(deployStagingSource).toContain("STAGING_AUTH_TURNSTILE_APPEARANCE");
    expect(deployStagingSource).toContain("STAGING_AUTH_TURNSTILE_EXECUTION");
    expect(deployStagingSource).toContain("AUTH_TURNSTILE_SITE_KEY:");
    expect(deployStagingSource).toContain("AUTH_TURNSTILE_APPEARANCE:");
    expect(deployStagingSource).toContain("AUTH_TURNSTILE_EXECUTION:");
    expect(deployStagingSource).toContain("SENTRY_RELEASE:");
    expect(verifyStagingConfigSource).toContain("STAGING_AUTH_TURNSTILE_APPEARANCE");
    expect(verifyStagingConfigSource).toContain("STAGING_AUTH_TURNSTILE_EXECUTION");
    expect(packageManifest.scripts?.["deploy:staging"]).not.toContain(
      "XDG_CONFIG_HOME=./.wrangler-home",
    );
    expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
      "verify-staging-config.mjs",
    );
  });

  it("declares required secrets for local and staging worker environments", () => {
    expect(wranglerConfig).toContain("[env.staging.secrets]");
    expect(wranglerConfig).toContain('required = ["SENTRY_DSN"]');
  });

  it("serves healthz and readyz from the worker shell", async () => {
    const health = await worker.fetch(
      new Request("https://chat.example.com/healthz"),
      {
        APP_API: {
          fetch: async () =>
            new Response(
              JSON.stringify({
                status: "ready",
                dependencies: {
                  auth: "ready",
                  database: "ready",
                  officialWebHandoff: "not_configured",
                  operatorBridge: "configured",
                  publicChatOrigin: "configured",
                  supervisorApi: "ready",
                },
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json",
                },
              },
            ),
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
          fetch: async () =>
            new Response(
              JSON.stringify({
                status: "ready",
                dependencies: {
                  auth: "ready",
                  database: "ready",
                  officialWebHandoff: "not_configured",
                  operatorBridge: "configured",
                  publicChatOrigin: "configured",
                  supervisorApi: "ready",
                },
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json",
                },
              },
            ),
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
        appApiRuntime: "ready",
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

  it("fails readyz closed when the app-api runtime is not ready", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/readyz"),
      {
        APP_API: {
          fetch: async () =>
            new Response(
              JSON.stringify({
                error: {
                  code: "dependency_not_ready",
                  message: "Runtime dependencies are not ready.",
                },
              }),
              {
                status: 503,
                headers: {
                  "content-type": "application/json",
                },
              },
            ),
        },
        APP_API_BASE_URL: "https://app-api.internal",
        ASSETS: {
          fetch: async () => new Response("ok", { status: 200 }),
        },
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        details: {
          appApiRuntime: "app-api readyz returned 503",
        },
        message: "Runtime configuration is incomplete.",
      },
    });
  });

  it("redirects the removed preview path back to canonical /chat", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/chat/replatform-preview?from=legacy"),
      {
        APP_API: {
          fetch: async () => new Response(null, { status: 204 }),
        },
        ASSETS: {
          fetch: async () => new Response("should not hit assets", { status: 500 }),
        },
        APP_API_BASE_URL: "https://app-api.internal",
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://chat.example.com/chat?from=legacy");
  });

  it("serves the public chat app shell when frontend assets and app-api bridge are configured", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/"),
      {
        APP_API: {
          fetch: async () => new Response(null, { status: 204 }),
        },
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
        AUTH_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("<div id=\"root\"></div>");
    expect(html).toContain("__PUBLIC_CHAT_AUTH_CONFIG__");
    expect(html).toContain('"turnstileSiteKey":"1x00000000000000000000AA"');
    expect(html).toContain('"turnstileAppearance":"interaction-only"');
    expect(html).toContain('"turnstileExecution":"render"');
  });

  it("honors explicit Turnstile runtime posture overrides in the injected auth shell config", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/"),
      {
        APP_API: {
          fetch: async () => new Response(null, { status: 204 }),
        },
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
        AUTH_TURNSTILE_APPEARANCE: "always",
        AUTH_TURNSTILE_EXECUTION: "execute",
        AUTH_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('"turnstileAppearance":"always"');
    expect(html).toContain('"turnstileExecution":"execute"');
  });

  it("fails closed when app-api binding is not configured for the public shell", async () => {
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

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        message: "App API binding is not configured.",
      },
    });
  });

  it("fails closed when app-api base url is not configured for the public shell", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/"),
      {
        APP_API: {
          fetch: async () => new Response(null, { status: 204 }),
        },
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

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        message: "App API binding is not configured.",
      },
    });
  });

  it("fails closed when frontend assets are not configured for the public shell", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/"),
      {
        APP_API: {
          fetch: async () => new Response(null, { status: 204 }),
        },
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

  it("returns a contract-shaped dependency error when the app-api binding throws", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/api/chat/requests", {
        body: JSON.stringify({
          prompt: "图书馆开放到几点？",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
      {
        APP_API: {
          fetch: async () => {
            throw new Error("service binding failure");
          },
        },
        APP_API_BASE_URL: "https://app-api.internal",
        ASSETS: {
          fetch: async () => new Response("ok", { status: 200 }),
        },
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        details: null,
        message: "App API upstream is unavailable.",
        requestId: null,
        retryable: true,
        traceId: null,
      },
    });
  });

  it("serves the donor model catalog from the worker without proxying /api/models to app-api", async () => {
    const appApiFetch = vi.fn(async () => new Response("should not proxy", { status: 418 }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: {
            architecture: {
              input_modalities: ["text"],
            },
            endpoints: [
              {
                supported_parameters: ["tools", "reasoning"],
              },
            ],
          },
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      );
    });

    try {
      const response = await worker.fetch(
        new Request("https://chat.example.com/api/models"),
        {
          APP_API: {
            fetch: appApiFetch,
          },
          APP_API_BASE_URL: "https://app-api.internal",
          ASSETS: {
            fetch: async () => new Response("ok", { status: 200 }),
          },
          PUBLIC_CHAT_HOSTNAME: "chat.example.com",
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=86400");
      await expect(response.json()).resolves.toMatchObject({
        "moonshotai/kimi-k2-0905": {
          reasoning: true,
          tools: true,
          vision: false,
        },
      });
      expect(appApiFetch).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("forwards origin and referer for same-site auth requests", async () => {
    let forwardedCookie: string | null = null;
    let forwardedCaptchaResponse: string | null = null;
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
          "x-captcha-response": "captcha-token-01",
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
            forwardedCaptchaResponse = request.headers.get("x-captcha-response");
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
    expect(forwardedCaptchaResponse).toBe("captcha-token-01");
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
          departments: [],
          principalId: "user_01HQ",
          principalType: "campus_member",
          roles: ["student"],
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
