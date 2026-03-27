// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildBetterAuthConfig } from "../app/lib/auth.server";

describe("Better Auth config", () => {
  it("freezes explicit session, password, and rate-limit policy for the app boundary", () => {
    const config = buildBetterAuthConfig({
      appBaseUrl: "https://chat.example.com",
      authSchema: "auth",
      answerBaseUrl: undefined,
      answerBearerToken: undefined,
      betterAuthSecret: "prod-secret-1234567890-prod-secret-1234567890",
      chatSchema: "chat",
      databaseSslMode: "require",
      databaseUrl: "postgresql://postgres:secret@example.com:5432/postgres",
      ingestionRegistrySchema: "ingestion_registry",
      nodeEnv: "production",
      publicChatMode: "live",
    });

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
    expect(config.advanced).toMatchObject({
      disableCSRFCheck: false,
      disableOriginCheck: false,
      useSecureCookies: true,
    });
  });
});
