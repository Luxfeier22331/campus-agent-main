// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { resolveEnvironment } from "../src/config";
import {
  createRuntimePool,
  buildOperatorDatabaseConfig,
  buildRuntimeDatabaseConfig,
  probeRuntimeDatabase,
} from "../src/db/runtime";
import {
  buildBetterAuthConfig,
  buildEndUserEmailAdmissionPolicy,
  enforceEndUserEmailAdmission,
  getAppAuth,
  hashAppPassword,
  isEndUserEmailAllowedForAuth,
  probeAppAuthRuntime,
  resolvePasswordResetRedirectTarget,
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

  it("preserves Hyperdrive sslmode hints for staging runtime bindings", () => {
    const config = buildRuntimeDatabaseConfig({
      APP_API_ENVIRONMENT: "staging",
      APP_API_DATABASE_SSLMODE: "require",
      APP_API_DB: {
        connectionString:
          "postgres://postgres:secret@example.com:5432/campus_agent?sslmode=disable",
      },
    });

    expect(config.connectionString).toBe(
      "postgres://postgres:secret@example.com:5432/campus_agent?sslmode=disable",
    );
    expect(config.ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("uses canonical operator connection for app-api schema management", () => {
    const config = buildOperatorDatabaseConfig({
      APP_API_DATABASE_SSLMODE: "require",
      APP_API_OPERATOR_DATABASE_URL:
        "postgres://postgres.project-ref:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/campus_agent_admin?sslmode=require",
    });

    expect(config.connectionString).toBe(
      "postgres://postgres.project-ref:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/campus_agent_admin",
    );
    expect(config.ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("falls back to the legacy management env key for operator config", () => {
    const config = buildOperatorDatabaseConfig({
      APP_API_DATABASE_SSLMODE: "require",
      APP_API_MANAGEMENT_DATABASE_URL:
        "postgres://postgres:secret@example.com:5432/campus_agent_admin",
    });

    expect(config.connectionString).toBe(
      "postgres://postgres:secret@example.com:5432/campus_agent_admin",
    );
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
      RESEND_API_KEY: "resend_test_key",
      AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
      PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
      SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
      SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
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
      RESEND_API_KEY: "resend_test_key",
      AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
      PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
      SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
      SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
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
      RESEND_API_KEY: "resend_test_key",
      AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
      PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
      SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
      SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
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
      RESEND_API_KEY: "resend_test_key",
      AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
      PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
      SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
      SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
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
      RESEND_API_KEY: "resend_test_key",
      AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
      PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
      SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
      SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
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
    const resendFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_01HQ" }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      }),
    );
    const config = buildBetterAuthConfig({
      appName: "campus-agent-app-api",
      betterAuthSecret: "prod-secret-prod-secret-prod-secret",
      environment: "production",
      publicChatOrigin: "https://chat.example.com",
      authResetEmailFrom: "Campus Agent <auth@example.com>",
      authResetEmailReplyTo: "support@example.com",
      resendApiKey: "resend_test_key",
      resendFetch,
      endUserEmailDomainAllowlist: ["muc.edu.cn"],
      endUserEmailAllowlist: ["help_bot@outlook.com"],
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
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
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
    expect(config.hooks?.before).toBeDefined();
    expect(config.emailAndPassword.sendResetPassword).toEqual(expect.any(Function));
    expect(config.emailAndPassword.onPasswordReset).toEqual(expect.any(Function));
  });

  it("sends password reset and password-changed mail through Resend without exposing a repo-owned parallel auth path", async () => {
    const resendFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_01HQ" }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      }),
    );
    const config = buildBetterAuthConfig({
      appName: "campus-agent-app-api",
      betterAuthSecret: "prod-secret-prod-secret-prod-secret",
      environment: "production",
      publicChatOrigin: "https://chat.example.com",
      authResetEmailFrom: "Campus Agent <auth@example.com>",
      authResetEmailReplyTo: "support@example.com",
      resendApiKey: "resend_test_key",
      resendFetch,
      endUserEmailDomainAllowlist: ["muc.edu.cn"],
      endUserEmailAllowlist: ["help_bot@outlook.com"],
      database: {} as never,
    });

    await config.emailAndPassword.sendResetPassword?.({
      token: "reset_token_01HQ",
      user: {
        email: "jane@muc.edu.cn",
        name: "Jane Doe",
      },
    });

    await config.emailAndPassword.onPasswordReset?.({
      user: {
        email: "jane@muc.edu.cn",
        name: "Jane Doe",
      },
    });

    expect(resendFetch).toHaveBeenCalledTimes(2);
    expect(resendFetch).toHaveBeenNthCalledWith(
      1,
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer resend_test_key",
        }),
        method: "POST",
      }),
    );
    const firstPayload = JSON.parse(String(resendFetch.mock.calls[0]?.[1]?.body ?? "{}")) as {
      from?: string;
      html?: string;
      reply_to?: string;
      subject?: string;
      text?: string;
      to?: string[];
    };
    expect(firstPayload).toMatchObject({
      from: "Campus Agent <auth@example.com>",
      reply_to: "support@example.com",
      subject: "Reset your Campus Agent password",
      to: ["jane@muc.edu.cn"],
    });
    expect(firstPayload.html).toContain("https://chat.example.com/api/auth/reset-password/reset_token_01HQ");
    expect(firstPayload.text).toContain("Campus Agent");

    const secondPayload = JSON.parse(String(resendFetch.mock.calls[1]?.[1]?.body ?? "{}")) as {
      subject?: string;
      to?: string[];
    };
    expect(secondPayload).toMatchObject({
      subject: "Your Campus Agent password was changed",
      to: ["jane@muc.edu.cn"],
    });
  });

  it("freezes reset redirect targets to /reset-password on the public chat origin", () => {
    expect(
      resolvePasswordResetRedirectTarget({
        publicChatOrigin: "https://chat.example.com",
        redirectTo: "/reset-password",
      }),
    ).toBe("https://chat.example.com/reset-password");

    expect(
      resolvePasswordResetRedirectTarget({
        publicChatOrigin: "https://chat.example.com",
        redirectTo: "https://chat.example.com/reset-password",
      }),
    ).toBe("https://chat.example.com/reset-password");

    expect(() =>
      resolvePasswordResetRedirectTarget({
        publicChatOrigin: "https://chat.example.com",
        redirectTo: "https://chat.example.com/chat",
      }),
    ).toThrowError(/reset-password/i);

    expect(() =>
      resolvePasswordResetRedirectTarget({
        publicChatOrigin: "https://chat.example.com",
        redirectTo: "https://evil.example.com/reset-password",
      }),
    ).toThrowError(/reset-password/i);
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

  it("admits campus-domain and explicitly allowlisted end-user emails for email/password auth", () => {
    const policy = buildEndUserEmailAdmissionPolicy({
      endUserEmailDomainAllowlist: [" muc.edu.cn ", "@students.muc.edu.cn"],
      endUserEmailAllowlist: [" Help_Bot@Outlook.com "],
    });

    expect(isEndUserEmailAllowedForAuth("student@muc.edu.cn", policy)).toBe(true);
    expect(isEndUserEmailAllowedForAuth("student@sub.muc.edu.cn", policy)).toBe(true);
    expect(isEndUserEmailAllowedForAuth("freshman@students.muc.edu.cn", policy)).toBe(true);
    expect(isEndUserEmailAllowedForAuth("help_bot@outlook.com", policy)).toBe(true);
    expect(isEndUserEmailAllowedForAuth("student@example.com", policy)).toBe(false);
    expect(isEndUserEmailAllowedForAuth("student@badmuc.edu.cn", policy)).toBe(false);
  });

  it("rejects non-campus emails on email/password auth routes, including password reset requests", () => {
    const policy = buildEndUserEmailAdmissionPolicy({
      endUserEmailDomainAllowlist: ["muc.edu.cn"],
      endUserEmailAllowlist: ["help_bot@outlook.com"],
    });

    expect(() =>
      enforceEndUserEmailAdmission({
        email: "outsider@example.com",
        path: "/sign-up/email",
        policy,
      }),
    ).toThrowError(/not allowed/i);
    expect(() =>
      enforceEndUserEmailAdmission({
        email: "outsider@example.com",
        path: "/sign-in/email",
        policy,
      }),
    ).toThrowError(/not allowed/i);
    expect(() =>
      enforceEndUserEmailAdmission({
        email: "outsider@example.com",
        path: "/request-password-reset",
        policy,
      }),
    ).toThrowError(/not allowed/i);
  });

  it("does not apply end-user email admission checks to unrelated auth routes", () => {
    const policy = buildEndUserEmailAdmissionPolicy({
      endUserEmailDomainAllowlist: ["muc.edu.cn"],
      endUserEmailAllowlist: [],
    });

    expect(() =>
      enforceEndUserEmailAdmission({
        email: "outsider@example.com",
        path: "/get-session",
        policy,
      }),
    ).not.toThrow();
  });
});

describe("/api/me", () => {
  const env = {
    APP_API_NAME: "campus-agent-app-api",
    APP_API_ENVIRONMENT: "test" as const,
    BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
    RESEND_API_KEY: "resend_test_key",
    AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
    PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
    SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
    SUPERVISOR_API_SHARED_SECRET: "shared-secret",
    APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
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

  it("returns the current campus member principal and session", async () => {
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue({
        permissions: {
          chat: true,
          operator: false,
        },
        principal: {
          displayName: "Jane Doe",
          email: "jane@muc.edu.cn",
          principalId: "user_01HQ",
          type: "campus_member",
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
        email: "jane@muc.edu.cn",
        principalId: "user_01HQ",
        type: "campus_member",
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
