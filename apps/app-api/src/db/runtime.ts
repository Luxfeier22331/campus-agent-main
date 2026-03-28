import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { resolveDatabaseSslMode, resolveEnvironment, type DatabaseSslMode, type Env } from "../config";
import { appApiSchema } from "./schema";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const DEVELOPMENT_POOL_MAX = 1;
const PRODUCTION_POOL_MAX = 4;
const DEVELOPMENT_IDLE_TIMEOUT_MS = 5_000;
const PRODUCTION_IDLE_TIMEOUT_MS = 30_000;

const cacheHost = globalThis as typeof globalThis & {
  __appApiPoolCache?: Map<string, Pool>;
  __appApiDatabaseCache?: Map<string, NodePgDatabase<typeof appApiSchema>>;
};

export function assertPgIdentifier(label: string, value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a lowercase PostgreSQL identifier.`);
  }

  return value;
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
  databaseSslMode: DatabaseSslMode,
): false | { rejectUnauthorized: false } {
  return databaseSslMode === "disable"
    ? false
    : {
        rejectUnauthorized: false,
      };
}

function getPoolCache(): Map<string, Pool> {
  if (!cacheHost.__appApiPoolCache) {
    cacheHost.__appApiPoolCache = new Map<string, Pool>();
  }

  return cacheHost.__appApiPoolCache;
}

function getDatabaseCache(): Map<string, NodePgDatabase<typeof appApiSchema>> {
  if (!cacheHost.__appApiDatabaseCache) {
    cacheHost.__appApiDatabaseCache = new Map<string, NodePgDatabase<typeof appApiSchema>>();
  }

  return cacheHost.__appApiDatabaseCache;
}

export function buildRuntimeDatabaseConfig(env: Env) {
  const connectionString = env.APP_API_DB?.connectionString?.trim();
  if (!connectionString) {
    throw new Error("APP_API_DB.connectionString is required.");
  }

  return {
    connectionString,
    ssl: resolveSslConfig(resolveDatabaseSslMode(env)),
  };
}

export function buildManagementDatabaseConfig(
  env: Env,
) {
  const connectionString = env.APP_API_MANAGEMENT_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("APP_API_MANAGEMENT_DATABASE_URL is required.");
  }

  return {
    connectionString,
    ssl: resolveSslConfig(resolveDatabaseSslMode(env)),
  };
}

function buildPoolOptions(input: {
  connectionString: string;
  databaseSslMode: DatabaseSslMode;
  environment: Env["APP_API_ENVIRONMENT"];
}) {
  const environment = input.environment === "production" ? "production" : "development";
  const isProduction = environment === "production";

  return {
    allowExitOnIdle: !isProduction,
    connectionString: input.connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: isProduction ? PRODUCTION_IDLE_TIMEOUT_MS : DEVELOPMENT_IDLE_TIMEOUT_MS,
    max: isProduction ? PRODUCTION_POOL_MAX : DEVELOPMENT_POOL_MAX,
    ssl: resolveSslConfig(input.databaseSslMode),
  };
}

async function createCachedPool(input: {
  cacheKey: string;
  connectionString: string;
  databaseSslMode: DatabaseSslMode;
  environment: Env["APP_API_ENVIRONMENT"];
}): Promise<Pool> {
  const cache = getPoolCache();
  const cachedPool = cache.get(input.cacheKey);
  if (cachedPool) {
    return cachedPool;
  }

  const { Pool } = await import("pg");
  const pool = new Pool(
    buildPoolOptions({
      connectionString: input.connectionString,
      databaseSslMode: input.databaseSslMode,
      environment: input.environment,
    }),
  );

  cache.set(input.cacheKey, pool);
  return pool;
}

export async function createRuntimePool(env: Env): Promise<Pool> {
  const config = buildRuntimeDatabaseConfig(env);
  const databaseSslMode = resolveDatabaseSslMode(env);
  const environment = resolveEnvironment(env);

  return createCachedPool({
    cacheKey: `runtime:${config.connectionString}|${databaseSslMode}|${environment}`,
    connectionString: config.connectionString,
    databaseSslMode,
    environment,
  });
}

export async function createBetterAuthPool(env: Env): Promise<Pool> {
  const config = buildRuntimeDatabaseConfig(env);
  const databaseSslMode = resolveDatabaseSslMode(env);
  const environment = resolveEnvironment(env);
  const connectionString = buildPostgresSearchPathConnectionString(config.connectionString, [
    "auth",
    "public",
  ]);

  return createCachedPool({
    cacheKey: `auth:${connectionString}|${databaseSslMode}|${environment}`,
    connectionString,
    databaseSslMode,
    environment,
  });
}

export async function createRuntimeDatabase(
  env: Env,
): Promise<NodePgDatabase<typeof appApiSchema>> {
  const config = buildRuntimeDatabaseConfig(env);
  const cache = getDatabaseCache();
  const cacheKey = `runtime-db:${config.connectionString}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { drizzle } = await import("drizzle-orm/node-postgres");
  const database = drizzle(await createRuntimePool(env), {
    schema: appApiSchema,
  });
  cache.set(cacheKey, database);
  return database;
}
