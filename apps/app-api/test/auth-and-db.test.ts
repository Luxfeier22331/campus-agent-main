// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
  createBetterAuthPool,
  createRuntimePool,
  buildManagementDatabaseConfig,
  buildRuntimeDatabaseConfig,
} from "../src/db/runtime";
import { buildBetterAuthConfig } from "../src/modules/auth/auth";
import { appApiSchema } from "../src/db/schema";
import migration0000 from "../drizzle/0000_funny_tiger_shark.sql?raw";

const { createdPoolOptions } = vi.hoisted(() => ({
  createdPoolOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("pg", () => ({
  Pool: class MockPool {
    readonly options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      createdPoolOptions.push(options);
    }
  },
}));

describe("app-api database config", () => {
  it("uses Hyperdrive connectionString for runtime database access", () => {
    const config = buildRuntimeDatabaseConfig({
      APP_API_ENVIRONMENT: "test",
      APP_API_DB: {
        connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      },
    });

    expect(config.connectionString).toBe(
      "postgres://postgres:secret@example.com:5432/campus_agent",
    );
    expect(config.ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("uses direct management connection for migrations", () => {
    const config = buildManagementDatabaseConfig({
      APP_API_DATABASE_SSLMODE: "require",
      APP_API_MANAGEMENT_DATABASE_URL:
        "postgres://postgres:secret@example.com:5432/campus_agent_admin",
    });

    expect(config.connectionString).toBe(
      "postgres://postgres:secret@example.com:5432/campus_agent_admin",
    );
    expect(config.ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("creates a fresh runtime pool for each call", async () => {
    createdPoolOptions.length = 0;

    const env = {
      APP_API_ENVIRONMENT: "test" as const,
      APP_API_DB: {
        connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      },
    };

    const first = await createRuntimePool(env);
    const second = await createRuntimePool(env);

    expect(first).not.toBe(second);
    expect(createdPoolOptions).toHaveLength(2);
    expect(createdPoolOptions[0]).toMatchObject({
      allowExitOnIdle: true,
      connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      idleTimeoutMillis: 5_000,
      max: 1,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  });

  it("creates a fresh auth pool for each call with the app_auth search_path", async () => {
    createdPoolOptions.length = 0;

    const env = {
      APP_API_ENVIRONMENT: "test" as const,
      APP_API_DB: {
        connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      },
    };

    const first = await createBetterAuthPool(env);
    const second = await createBetterAuthPool(env);

    expect(first).not.toBe(second);
    expect(createdPoolOptions).toHaveLength(2);

    const connectionString = String(createdPoolOptions[0]?.connectionString ?? "");
    const options = decodeURIComponent(new URL(connectionString).searchParams.get("options") ?? "");

    expect(options).toContain("search_path=app_auth,public");
  });
});

describe("app-api auth config", () => {
  it("freezes explicit auth/session policy for the shared app boundary", () => {
    const config = buildBetterAuthConfig({
      appName: "campus-agent-app-api",
      betterAuthSecret: "prod-secret-prod-secret-prod-secret",
      environment: "production",
      publicChatOrigin: "https://chat.example.com",
      database: {} as never,
    });

    expect(config.baseURL).toBe("https://chat.example.com");
    expect(config.basePath).toBe("/api/auth");
    expect(config.emailAndPassword).toMatchObject({
      autoSignIn: true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 10,
    });
    expect(config.session).toMatchObject({
      expiresIn: 60 * 60 * 24 * 7,
      storeSessionInDatabase: true,
      updateAge: 60 * 60 * 24,
    });
    expect(config.rateLimit).toMatchObject({
      enabled: true,
      max: 10,
      storage: "memory",
      window: 60,
    });
  });

  it("exposes one unified runtime schema object for app_auth/chat/official_web/runtime/operator", () => {
    expect(Object.keys(appApiSchema)).toEqual(
      expect.arrayContaining([
        "user",
        "session",
        "account",
        "verification",
        "conversations",
        "messages",
        "sessionSlots",
        "crawlRuns",
        "runHeartbeats",
        "runArtifacts",
        "runOutbox",
        "requestExecution",
        "projectionOutbox",
        "requestProjection",
        "requestAuditProjection",
        "officialWebRunProjection",
        "officialWebSiteProjection",
      ]),
    );
  });

  it("creates the official_web schema in the baseline migration before official_web tables", () => {
    expect(migration0000).toContain('CREATE SCHEMA IF NOT EXISTS "official_web";');
  });
});

describe("/api/me", () => {
  const env = {
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

  it("returns session_required when no app principal exists", async () => {
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(null),
    });

    const response = await app.fetch(new Request("https://app-api.internal/api/me"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "session_required",
        message: "Sign in required.",
        retryable: false,
        traceId: null,
        requestId: null,
        details: null,
      },
    });
  });

  it("mounts /api/auth/* onto the auth handler seam", async () => {
    const authHandler = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const app = createApp(env, {
      authHandler,
      getPrincipal: vi.fn().mockResolvedValue(null),
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/auth/get-session", {
        headers: {
          cookie: "better-auth.session_token=test",
        },
      }),
    );

    expect(authHandler).toHaveBeenCalledTimes(1);
    expect(authHandler).toHaveBeenCalledWith(expect.any(Request), env);
    expect(response.status).toBe(204);
  });

  it("returns the current public user principal and session", async () => {
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue({
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

    const response = await app.fetch(new Request("https://app-api.internal/api/me"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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
    });
  });

  it("returns a trusted operator principal without creating a user session", async () => {
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue({
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
      }),
    });

    const response = await app.fetch(new Request("https://app-api.internal/api/me"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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
    });
  });
});
