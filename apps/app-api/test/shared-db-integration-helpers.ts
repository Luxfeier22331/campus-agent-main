// @vitest-environment node

import process from "node:process";

import type { Env } from "../src/config";
import { runSharedDatabaseAdoption } from "../scripts/adopt-shared-database.mjs";
import { runSharedDatabaseDriftReconcile } from "../scripts/reconcile-shared-db-drift.mjs";
import { bootstrapSharedProductDatabase } from "../scripts/shared-product-database-bootstrap.mjs";

export function loadOptionalEnvFile(filePath: string): void {
  try {
    process.loadEnvFile(filePath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

export function readRequiredSharedDbEnv(key: string, contextLabel: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required for ${contextLabel}.`);
  }
  return value;
}

export function resolveSharedDbSslConfig():
  | false
  | {
      rejectUnauthorized: false;
    } {
  return process.env.APP_API_DATABASE_SSLMODE?.trim() === "disable"
    ? false
    : { rejectUnauthorized: false };
}

function resolveDatabaseSslMode(): NonNullable<Env["APP_API_DATABASE_SSLMODE"]> {
  return process.env.APP_API_DATABASE_SSLMODE?.trim() === "disable"
    ? "disable"
    : process.env.APP_API_DATABASE_SSLMODE?.trim() === "prefer"
      ? "prefer"
      : "require";
}

export async function convergeSharedDbForAppApiIntegration(input: {
  contextLabel: string;
  devVarsFilePath: string;
  envFilePath: string;
}): Promise<{
  managementConnectionString: string;
  runtimeConnectionString: string;
}> {
  loadOptionalEnvFile(input.envFilePath);
  loadOptionalEnvFile(input.devVarsFilePath);

  const runtimeConnectionString = readRequiredSharedDbEnv(
    "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB",
    input.contextLabel,
  );
  const managementConnectionString =
    process.env.APP_API_MANAGEMENT_DATABASE_URL?.trim() || runtimeConnectionString;

  await bootstrapSharedProductDatabase({
    APP_API_DATABASE_SSLMODE: resolveDatabaseSslMode(),
    APP_API_MANAGEMENT_DATABASE_URL: managementConnectionString,
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET?.trim() || "dev-secret-dev-secret-dev-secret",
    PUBLIC_CHAT_WEB_ORIGIN:
      process.env.PUBLIC_CHAT_WEB_ORIGIN?.trim() || "https://chat.example.com",
  });
  await runSharedDatabaseDriftReconcile({
    allowNonEmptyDriftTables: true,
    apply: true,
    env: {
      ...process.env,
      APP_API_MANAGEMENT_DATABASE_URL: managementConnectionString,
    },
  });
  await runSharedDatabaseAdoption({
    apply: true,
    env: {
      ...process.env,
      APP_API_MANAGEMENT_DATABASE_URL: managementConnectionString,
    },
  });

  return {
    managementConnectionString,
    runtimeConnectionString,
  };
}

export function buildSharedDbIntegrationEnv(input: {
  managementConnectionString: string;
  runtimeConnectionString: string;
  overrides?: Partial<Env>;
}): Env {
  const baseEnv: Env = {
    APP_API_NAME: process.env.APP_API_NAME?.trim() || "campus-agent-app-api",
    APP_API_ENVIRONMENT: "test",
    APP_API_DATABASE_SSLMODE: resolveDatabaseSslMode(),
    APP_API_DB: {
      connectionString: input.runtimeConnectionString,
    },
    AUTH_RESET_EMAIL_FROM:
      process.env.AUTH_RESET_EMAIL_FROM?.trim() || "Campus Agent <auth@example.com>",
    APP_API_INTERNAL_SHARED_SECRET:
      process.env.APP_API_INTERNAL_SHARED_SECRET?.trim() || "shared-db-integration-secret",
    APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST:
      process.env.APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST?.trim() || "muc.edu.cn",
    APP_API_MANAGEMENT_DATABASE_URL: input.managementConnectionString,
    APP_API_OPERATOR_EMAIL_ALLOWLIST:
      process.env.APP_API_OPERATOR_EMAIL_ALLOWLIST?.trim() || "ops@example.com",
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET?.trim() || "dev-secret-dev-secret-dev-secret",
    PUBLIC_CHAT_WEB_ORIGIN:
      process.env.PUBLIC_CHAT_WEB_ORIGIN?.trim() || "https://chat.example.com",
    RESEND_API_KEY:
      process.env.RESEND_API_KEY?.trim() || "shared-db-integration-resend-key",
    SUPERVISOR_API_BASE_URL:
      process.env.SUPERVISOR_API_BASE_URL?.trim() || "https://supervisor.internal",
    SUPERVISOR_API_SHARED_SECRET:
      process.env.SUPERVISOR_API_SHARED_SECRET?.trim() || "shared-db-integration-secret",
  };

  return {
    ...baseEnv,
    ...input.overrides,
  };
}
