import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const POSTGRES_PREFIX = /^(postgres|postgresql):\/\//i;
export const PUBLIC_CHAT_AUTH_SCHEMA = "app_auth";
export const PUBLIC_CHAT_CHAT_SCHEMA = "chat";
export const PUBLIC_CHAT_INGESTION_REGISTRY_SCHEMA = "ingestion_registry";
const scriptsRoot = fileURLToPath(new URL("..", import.meta.url));
const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationsRoot = join(appRoot, "db", "migrations");

function readRequiredEnv(key, env = process.env) {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required for public-consumer-chat database bootstrap.`);
  }
  return value;
}

function assertIdentifier(label, value) {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a lowercase PostgreSQL identifier.`);
  }
  return value;
}

function assertRepoOwnedAuthSchema(value) {
  const schemaName = assertIdentifier("auth schema", value);
  if (schemaName === "auth") {
    throw new Error(
      "PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA=auth is not allowed. Use app_auth; Supabase auth.* remains platform-managed.",
    );
  }
  return schemaName;
}

function resolveSsl(databaseSslMode) {
  return databaseSslMode === "disable"
    ? false
    : {
        rejectUnauthorized: false,
      };
}

export function readBootstrapEnv(env = process.env) {
  const databaseUrl = readRequiredEnv(
    env.PUBLIC_CHAT_TEST_DATABASE_URL
      ? "PUBLIC_CHAT_TEST_DATABASE_URL"
      : "PUBLIC_CONSUMER_CHAT_DATABASE_URL",
    env,
  );

  if (!POSTGRES_PREFIX.test(databaseUrl)) {
    throw new Error("Bootstrap requires a PostgreSQL connection string.");
  }

  return {
    appBaseUrl:
      env.PUBLIC_CONSUMER_CHAT_APP_BASE_URL?.trim() || "http://127.0.0.1:3000",
    authSchema: assertRepoOwnedAuthSchema(
      env.PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA?.trim() || PUBLIC_CHAT_AUTH_SCHEMA,
    ),
    chatSchema: assertIdentifier(
      "chat schema",
      env.PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA?.trim() || PUBLIC_CHAT_CHAT_SCHEMA,
    ),
    databaseSslMode:
      env.PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE?.trim() || "require",
    databaseUrl,
    betterAuthSecret: readRequiredEnv("BETTER_AUTH_SECRET", env),
    ingestionRegistrySchema: assertIdentifier(
      "ingestion registry schema",
      env.PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA?.trim() ||
        PUBLIC_CHAT_INGESTION_REGISTRY_SCHEMA,
    ),
  };
}

export function buildSearchPathConnectionString(databaseUrl, schemaNames) {
  const nextUrl = new URL(databaseUrl);
  const searchPath = schemaNames
    .map((schemaName) => assertIdentifier("schema", schemaName))
    .join(",");
  const currentOptions = nextUrl.searchParams.get("options");
  const searchPathOption = `-c search_path=${searchPath}`;

  nextUrl.searchParams.set(
    "options",
    currentOptions ? `${currentOptions} ${searchPathOption}` : searchPathOption,
  );

  return nextUrl.toString();
}

function createPool(env) {
  return new Pool({
    connectionString: env.databaseUrl,
    ssl: resolveSsl(env.databaseSslMode),
  });
}

function createBetterAuthPool(env) {
  return new Pool({
    connectionString: buildSearchPathConnectionString(env.databaseUrl, [
      env.authSchema,
      "public",
    ]),
    ssl: resolveSsl(env.databaseSslMode),
  });
}

function buildSchemaSql(env) {
  return [
    env.authSchema,
    env.chatSchema,
    env.ingestionRegistrySchema,
  ]
    .map(
      (schemaName) =>
        `CREATE SCHEMA IF NOT EXISTS "${assertIdentifier("schema", schemaName)}";`,
    )
    .join("\n");
}

function buildBetterAuthOptions(env, pool) {
  return {
    appName: "Campus Agent",
    basePath: "/api/auth",
    baseURL: env.appBaseUrl,
    secret: env.betterAuthSecret,
    trustedOrigins: [env.appBaseUrl],
    emailAndPassword: {
      enabled: true,
    },
    session: {
      storeSessionInDatabase: true,
    },
    database: pool,
  };
}

export async function compileBetterAuthMigrationSql(env) {
  const pool = createBetterAuthPool(env);

  try {
    const migrations = await getMigrations(buildBetterAuthOptions(env, pool));
    return migrations.compileMigrations();
  } finally {
    await pool.end();
  }
}

export async function runBetterAuthMigrations(env) {
  const pool = createBetterAuthPool(env);

  try {
    const migrations = await getMigrations(buildBetterAuthOptions(env, pool));
    await migrations.runMigrations();
  } finally {
    await pool.end();
  }
}

export async function listChatMigrationFiles() {
  const entries = await readdir(migrationsRoot, {
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => join(migrationsRoot, entry.name))
    .sort();
}

export async function runChatMigrations(pool) {
  const migrationFiles = await listChatMigrationFiles();

  for (const migrationFile of migrationFiles) {
    const sql = await readFile(migrationFile, "utf8");
    await pool.query(sql);
  }

  return migrationFiles;
}

export async function bootstrapDatabase(envOverrides = process.env) {
  const env = readBootstrapEnv(envOverrides);
  const pool = createPool(env);

  try {
    await pool.query(buildSchemaSql(env));
    await runBetterAuthMigrations(env);
    const migrationFiles = await runChatMigrations(pool);
    return {
      authSchema: env.authSchema,
      chatSchema: env.chatSchema,
      migrationFiles,
    };
  } finally {
    await pool.end();
  }
}

export { scriptsRoot };
