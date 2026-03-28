export type AppApiEnvironment = "development" | "test" | "production";
export type DatabaseSslMode = "disable" | "prefer" | "require";

export interface HyperdriveBindingLike {
  connectionString?: string;
}

export interface Env {
  APP_API_NAME?: string;
  APP_API_ENVIRONMENT?: AppApiEnvironment;
  BETTER_AUTH_SECRET?: string;
  PUBLIC_CHAT_WEB_ORIGIN?: string;
  SUPERVISOR_API_BASE_URL?: string;
  SUPERVISOR_API_SHARED_SECRET?: string;
  APP_API_MANAGEMENT_DATABASE_URL?: string;
  APP_API_DATABASE_SSLMODE?: DatabaseSslMode;
  APP_API_OPERATOR_EMAIL_ALLOWLIST?: string;
  APP_API_DB?: HyperdriveBindingLike;
}

export interface AppApiConfig {
  appName: string;
  environment: AppApiEnvironment;
  betterAuthSecret: string;
  publicChatOrigin?: string;
  databaseConnectionString: string;
  databaseSslMode: DatabaseSslMode;
  managementDatabaseUrl?: string;
  supervisorApiBaseUrl: string;
  supervisorApiSharedSecret: string;
  operatorEmailAllowlist: string[];
}

const DEFAULT_APP_NAME = "app-api";
const MISSING_CONFIG_KEYS = [
  "APP_API_DB.connectionString",
  "BETTER_AUTH_SECRET",
  "SUPERVISOR_API_BASE_URL",
  "SUPERVISOR_API_SHARED_SECRET",
] as const;

export function resolveAppName(env: Env): string {
  return env.APP_API_NAME?.trim() || DEFAULT_APP_NAME;
}

export function resolveEnvironment(env: Env): AppApiEnvironment {
  if (env.APP_API_ENVIRONMENT === "production") {
    return "production";
  }
  if (env.APP_API_ENVIRONMENT === "test") {
    return "test";
  }
  return "development";
}

export function resolveDatabaseSslMode(env: Pick<Env, "APP_API_DATABASE_SSLMODE">): DatabaseSslMode {
  if (env.APP_API_DATABASE_SSLMODE === "disable") {
    return "disable";
  }
  if (env.APP_API_DATABASE_SSLMODE === "prefer") {
    return "prefer";
  }
  return "require";
}

export function parseCsvList(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getMissingRuntimeConfig(env: Env): string[] {
  const missing: string[] = [];

  if (!env.APP_API_DB?.connectionString?.trim()) {
    missing.push(MISSING_CONFIG_KEYS[0]);
  }
  if (!env.BETTER_AUTH_SECRET?.trim()) {
    missing.push(MISSING_CONFIG_KEYS[1]);
  }
  if (!env.SUPERVISOR_API_BASE_URL?.trim()) {
    missing.push(MISSING_CONFIG_KEYS[2]);
  }
  if (!env.SUPERVISOR_API_SHARED_SECRET?.trim()) {
    missing.push(MISSING_CONFIG_KEYS[3]);
  }

  return missing;
}

export function readPublicChatOrigin(env: Pick<Env, "PUBLIC_CHAT_WEB_ORIGIN">): string {
  const origin = env.PUBLIC_CHAT_WEB_ORIGIN?.trim();
  if (!origin) {
    throw new Error("PUBLIC_CHAT_WEB_ORIGIN is required.");
  }

  return new URL(origin).origin;
}

export function readAppApiConfig(env: Env): AppApiConfig {
  const missing = getMissingRuntimeConfig(env);
  if (missing.length > 0) {
    throw new Error(`Missing runtime configuration: ${missing.join(", ")}`);
  }

  return {
    appName: resolveAppName(env),
    environment: resolveEnvironment(env),
    betterAuthSecret: env.BETTER_AUTH_SECRET!.trim(),
    publicChatOrigin: env.PUBLIC_CHAT_WEB_ORIGIN?.trim() || undefined,
    databaseConnectionString: env.APP_API_DB!.connectionString!.trim(),
    databaseSslMode: resolveDatabaseSslMode(env),
    managementDatabaseUrl: env.APP_API_MANAGEMENT_DATABASE_URL?.trim() || undefined,
    supervisorApiBaseUrl: env.SUPERVISOR_API_BASE_URL!.trim(),
    supervisorApiSharedSecret: env.SUPERVISOR_API_SHARED_SECRET!.trim(),
    operatorEmailAllowlist: parseCsvList(env.APP_API_OPERATOR_EMAIL_ALLOWLIST).map((item) =>
      item.toLowerCase(),
    ),
  };
}
