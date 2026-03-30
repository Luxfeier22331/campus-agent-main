// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import { bootstrapDatabase } from "../scripts/lib/database-bootstrap.mjs";

const RUN_INTEGRATION =
  process.env.RUN_PUBLIC_CHAT_SHARED_DB_BOOTSTRAP_INTEGRATION === "1";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFilePath = resolve(appRoot, ".env");

function loadOptionalEnvFile(filePath: string): void {
  try {
    process.loadEnvFile(filePath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function readRequiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required for the public-consumer-chat shared DB bootstrap test.`);
  }
  return value;
}

describe.skipIf(!RUN_INTEGRATION)("public-consumer-chat shared DB bootstrap", () => {
  let client: Client;

  beforeAll(async () => {
    loadOptionalEnvFile(envFilePath);

    process.env.PUBLIC_CONSUMER_CHAT_APP_BASE_URL =
      process.env.PUBLIC_CONSUMER_CHAT_APP_BASE_URL?.trim() || "http://127.0.0.1:3000";
    process.env.PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE =
      process.env.PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE?.trim() || "require";
    process.env.PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA = "app_auth";
    process.env.PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA =
      process.env.PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA?.trim() || "chat";
    process.env.PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA =
      process.env.PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA?.trim() || "ingestion_registry";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET?.trim() || "dev-secret-dev-secret-dev-secret";

    client = new Client({
      connectionString:
        process.env.PUBLIC_CHAT_TEST_DATABASE_URL?.trim() ||
        readRequiredEnv("PUBLIC_CONSUMER_CHAT_DATABASE_URL"),
      ssl:
        process.env.PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE?.trim() === "disable"
          ? false
          : { rejectUnauthorized: false },
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it(
    "bootstraps app_auth/chat schemas on the shared database without touching Supabase auth.*",
    async () => {
      const result = await bootstrapDatabase(process.env);

      expect(result.authSchema).toBe("app_auth");
      expect(result.chatSchema).toBe("chat");

      const relations = [
        "app_auth.user",
        "app_auth.session",
        "app_auth.account",
        "app_auth.verification",
        "chat.conversations",
        "chat.messages",
      ];

      for (const relation of relations) {
        const queryResult = await client.query(
          "select to_regclass($1) as relation_name",
          [relation],
        );
        expect(queryResult.rows[0]?.relation_name).toBe(relation);
      }

      const supabaseAuthResult = await client.query(
        "select exists(select 1 from information_schema.schemata where schema_name = 'auth') as present",
      );
      expect(supabaseAuthResult.rows[0]?.present).toBe(true);
    },
    30_000,
  );
});
