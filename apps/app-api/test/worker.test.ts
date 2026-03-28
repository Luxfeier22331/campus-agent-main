import { describe, expect, it } from "vitest";

import worker from "../src/index";
import wranglerConfig from "../wrangler.toml?raw";

describe("app-api worker foundation", () => {
  it("closes workers.dev and preview urls in config", () => {
    expect(wranglerConfig).toContain("workers_dev = false");
    expect(wranglerConfig).toContain("preview_urls = false");
    expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
  });

  it("serves healthz and readyz from the worker shell", async () => {
    const health = await worker.fetch(
      new Request("https://app-api.internal/healthz"),
      {
        APP_API_NAME: "campus-agent-app-api",
        BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
        PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
        APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
        APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
        APP_API_ENVIRONMENT: "test",
        APP_API_DB: {
          connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
        },
      },
    );
    const ready = await worker.fetch(
      new Request("https://app-api.internal/readyz"),
      {
        APP_API_NAME: "campus-agent-app-api",
        BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
        PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
        APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
        APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
        APP_API_ENVIRONMENT: "test",
        APP_API_DB: {
          connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
        },
      },
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
});
