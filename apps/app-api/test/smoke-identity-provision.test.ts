// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  buildSmokeIdentityProvisionRuntimeEnv,
  provisionSmokeIdentity,
  readSmokeIdentityProvisionInput,
} from "../scripts/provision-smoke-identity-lib.mjs";

describe("app-api smoke identity provisioning", () => {
  it("requires an already-admitted email and a password env var", () => {
    expect(() =>
      readSmokeIdentityProvisionInput(
        ["--email", "not-allowed@example.com", "--name", "Smoke User"],
        {
          APP_API_END_USER_EMAIL_ALLOWLIST: "help_bot@outlook.com",
          APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
        } as NodeJS.ProcessEnv,
      ),
    ).toThrow("is not admitted by the configured end-user auth allowlist");

    expect(() =>
      readSmokeIdentityProvisionInput(
        ["--email", "help_bot@outlook.com", "--name", "Smoke User"],
        {
          APP_API_END_USER_EMAIL_ALLOWLIST: "help_bot@outlook.com",
          APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
          APP_API_OPERATOR_DATABASE_URL: "postgresql://db.example/campus_agent",
        } as NodeJS.ProcessEnv,
      ),
    ).toThrow("APP_API_SMOKE_IDENTITY_PASSWORD is required");
  });

  it("builds a minimal app runtime env for canonical auth-route provisioning", () => {
    const input = readSmokeIdentityProvisionInput(
      ["--email", "help_bot@outlook.com", "--name", "Smoke User"],
      {
        APP_API_END_USER_EMAIL_ALLOWLIST: "help_bot@outlook.com",
        APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
        APP_API_OPERATOR_DATABASE_URL: "postgresql://db.example/campus_agent",
        APP_API_SMOKE_IDENTITY_PASSWORD: "SmokePass!2026",
        PUBLIC_CHAT_WEB_ORIGIN: "https://campus-chat-staging.ayafeed.com",
      } as NodeJS.ProcessEnv,
    );

    expect(buildSmokeIdentityProvisionRuntimeEnv(input)).toMatchObject({
      APP_API_DB: {
        connectionString: "postgresql://db.example/campus_agent",
      },
      APP_API_END_USER_EMAIL_ALLOWLIST: "help_bot@outlook.com",
      APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
      APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
      PUBLIC_CHAT_WEB_ORIGIN: "https://campus-chat-staging.ayafeed.com",
    });
  });

  it("recreates the smoke identity through the real auth sign-up route after deleting prior rows", async () => {
    const executeSql = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    const appFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: "user_123",
            email: "help_bot@outlook.com",
          },
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      ),
    );

    const summary = await provisionSmokeIdentity(
      {
        databaseSslMode: "require",
        email: "help_bot@outlook.com",
        managementDatabaseUrl: "postgresql://db.example/campus_agent",
        name: "Help Bot",
        password: "SmokePass!2026",
        publicChatOrigin: "https://campus-chat-staging.ayafeed.com",
        runtimeEnv: buildSmokeIdentityProvisionRuntimeEnv(
          readSmokeIdentityProvisionInput(
            ["--email", "help_bot@outlook.com", "--name", "Help Bot"],
            {
              APP_API_END_USER_EMAIL_ALLOWLIST: "help_bot@outlook.com",
              APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
              APP_API_OPERATOR_DATABASE_URL: "postgresql://db.example/campus_agent",
              APP_API_SMOKE_IDENTITY_PASSWORD: "SmokePass!2026",
              PUBLIC_CHAT_WEB_ORIGIN: "https://campus-chat-staging.ayafeed.com",
            } as NodeJS.ProcessEnv,
          ),
        ),
      },
      {
        appFetch,
        executeSql,
      },
    );

    expect(executeSql).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('delete from "chat"."conversations"'),
      ["help_bot@outlook.com"],
    );
    expect(executeSql).toHaveBeenNthCalledWith(
      2,
      'delete from "app_auth"."user" where "email" = $1',
      ["help_bot@outlook.com"],
    );
    expect(appFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "https://app-api.internal/api/auth/sign-up/email",
      }),
    );
    expect(executeSql).toHaveBeenNthCalledWith(
      3,
      'delete from "app_auth"."session" where "userId" = $1',
      ["user_123"],
    );
    expect(summary).toEqual({
      clearedConversationCount: 2,
      clearedSessionCount: 1,
      deletedUserCount: 1,
      email: "help_bot@outlook.com",
      userId: "user_123",
    });
  });
});
