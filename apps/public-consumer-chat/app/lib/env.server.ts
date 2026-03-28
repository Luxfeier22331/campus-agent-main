type RuntimeMode = "mock" | "live";
type DatabaseSslMode = "disable" | "prefer" | "require";
type RuntimeEnvironment = "development" | "test" | "production";

export type PublicAnswerScope = {
  corpus: string;
  collection: string;
};

export type PublicChatServerEnv = {
  publicChatMode: RuntimeMode;
  nodeEnv: RuntimeEnvironment;
  appBaseUrl: string;
  databaseUrl: string;
  databaseSslMode: DatabaseSslMode;
  betterAuthSecret: string;
  authSchema: string;
  chatSchema: string;
  ingestionRegistrySchema: string;
  answerBaseUrl?: string;
  answerBearerToken?: string;
  answerScope?: PublicAnswerScope;
};

const POSTGRES_PREFIX = /^(postgres|postgresql):\/\//i;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const LOCAL_DEV_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);
const DEV_SECRET_PREFIX = "dev-secret";

const readRequired = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required for the public-consumer-chat app boundary.`);
  }
  return value;
};

const readRuntimeEnvironment = (env: NodeJS.ProcessEnv): RuntimeEnvironment => {
  const value = (env.NODE_ENV ?? "development").trim();
  if (value === "production" || value === "test" || value === "development") {
    return value;
  }
  return "development";
};

const readAppBaseUrl = (env: NodeJS.ProcessEnv): string => {
  const value = readRequired(env, "PUBLIC_CONSUMER_CHAT_APP_BASE_URL");
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error("PUBLIC_CONSUMER_CHAT_APP_BASE_URL must be a valid absolute URL.");
  }
};

const readSchema = (env: NodeJS.ProcessEnv, key: string, fallback: string): string => {
  const value = (env[key] ?? fallback).trim();
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${key} must be a lowercase PostgreSQL schema identifier.`);
  }
  return value;
};

const readScopeCorpus = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("PUBLIC_CONSUMER_CHAT_SCOPE_CORPUS must not be blank.");
  }
  return normalized;
};

const readAnswerScope = (env: NodeJS.ProcessEnv): PublicAnswerScope | undefined => {
  const corpus = env.PUBLIC_CONSUMER_CHAT_SCOPE_CORPUS?.trim();
  const collection = env.PUBLIC_CONSUMER_CHAT_SCOPE_COLLECTION?.trim();
  if (!corpus && !collection) {
    return undefined;
  }
  if (!corpus || !collection) {
    throw new Error(
      "PUBLIC_CONSUMER_CHAT_SCOPE_CORPUS and PUBLIC_CONSUMER_CHAT_SCOPE_COLLECTION must be configured together.",
    );
  }
  return {
    corpus: readScopeCorpus(corpus),
    collection,
  };
};

const ensurePostgresUrl = (databaseUrl: string): string => {
  if (!POSTGRES_PREFIX.test(databaseUrl)) {
    throw new Error(
      "PUBLIC_CONSUMER_CHAT_DATABASE_URL must point at Supabase Postgres. SQLite and D1 are not accepted app truths.",
    );
  }
  return databaseUrl;
};

const readSslMode = (env: NodeJS.ProcessEnv): DatabaseSslMode => {
  const value = (env.PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE ?? "require").trim();
  if (value === "disable" || value === "prefer" || value === "require") {
    return value;
  }
  throw new Error(
    "PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE must be one of disable, prefer, or require.",
  );
};

const isLocalDevelopmentOrigin = (appBaseUrl: string): boolean => {
  const { hostname } = new URL(appBaseUrl);
  return LOCAL_DEV_HOSTNAMES.has(hostname);
};

const hasStrongBetterAuthSecret = (value: string): boolean =>
  value.length >= 32 && !value.startsWith(DEV_SECRET_PREFIX);

const assertBetterAuthSecret = (
  betterAuthSecret: string,
  input: {
    appBaseUrl: string;
    nodeEnv: RuntimeEnvironment;
  },
): string => {
  const canUseDevSecret =
    input.nodeEnv !== "production" && isLocalDevelopmentOrigin(input.appBaseUrl);

  if (canUseDevSecret) {
    return betterAuthSecret;
  }

  if (!hasStrongBetterAuthSecret(betterAuthSecret)) {
    throw new Error(
      "BETTER_AUTH_SECRET must be at least 32 characters with high entropy outside localhost-style development.",
    );
  }

  return betterAuthSecret;
};

export function readPublicChatServerEnv(
  env: NodeJS.ProcessEnv = process.env,
): PublicChatServerEnv {
  const nodeEnv = readRuntimeEnvironment(env);
  const appBaseUrl = readAppBaseUrl(env);
  const answerScope = readAnswerScope(env);

  return {
    nodeEnv,
    publicChatMode: env.PUBLIC_CHAT_MODE === "live" ? "live" : "mock",
    appBaseUrl,
    databaseUrl: ensurePostgresUrl(readRequired(env, "PUBLIC_CONSUMER_CHAT_DATABASE_URL")),
    databaseSslMode: readSslMode(env),
    betterAuthSecret: assertBetterAuthSecret(readRequired(env, "BETTER_AUTH_SECRET"), {
      appBaseUrl,
      nodeEnv,
    }),
    authSchema: readSchema(env, "PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA", "auth"),
    chatSchema: readSchema(env, "PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA", "chat"),
    ingestionRegistrySchema: readSchema(
      env,
      "PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA",
      "ingestion_registry",
    ),
    answerBaseUrl: env.SUPERVISOR_API_BASE_URL?.trim() || undefined,
    answerBearerToken: env.SUPERVISOR_API_BEARER_TOKEN?.trim() || undefined,
    answerScope,
  };
}

// Supabase Postgres remains the primary relational store for auth/chat truth.
export const PUBLIC_CHAT_ENV_DOC = {
  relationalStore: "Supabase Postgres",
  authSchema: "auth",
  chatSchema: "chat",
  ingestionRegistrySchema: "ingestion_registry",
};
