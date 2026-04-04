// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { resolveEnvironment } from "../src/config";
import {
  createRuntimePool,
  buildManagementDatabaseConfig,
  buildRuntimeDatabaseConfig,
  probeRuntimeDatabase,
} from "../src/db/runtime";
import {
  buildBetterAuthConfig,
  getAppAuth,
  hashAppPassword,
  probeAppAuthRuntime,
  verifyAppPassword,
} from "../src/modules/auth/auth";
import { appApiSchema } from "../src/db/schema";
import migration0000 from "../drizzle/0000_funny_tiger_shark.sql?raw";

const { createdPoolOptions, endedPoolOptions, poolErrorHandlers } = vi.hoisted(() => ({
  createdPoolOptions: [] as Array<Record<string, unknown>>,
  endedPoolOptions: [] as Array<Record<string, unknown>>,
  poolErrorHandlers: [] as Array<(error: Error) => void>,
}));

vi.mock("pg", () => ({
  Pool: class MockPool {
    readonly options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      createdPoolOptions.push(options);
    }

    on(eventName: string, listener: (error: Error) => void) {
      if (eventName === "error") {
        poolErrorHandlers.push(listener);
      }
      return this;
    }

    async query() {
      return {
        command: "SELECT",
        fields: [],
        rowCount: 1,
        rows: [{ ok: 1 }],
      };
    }

    async connect() {
      return {
        query: this.query.bind(this),
        release() {},
      };
    }

    async end() {
      endedPoolOptions.push(this.options);
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

  it("uses the fresh Hyperdrive binding for auth-sensitive read-after-write paths when available", () => {
    const config = buildRuntimeDatabaseConfig(
      {
        APP_API_ENVIRONMENT: "staging",
        APP_API_DB: {
          connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_cached",
        },
        APP_API_DB_FRESH: {
          connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
        },
      },
      {
        consistency: "fresh",
      },
    );

    expect(config.connectionString).toBe(
      "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
    );
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

  it("reuses one runtime pool for repeated calls under the same env", async () => {
    createdPoolOptions.length = 0;
    endedPoolOptions.length = 0;
    poolErrorHandlers.length = 0;

    const env = {
      APP_API_ENVIRONMENT: "test" as const,
      APP_API_DB: {
        connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      },
    };

    const first = await createRuntimePool(env);
    const second = await createRuntimePool(env);

    expect(first).toBe(second);
    expect(createdPoolOptions).toHaveLength(1);
    expect(createdPoolOptions[0]).toMatchObject({
      allowExitOnIdle: true,
      connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      idleTimeoutMillis: 5_000,
      max: 1,
      ssl: {
        rejectUnauthorized: false,
      },
    });
    expect(poolErrorHandlers).toHaveLength(1);
  });

  it("does not reuse the runtime pool in development env", async () => {
    createdPoolOptions.length = 0;
    endedPoolOptions.length = 0;
    poolErrorHandlers.length = 0;

    const env = {
      APP_API_ENVIRONMENT: "development" as const,
      APP_API_DB: {
        connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      },
    };

    const first = await createRuntimePool(env);
    const second = await createRuntimePool(env);

    expect(first).not.toBe(second);
    expect(createdPoolOptions).toHaveLength(2);
    expect(poolErrorHandlers).toHaveLength(2);
  });

  it("preserves staging as an explicit deployed environment instead of collapsing it into development", () => {
    expect(
      resolveEnvironment({
        APP_API_ENVIRONMENT: "staging" as never,
      }),
    ).toBe("staging");
  });

  it("uses deployed pool settings for staging runtime database access", async () => {
    createdPoolOptions.length = 0;
    endedPoolOptions.length = 0;
    poolErrorHandlers.length = 0;

    const env = {
      APP_API_ENVIRONMENT: "staging" as never,
      APP_API_DB: {
        connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      },
    };

    const runtimePool = await createRuntimePool(env);

    expect(runtimePool).toBeDefined();
    expect(createdPoolOptions).toHaveLength(1);
    expect(poolErrorHandlers).toHaveLength(1);
    expect(createdPoolOptions[0]).toMatchObject({
      allowExitOnIdle: false,
      connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      idleTimeoutMillis: 30_000,
      max: 4,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  });

  it("does not reuse the runtime pool in staging env", async () => {
    createdPoolOptions.length = 0;
    endedPoolOptions.length = 0;
    poolErrorHandlers.length = 0;

    const env = {
      APP_API_ENVIRONMENT: "staging" as never,
      APP_API_DB: {
        connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      },
    };

    const first = await createRuntimePool(env);
    const second = await createRuntimePool(env);

    expect(first).not.toBe(second);
    expect(createdPoolOptions).toHaveLength(2);
    expect(poolErrorHandlers).toHaveLength(2);
  });

  it("builds Better Auth on the shared runtime connection instead of an auth-specific search_path pool", async () => {
    createdPoolOptions.length = 0;
    endedPoolOptions.length = 0;
    poolErrorHandlers.length = 0;

    const env = {
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
      APP_API_DB_FRESH: {
        connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
      },
    };

    const auth = await getAppAuth(env);

    expect(auth).toBeDefined();
    expect(createdPoolOptions).toHaveLength(1);
    expect(poolErrorHandlers).toHaveLength(1);

    const connectionString = String(createdPoolOptions[0]?.connectionString ?? "");
    expect(connectionString).toBe("postgres://postgres:secret@example.com:5432/campus_agent_fresh");
    expect(new URL(connectionString).searchParams.get("options")).toBeNull();
  });

  it("registers a pool error handler that does not rethrow idle client failures", async () => {
    createdPoolOptions.length = 0;
    endedPoolOptions.length = 0;
    poolErrorHandlers.length = 0;

    const env = {
      APP_API_ENVIRONMENT: "test" as const,
      APP_API_DB: {
        connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      },
    };

    await createRuntimePool(env);

    expect(poolErrorHandlers).toHaveLength(1);
    expect(() => poolErrorHandlers[0](new Error("getaddrinfo EAI_AGAIN pooler.example.com"))).not.toThrow();
  });

  it("reuses one Better Auth instance for repeated calls under the same env", async () => {
    createdPoolOptions.length = 0;
    endedPoolOptions.length = 0;
    poolErrorHandlers.length = 0;

    const env = {
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

    const first = await getAppAuth(env);
    const second = await getAppAuth(env);

    expect(first).toBe(second);
    expect(createdPoolOptions).toHaveLength(1);
  });

  it("does not reuse the Better Auth instance in development env", async () => {
    createdPoolOptions.length = 0;
    endedPoolOptions.length = 0;
    poolErrorHandlers.length = 0;

    const env = {
      APP_API_ENVIRONMENT: "development" as const,
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

    const first = await getAppAuth(env);
    const second = await getAppAuth(env);

    expect(first).not.toBe(second);
    expect(createdPoolOptions).toHaveLength(2);
  });

  it("does not reuse the Better Auth instance in staging env", async () => {
    createdPoolOptions.length = 0;
    endedPoolOptions.length = 0;
    poolErrorHandlers.length = 0;

    const env = {
      APP_API_ENVIRONMENT: "staging" as never,
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

    const first = await getAppAuth(env);
    const second = await getAppAuth(env);

    expect(first).not.toBe(second);
    expect(createdPoolOptions).toHaveLength(2);
  });

  it("keeps runtime readiness probes isolated from the cached runtime pool", async () => {
    createdPoolOptions.length = 0;
    endedPoolOptions.length = 0;
    poolErrorHandlers.length = 0;

    const env = {
      APP_API_ENVIRONMENT: "test" as const,
      APP_API_DB: {
        connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
      },
    };

    const runtimePool = await createRuntimePool(env);
    await probeRuntimeDatabase(env);
    const sameRuntimePool = await createRuntimePool(env);

    expect(runtimePool).toBeDefined();
    expect(sameRuntimePool).toBe(runtimePool);
    expect(createdPoolOptions).toHaveLength(2);
    expect(endedPoolOptions).toHaveLength(1);
    expect(createdPoolOptions[0]).toMatchObject({
      connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
    });
    expect(createdPoolOptions[1]).toMatchObject({
      connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
    });
  });

  it("keeps auth readiness probes isolated from the cached Better Auth runtime", async () => {
    createdPoolOptions.length = 0;
    endedPoolOptions.length = 0;
    poolErrorHandlers.length = 0;

    const env = {
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

    await probeAppAuthRuntime(env);
    const auth = await getAppAuth(env);

    expect(auth).toBeDefined();
    expect(createdPoolOptions).toHaveLength(2);
    expect(endedPoolOptions).toHaveLength(1);
    expect(createdPoolOptions[0]).toMatchObject({
      connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
    });
    expect(createdPoolOptions[1]).toMatchObject({
      connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
    });
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
      password: {
        hash: hashAppPassword,
        verify: verifyAppPassword,
      },
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

  it("hashes and verifies passwords with the app-owned PBKDF2 contract", async () => {
    const hash = await hashAppPassword("StagingPass!2026");

    expect(hash).toMatch(/^pbkdf2_sha256\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    await expect(
      verifyAppPassword({
        hash,
        password: "StagingPass!2026",
      }),
    ).resolves.toBe(true);
    await expect(
      verifyAppPassword({
        hash,
        password: "WrongPass!2026",
      }),
    ).resolves.toBe(false);
  });

  it("treats hashes above the deployed worker PBKDF2 ceiling as invalid input", async () => {
    const hash = await hashAppPassword("StagingPass!2026");
    const [version, , salt, key] = hash.split("$");

    await expect(
      verifyAppPassword({
        hash: `${version}$210000$${salt}$${key}`,
        password: "StagingPass!2026",
      }),
    ).resolves.toBe(false);
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
    expect(authHandler).toHaveBeenCalledWith(
      expect.any(Request),
      env,
      expect.objectContaining({
        getAppAuth: expect.any(Function),
      }),
    );
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
