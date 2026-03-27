// @vitest-environment node

import { describe, expect, it } from "vitest";

import { readPublicChatServerEnv } from "../app/lib/env.server";

describe("public chat env contract", () => {
  it("defaults auth/chat/ingestion schemas for the Supabase Postgres boundary", () => {
    const env = readPublicChatServerEnv({
      PUBLIC_CHAT_MODE: "mock",
      PUBLIC_CONSUMER_CHAT_APP_BASE_URL: "http://127.0.0.1:3000",
      PUBLIC_CONSUMER_CHAT_DATABASE_URL: "postgres://postgres:secret@example.com:5432/postgres",
      BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
    } as NodeJS.ProcessEnv);

    expect(env.authSchema).toBe("auth");
    expect(env.chatSchema).toBe("chat");
    expect(env.ingestionRegistrySchema).toBe("ingestion_registry");
  });

  it("rejects sqlite style database urls", () => {
    expect(() =>
      readPublicChatServerEnv({
        PUBLIC_CHAT_MODE: "mock",
        PUBLIC_CONSUMER_CHAT_APP_BASE_URL: "http://127.0.0.1:3000",
        PUBLIC_CONSUMER_CHAT_DATABASE_URL: "file:/tmp/public-consumer-chat.sqlite",
        BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
      } as NodeJS.ProcessEnv),
    ).toThrow("Supabase Postgres");
  });

  it("rejects weak Better Auth secrets outside localhost-style development", () => {
    expect(() =>
      readPublicChatServerEnv({
        NODE_ENV: "production",
        PUBLIC_CHAT_MODE: "live",
        PUBLIC_CONSUMER_CHAT_APP_BASE_URL: "https://chat.example.com",
        PUBLIC_CONSUMER_CHAT_DATABASE_URL: "postgres://postgres:secret@example.com:5432/postgres",
        BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
      } as NodeJS.ProcessEnv),
    ).toThrow("BETTER_AUTH_SECRET");
  });

  it("allows local development secrets on localhost app origins", () => {
    const env = readPublicChatServerEnv({
      NODE_ENV: "development",
      PUBLIC_CHAT_MODE: "mock",
      PUBLIC_CONSUMER_CHAT_APP_BASE_URL: "http://127.0.0.1:3000",
      PUBLIC_CONSUMER_CHAT_DATABASE_URL: "postgres://postgres:secret@example.com:5432/postgres",
      BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
    } as NodeJS.ProcessEnv);

    expect(env.betterAuthSecret).toBe("dev-secret-dev-secret-dev-secret");
  });
});
