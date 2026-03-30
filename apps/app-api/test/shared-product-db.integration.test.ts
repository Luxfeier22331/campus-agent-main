// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import { createApp } from "../src/app";
import { type Env } from "../src/config";
import { bootstrapSharedProductDatabase } from "../scripts/shared-product-database-bootstrap.mjs";

const RUN_INTEGRATION = process.env.RUN_APP_API_SHARED_DB_INTEGRATION === "1";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFilePath = resolve(appRoot, ".env");
const devVarsFilePath = resolve(appRoot, ".dev.vars");

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
    throw new Error(`${key} is required for the app-api shared product DB integration test.`);
  }
  return value;
}

function resolveSslConfig():
  | false
  | {
      rejectUnauthorized: false;
    } {
  return process.env.APP_API_DATABASE_SSLMODE?.trim() === "disable"
    ? false
    : { rejectUnauthorized: false };
}

async function readJson(response: Response) {
  return response.json();
}

function buildCookieHeader(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Expected auth response to include a session cookie.");
  }

  return setCookie
    .split(",")
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

describe.skipIf(!RUN_INTEGRATION)("app-api shared product DB integration", () => {
  let app: ReturnType<typeof createApp>;
  let client: Client;
  let createdEmail: string | null = null;

  beforeAll(async () => {
    loadOptionalEnvFile(envFilePath);
    loadOptionalEnvFile(devVarsFilePath);

    const runtimeConnectionString = readRequiredEnv(
      "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB",
    );
    const managementConnectionString =
      process.env.APP_API_MANAGEMENT_DATABASE_URL?.trim() || runtimeConnectionString;

    await bootstrapSharedProductDatabase({
      APP_API_DATABASE_SSLMODE: process.env.APP_API_DATABASE_SSLMODE?.trim() || "require",
      APP_API_MANAGEMENT_DATABASE_URL: managementConnectionString,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET?.trim() || "dev-secret-dev-secret-dev-secret",
      PUBLIC_CHAT_WEB_ORIGIN:
        process.env.PUBLIC_CHAT_WEB_ORIGIN?.trim() || "https://chat.example.com",
    });

    const env: Env = {
      APP_API_NAME: process.env.APP_API_NAME?.trim() || "campus-agent-app-api",
      APP_API_ENVIRONMENT: "test",
      APP_API_DATABASE_SSLMODE:
        process.env.APP_API_DATABASE_SSLMODE?.trim() === "disable"
          ? "disable"
          : process.env.APP_API_DATABASE_SSLMODE?.trim() === "prefer"
            ? "prefer"
            : "require",
      APP_API_DB: {
        connectionString: runtimeConnectionString,
      },
      APP_API_INTERNAL_SHARED_SECRET:
        process.env.APP_API_INTERNAL_SHARED_SECRET?.trim() || "shared-db-integration-secret",
      APP_API_MANAGEMENT_DATABASE_URL: managementConnectionString,
      APP_API_OPERATOR_EMAIL_ALLOWLIST:
        process.env.APP_API_OPERATOR_EMAIL_ALLOWLIST?.trim() || "ops@example.com",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET?.trim() || "dev-secret-dev-secret-dev-secret",
      PUBLIC_CHAT_WEB_ORIGIN:
        process.env.PUBLIC_CHAT_WEB_ORIGIN?.trim() || "https://chat.example.com",
      SUPERVISOR_API_BASE_URL:
        process.env.SUPERVISOR_API_BASE_URL?.trim() || "https://supervisor.internal",
      SUPERVISOR_API_SHARED_SECRET:
        process.env.SUPERVISOR_API_SHARED_SECRET?.trim() || "shared-db-integration-secret",
    };

    app = createApp(env);
    client = new Client({
      connectionString: managementConnectionString,
      ssl: resolveSslConfig(),
    });
    await client.connect();
  });

  afterAll(async () => {
    if (createdEmail) {
      await client.query(
        `
          delete from "chat"."conversations"
          where "owner_user_id" in (
            select "id" from "app_auth"."user" where "email" = $1
          )
        `,
        [createdEmail],
      );
      await client.query(`delete from "app_auth"."user" where "email" = $1`, [createdEmail]);
    }
    await client.end();
  });

  it("bootstraps app_auth/chat tables without leaving Better Auth tables in public", async () => {
    const relations = [
      "app_auth.user",
      "app_auth.session",
      "app_auth.account",
      "app_auth.verification",
      "chat.conversations",
      "chat.messages",
    ];

    for (const relation of relations) {
      const [schemaName, tableName] = relation.split(".", 2);
      const queryResult = await client.query(
        `
          select exists(
            select 1
            from information_schema.tables
            where table_schema = $1 and table_name = $2
          ) as present
        `,
        [schemaName, tableName],
      );
      expect(queryResult.rows[0]?.present).toBe(true);
    }

    for (const relation of [
      "public.user",
      "public.session",
      "public.account",
      "public.verification",
    ]) {
      const [schemaName, tableName] = relation.split(".", 2);
      const queryResult = await client.query(
        `
          select exists(
            select 1
            from information_schema.tables
            where table_schema = $1 and table_name = $2
          ) as present
        `,
        [schemaName, tableName],
      );
      expect(queryResult.rows[0]?.present).toBe(false);
    }
  });

  it("creates and reads owned conversations through app-api after Better Auth sign-in", async () => {
    createdEmail = `integration-${Date.now()}@example.com`;

    const authResponse = await app.fetch(
      new Request("https://app-api.internal/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: process.env.PUBLIC_CHAT_WEB_ORIGIN?.trim() || "https://chat.example.com",
          referer: `${process.env.PUBLIC_CHAT_WEB_ORIGIN?.trim() || "https://chat.example.com"}/login`,
        },
        body: JSON.stringify({
          email: createdEmail,
          name: "Integration Student",
          password: "password12345",
        }),
      }),
    );

    expect(authResponse.ok).toBe(true);
    const cookieHeader = buildCookieHeader(authResponse);

    const createResponse = await app.fetch(
      new Request("https://app-api.internal/api/chat/conversations", {
        method: "POST",
        headers: {
          cookie: cookieHeader,
        },
      }),
    );
    const createPayload = (await readJson(createResponse)) as {
      conversation: { id: string };
    };

    expect(createResponse.status).toBe(201);
    expect(createPayload.conversation.id).toBeTruthy();

    const listResponse = await app.fetch(
      new Request("https://app-api.internal/api/chat/conversations", {
        headers: {
          cookie: cookieHeader,
        },
      }),
    );
    const listPayload = (await readJson(listResponse)) as {
      conversations: Array<{ id: string }>;
    };
    expect(listResponse.status).toBe(200);
    expect(listPayload.conversations.map((conversation) => conversation.id)).toContain(
      createPayload.conversation.id,
    );

    const detailResponse = await app.fetch(
      new Request(`https://app-api.internal/api/chat/conversations/${createPayload.conversation.id}`, {
        headers: {
          cookie: cookieHeader,
        },
      }),
    );
    const detailPayload = (await readJson(detailResponse)) as {
      conversation: { id: string; messages: unknown[] };
    };

    expect(detailResponse.status).toBe(200);
    expect(detailPayload.conversation.id).toBe(createPayload.conversation.id);
    expect(detailPayload.conversation.messages).toEqual([]);
  });
});
