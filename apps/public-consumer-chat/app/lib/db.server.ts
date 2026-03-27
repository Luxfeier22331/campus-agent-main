import { Pool } from "pg";

import type { PublicChatServerEnv } from "./env.server";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const poolCache = globalThis as typeof globalThis & {
  __publicChatPoolCache?: Map<string, Pool>;
  __publicChatDatabaseReadyCache?: Map<string, Promise<void>>;
};
const DEVELOPMENT_POOL_MAX = 1;
const PRODUCTION_POOL_MAX = 4;
const DEVELOPMENT_IDLE_TIMEOUT_MS = 5_000;
const PRODUCTION_IDLE_TIMEOUT_MS = 30_000;

export function assertPgIdentifier(label: string, value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a lowercase PostgreSQL identifier.`);
  }
  return value;
}

export function qualifyTable(schemaName: string, tableName: string): string {
  return `"${assertPgIdentifier("schema", schemaName)}"."${assertPgIdentifier("table", tableName)}"`;
}

export function buildPostgresSearchPathConnectionString(
  databaseUrl: string,
  schemaNames: string[],
): string {
  const normalizedSchemaNames = schemaNames.map((schemaName) =>
    assertPgIdentifier("schema", schemaName),
  );
  const nextUrl = new URL(databaseUrl);
  const searchPath = normalizedSchemaNames.join(",");
  const currentOptions = nextUrl.searchParams.get("options");
  const searchPathOption = `-c search_path=${searchPath}`;

  nextUrl.searchParams.set(
    "options",
    currentOptions ? `${currentOptions} ${searchPathOption}` : searchPathOption,
  );

  return nextUrl.toString();
}

function resolveSslConfig(
  databaseSslMode: PublicChatServerEnv["databaseSslMode"],
): false | { rejectUnauthorized: false } {
  return databaseSslMode === "disable"
    ? false
    : {
        rejectUnauthorized: false,
      };
}

function getPoolCache(): Map<string, Pool> {
  if (!poolCache.__publicChatPoolCache) {
    poolCache.__publicChatPoolCache = new Map<string, Pool>();
  }
  return poolCache.__publicChatPoolCache;
}

function getDatabaseReadyCache(): Map<string, Promise<void>> {
  if (!poolCache.__publicChatDatabaseReadyCache) {
    poolCache.__publicChatDatabaseReadyCache = new Map<string, Promise<void>>();
  }
  return poolCache.__publicChatDatabaseReadyCache;
}

export function buildPoolConfig(input: {
  connectionString: string;
  databaseSslMode: PublicChatServerEnv["databaseSslMode"];
  nodeEnv: PublicChatServerEnv["nodeEnv"];
}) {
  const isProduction = input.nodeEnv === "production";

  return {
    allowExitOnIdle: !isProduction,
    connectionString: input.connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: isProduction
      ? PRODUCTION_IDLE_TIMEOUT_MS
      : DEVELOPMENT_IDLE_TIMEOUT_MS,
    max: isProduction ? PRODUCTION_POOL_MAX : DEVELOPMENT_POOL_MAX,
    ssl: resolveSslConfig(input.databaseSslMode),
  };
}

function createCachedPool(input: {
  cacheKey: string;
  connectionString: string;
  databaseSslMode: PublicChatServerEnv["databaseSslMode"];
  nodeEnv: PublicChatServerEnv["nodeEnv"];
}): Pool {
  const cache = getPoolCache();
  const cachedPool = cache.get(input.cacheKey);
  if (cachedPool) {
    return cachedPool;
  }

  const pool = new Pool(
    buildPoolConfig({
      connectionString: input.connectionString,
      databaseSslMode: input.databaseSslMode,
      nodeEnv: input.nodeEnv,
    }),
  );

  cache.set(input.cacheKey, pool);
  return pool;
}

export function createSupabasePool(env: PublicChatServerEnv): Pool {
  return createCachedPool({
    cacheKey: `app:${env.databaseUrl}|${env.databaseSslMode}`,
    connectionString: env.databaseUrl,
    databaseSslMode: env.databaseSslMode,
    nodeEnv: env.nodeEnv,
  });
}

export function createBetterAuthPool(
  env: Pick<
    PublicChatServerEnv,
    "authSchema" | "databaseUrl" | "databaseSslMode" | "nodeEnv"
  >,
): Pool {
  return createCachedPool({
    cacheKey: `auth:${env.databaseUrl}|${env.databaseSslMode}|${env.authSchema}`,
    connectionString: buildPostgresSearchPathConnectionString(env.databaseUrl, [
      env.authSchema,
      "public",
    ]),
    databaseSslMode: env.databaseSslMode,
    nodeEnv: env.nodeEnv,
  });
}

export function buildChatBootstrapSql(schemaName: string): string {
  const conversations = qualifyTable(schemaName, "conversations");
  const messages = qualifyTable(schemaName, "messages");

  return `
CREATE SCHEMA IF NOT EXISTS "${assertPgIdentifier("schema", schemaName)}";

CREATE TABLE IF NOT EXISTS ${conversations} (
  id text PRIMARY KEY,
  owner_user_id text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ${messages} (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES ${conversations}(id) ON DELETE CASCADE,
  role text NOT NULL,
  kind text NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL,
  request_id text NULL,
  retryable boolean NULL
);

ALTER TABLE ${messages}
ADD COLUMN IF NOT EXISTS retryable boolean NULL;
`;
}

export function buildSchemaBootstrapSql(schemaNames: string[]): string {
  const statements = schemaNames.map(
    (schemaName) =>
      `CREATE SCHEMA IF NOT EXISTS "${assertPgIdentifier("schema", schemaName)}";`,
  );

  return `${statements.join("\n")}\n`;
}

export async function ensurePublicChatSchemas(
  pool: Pool,
  env: Pick<PublicChatServerEnv, "authSchema" | "chatSchema" | "ingestionRegistrySchema">,
): Promise<void> {
  await pool.query(
    buildSchemaBootstrapSql([
      env.authSchema,
      env.chatSchema,
      env.ingestionRegistrySchema,
    ]),
  );
}

export async function ensurePublicChatDatabaseReady(
  pool: Pool,
  env: Pick<
    PublicChatServerEnv,
    | "authSchema"
    | "chatSchema"
    | "databaseSslMode"
    | "databaseUrl"
    | "ingestionRegistrySchema"
  >,
): Promise<void> {
  const cacheKey = [
    env.databaseUrl,
    env.databaseSslMode,
    env.authSchema,
    env.chatSchema,
    env.ingestionRegistrySchema,
  ].join("|");
  const cache = getDatabaseReadyCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    await cached;
    return;
  }

  const bootstrapPromise = (async () => {
    await ensurePublicChatSchemas(pool, env);
    await pool.query(buildChatBootstrapSql(env.chatSchema));
  })();

  cache.set(cacheKey, bootstrapPromise);

  try {
    await bootstrapPromise;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
}
