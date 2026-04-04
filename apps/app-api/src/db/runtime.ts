import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import {
  isDeployedEnvironment,
  resolveDatabaseSslMode,
  resolveEnvironment,
  type DatabaseSslMode,
  type Env,
} from "../config";
import { appApiSchema } from "./schema";

export const APP_AUTH_SCHEMA = "app_auth";
export type RuntimeDatabase = NodePgDatabase<typeof appApiSchema>;
export type RuntimeDbGetter = () => Promise<RuntimeDatabase>;
export type RuntimeDatabaseConsistency = "cached" | "fresh";

const DEVELOPMENT_POOL_MAX = 1;
const PRODUCTION_POOL_MAX = 4;
const DEVELOPMENT_IDLE_TIMEOUT_MS = 5_000;
const PRODUCTION_IDLE_TIMEOUT_MS = 30_000;
const runtimeDatabaseCache = {
  cached: new WeakMap<Env, Promise<NodePgDatabase<typeof appApiSchema>>>(),
  fresh: new WeakMap<Env, Promise<NodePgDatabase<typeof appApiSchema>>>(),
} as const;
const runtimePoolCache = {
  cached: new WeakMap<Env, Promise<Pool>>(),
  fresh: new WeakMap<Env, Promise<Pool>>(),
} as const;

function shouldCacheRuntimeState(env: Env): boolean {
  return resolveEnvironment(env) === "test";
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

function resolveRuntimeConnectionString(
  env: Env,
  consistency: RuntimeDatabaseConsistency,
): string {
  if (consistency === "fresh") {
    const freshConnectionString = env.APP_API_DB_FRESH?.connectionString?.trim();
    if (freshConnectionString) {
      return freshConnectionString;
    }
  }

  const connectionString = env.APP_API_DB?.connectionString?.trim();
  if (!connectionString) {
    throw new Error("APP_API_DB.connectionString is required.");
  }

  return connectionString;
}

export function buildRuntimeDatabaseConfig(
  env: Env,
  input: {
    consistency?: RuntimeDatabaseConsistency;
  } = {},
) {
  const consistency = input.consistency ?? "cached";
  const connectionString = resolveRuntimeConnectionString(env, consistency);

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
  const environment = resolveEnvironment({
    APP_API_ENVIRONMENT: input.environment,
  });
  const isDeployed = isDeployedEnvironment(environment);

  return {
    allowExitOnIdle: !isDeployed,
    connectionString: input.connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: isDeployed ? PRODUCTION_IDLE_TIMEOUT_MS : DEVELOPMENT_IDLE_TIMEOUT_MS,
    max: isDeployed ? PRODUCTION_POOL_MAX : DEVELOPMENT_POOL_MAX,
    ssl: resolveSslConfig(input.databaseSslMode),
  };
}

async function createPool(input: {
  connectionString: string;
  databaseSslMode: DatabaseSslMode;
  environment: Env["APP_API_ENVIRONMENT"];
}): Promise<Pool> {
  const { Pool } = await import("pg");
  const pool = new Pool(
    buildPoolOptions({
      connectionString: input.connectionString,
      databaseSslMode: input.databaseSslMode,
      environment: input.environment,
    }),
  );
  pool.on("error", (error: Error) => {
    console.error(
      JSON.stringify({
        error: {
          message: error.message,
          name: error.name,
        },
        source: "app-api.runtime-db.pool",
      }),
    );
  });
  return pool;
}

async function withIsolatedProbePool<T>(
  env: Env,
  callback: (pool: Pool) => Promise<T>,
): Promise<T> {
  const config = buildRuntimeDatabaseConfig(env);
  const pool = await createPool({
    connectionString: config.connectionString,
    databaseSslMode: resolveDatabaseSslMode(env),
    environment: resolveEnvironment(env),
  });

  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

export async function createRuntimePool(
  env: Env,
  input: {
    consistency?: RuntimeDatabaseConsistency;
  } = {},
): Promise<Pool> {
  const consistency = input.consistency ?? "cached";
  const config = buildRuntimeDatabaseConfig(env, { consistency });
  const databaseSslMode = resolveDatabaseSslMode(env);
  const environment = resolveEnvironment(env);
  if (!shouldCacheRuntimeState(env)) {
    return createPool({
      connectionString: config.connectionString,
      databaseSslMode,
      environment,
    });
  }

  const cache = runtimePoolCache[consistency];
  const cached = cache.get(env);
  if (cached) {
    return cached;
  }

  const poolPromise = createPool({
    connectionString: config.connectionString,
    databaseSslMode,
      environment,
    });
  cache.set(env, poolPromise);
  return poolPromise;
}

export async function createRuntimeDatabase(
  env: Env,
  input: {
    consistency?: RuntimeDatabaseConsistency;
  } = {},
): Promise<RuntimeDatabase> {
  const consistency = input.consistency ?? "cached";
  if (!shouldCacheRuntimeState(env)) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    return drizzle(await createRuntimePool(env, { consistency }), {
      schema: appApiSchema,
    });
  }

  const cache = runtimeDatabaseCache[consistency];
  const cached = cache.get(env);
  if (cached) {
    return cached;
  }

  const databasePromise = (async () => {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    return drizzle(await createRuntimePool(env, { consistency }), {
      schema: appApiSchema,
    });
  })();
  cache.set(env, databasePromise);
  return databasePromise;
}

export function createRuntimeDbGetter(
  env: Env,
  input: {
    consistency?: RuntimeDatabaseConsistency;
  } = {},
): RuntimeDbGetter {
  return () => createRuntimeDatabase(env, input);
}

export function createScopedRuntimeDbGetter(
  env: Env,
  input: {
    consistency?: RuntimeDatabaseConsistency;
  } = {},
): RuntimeDbGetter {
  let dbPromise: Promise<RuntimeDatabase> | null = null;

  return () => {
    dbPromise ??= createRuntimeDatabase(env, input);
    return dbPromise;
  };
}

export async function probeRuntimeDatabase(env: Env): Promise<void> {
  await withIsolatedProbePool(env, async (pool) => {
    await pool.query("select 1");
  });
}

export async function probeBetterAuthDatabase(env: Env): Promise<void> {
  await withIsolatedProbePool(env, async (pool) => {
    await pool.query(`select 1 from "${APP_AUTH_SCHEMA}"."user" limit 1`);
  });
}
