import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import {
	type DatabaseSslMode,
	type Env,
	isDeployedEnvironment,
	resolveDatabaseSslMode,
	resolveEnvironment,
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
const cacheHost = globalThis as typeof globalThis & {
	__appApiPoolCache?: Map<string, Pool>;
};

export function normalizePostgresConnectionStringForExplicitSsl(connectionString: string): string {
	const normalized = connectionString.trim();
	if (!normalized) {
		throw new Error("PostgreSQL connection string is required.");
	}

	const nextUrl = new URL(normalized);
	nextUrl.searchParams.delete("sslmode");
	return nextUrl.toString();
}

function shouldCacheRuntimeState(env: Env): boolean {
	return resolveEnvironment(env) === "test";
}

function resolveSslConfig(databaseSslMode: DatabaseSslMode): false | { rejectUnauthorized: false } {
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

function resolveRuntimeConnectionString(env: Env, consistency: RuntimeDatabaseConsistency): string {
	if (consistency === "fresh") {
		const freshConnectionString = env.APP_API_DB_FRESH?.connectionString?.trim();
		if (freshConnectionString) {
			return freshConnectionString;
		}
		throw new Error("APP_API_DB_FRESH.connectionString is required for fresh runtime access.");
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

export interface SchemaDatabaseEnv {
	APP_API_DATABASE_CA_CERT_PATH?: string;
	APP_API_DATABASE_SSLMODE?: Env["APP_API_DATABASE_SSLMODE"];
	APP_API_SCHEMA_DATABASE_URL?: string;
}

export function buildSchemaDatabaseConfig(env: SchemaDatabaseEnv) {
	const connectionString = env.APP_API_SCHEMA_DATABASE_URL?.trim();
	if (!connectionString) {
		throw new Error("APP_API_SCHEMA_DATABASE_URL is required.");
	}
	return {
		connectionString: normalizePostgresConnectionStringForExplicitSsl(connectionString),
		ssl: resolveSslConfig(resolveDatabaseSslMode(env)),
	};
}

function buildPoolOptions(input: {
	connectionString: string;
	databaseSslMode: DatabaseSslMode;
	environment: Env["APP_API_ENVIRONMENT"];
}) {
	const environment = resolveEnvironment({ APP_API_ENVIRONMENT: input.environment });
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

function buildClientOptions(input: { connectionString: string; databaseSslMode: DatabaseSslMode }) {
	return {
		connectionString: input.connectionString,
		connectionTimeoutMillis: 5_000,
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
		console.error({
			error_code: "idle_database_client_error",
			error_type: error.name.replace(/[^a-z0-9_.-]/giu, "_").slice(0, 64) || "DatabaseClientError",
			source: "app-api.runtime-db.pool",
		});
	});
	return pool;
}

async function createCachedPool(input: {
	cacheKey: string;
	connectionString: string;
	databaseSslMode: DatabaseSslMode;
	environment: Env["APP_API_ENVIRONMENT"];
}): Promise<Pool> {
	const poolCache = getPoolCache();
	const existingPool = poolCache.get(input.cacheKey);
	if (existingPool) {
		return existingPool;
	}

	const pool = await createPool({
		connectionString: input.connectionString,
		databaseSslMode: input.databaseSslMode,
		environment: input.environment,
	});
	poolCache.set(input.cacheKey, pool);
	return pool;
}

function isWorkerRuntimeDatabaseContext(): boolean {
	return (
		typeof (globalThis as typeof globalThis & { WebSocketPair?: unknown }).WebSocketPair ===
		"function"
	);
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

export async function withRuntimeDatabase<T>(
	env: Env,
	execute: (database: NodePgDatabase<typeof appApiSchema>) => Promise<T>,
): Promise<T> {
	const config = buildRuntimeDatabaseConfig(env);
	const databaseSslMode = resolveDatabaseSslMode(env);
	const environment = resolveEnvironment(env);
	const { drizzle } = await import("drizzle-orm/node-postgres");

	if (!isWorkerRuntimeDatabaseContext()) {
		const pool = await createCachedPool({
			cacheKey: `runtime:${config.connectionString}|${databaseSslMode}|${environment}`,
			connectionString: config.connectionString,
			databaseSslMode,
			environment,
		});
		const database = drizzle(pool, {
			schema: appApiSchema,
		});

		return execute(database);
	}

	const { Client } = await import("pg");
	const client = new Client(
		buildClientOptions({
			connectionString: config.connectionString,
			databaseSslMode,
		}),
	);
	await client.connect();
	const database = drizzle(client, {
		schema: appApiSchema,
	});

	try {
		return await execute(database);
	} finally {
		await client.end();
	}
}
