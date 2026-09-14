import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { type Env, isDeployedEnvironment, resolveEnvironment } from "../config";

export const APP_AUTH_SCHEMA = "app_auth";
export type RuntimeDatabase = NodePgDatabase;
export type RuntimeDbGetter = () => Promise<RuntimeDatabase>;

const DEVELOPMENT_POOL_MAX = 1;
const PRODUCTION_POOL_MAX = 4;
const DEVELOPMENT_IDLE_TIMEOUT_MS = 5_000;
const PRODUCTION_IDLE_TIMEOUT_MS = 30_000;
const runtimeDatabaseCache = new WeakMap<Env, Promise<NodePgDatabase>>();
const runtimePoolCache = new WeakMap<Env, Promise<Pool>>();
const cacheHost = globalThis as typeof globalThis & {
	__appApiPoolCache?: Map<string, Pool>;
};

function shouldCacheRuntimeState(env: Env): boolean {
	return resolveEnvironment(env) === "test";
}

function getPoolCache(): Map<string, Pool> {
	if (!cacheHost.__appApiPoolCache) {
		cacheHost.__appApiPoolCache = new Map<string, Pool>();
	}

	return cacheHost.__appApiPoolCache;
}

function resolveRuntimeConnectionString(env: Env): string {
	const connectionString = env.APP_API_DB?.connectionString?.trim();
	if (!connectionString) {
		throw new Error("APP_API_DB.connectionString is required.");
	}

	return connectionString;
}

export function buildRuntimeDatabaseConfig(env: Env) {
	return {
		connectionString: resolveRuntimeConnectionString(env),
	};
}

function buildPoolOptions(input: {
	connectionString: string;
	environment: Env["DEPLOYMENT_ENVIRONMENT"];
}) {
	const environment = resolveEnvironment(
		input.environment ? { DEPLOYMENT_ENVIRONMENT: input.environment } : {},
	);
	const isDeployed = isDeployedEnvironment(environment);

	return {
		allowExitOnIdle: !isDeployed,
		connectionString: input.connectionString,
		connectionTimeoutMillis: 5_000,
		idleTimeoutMillis: isDeployed ? PRODUCTION_IDLE_TIMEOUT_MS : DEVELOPMENT_IDLE_TIMEOUT_MS,
		max: isDeployed ? PRODUCTION_POOL_MAX : DEVELOPMENT_POOL_MAX,
	};
}

function buildClientOptions(input: { connectionString: string }) {
	return {
		connectionString: input.connectionString,
		connectionTimeoutMillis: 5_000,
	};
}

async function createPool(input: {
	connectionString: string;
	environment: Env["DEPLOYMENT_ENVIRONMENT"];
}): Promise<Pool> {
	const { Pool } = await import("pg");
	const pool = new Pool(
		buildPoolOptions({
			connectionString: input.connectionString,
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
	environment: Env["DEPLOYMENT_ENVIRONMENT"];
}): Promise<Pool> {
	const poolCache = getPoolCache();
	const existingPool = poolCache.get(input.cacheKey);
	if (existingPool) {
		return existingPool;
	}

	const pool = await createPool({
		connectionString: input.connectionString,
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
		environment: resolveEnvironment(env),
	});

	try {
		return await callback(pool);
	} finally {
		await pool.end();
	}
}

export async function createRuntimePool(env: Env): Promise<Pool> {
	const config = buildRuntimeDatabaseConfig(env);
	const environment = resolveEnvironment(env);
	if (!(shouldCacheRuntimeState(env) || isWorkerRuntimeDatabaseContext())) {
		return createPool({
			connectionString: config.connectionString,
			environment,
		});
	}
	if (!shouldCacheRuntimeState(env)) {
		return createPool({
			connectionString: config.connectionString,
			environment,
		});
	}

	const cached = runtimePoolCache.get(env);
	if (cached) {
		return cached;
	}

	const poolPromise = createPool({
		connectionString: config.connectionString,
		environment,
	});
	runtimePoolCache.set(env, poolPromise);
	return poolPromise;
}

export async function createRuntimeDatabase(env: Env): Promise<RuntimeDatabase> {
	if (!shouldCacheRuntimeState(env)) {
		const { drizzle } = await import("drizzle-orm/node-postgres");
		return drizzle({ client: await createRuntimePool(env) });
	}

	const cached = runtimeDatabaseCache.get(env);
	if (cached) {
		return cached;
	}

	const databasePromise = (async () => {
		const { drizzle } = await import("drizzle-orm/node-postgres");
		return drizzle({ client: await createRuntimePool(env) });
	})();
	runtimeDatabaseCache.set(env, databasePromise);
	return databasePromise;
}

export function createRuntimeDbGetter(env: Env): RuntimeDbGetter {
	return () => createRuntimeDatabase(env);
}

export function createScopedRuntimeDbGetter(env: Env): RuntimeDbGetter {
	let dbPromise: Promise<RuntimeDatabase> | null = null;

	return () => {
		dbPromise ??= createRuntimeDatabase(env);
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
	execute: (database: NodePgDatabase) => Promise<T>,
): Promise<T> {
	const config = buildRuntimeDatabaseConfig(env);
	const environment = resolveEnvironment(env);
	const { drizzle } = await import("drizzle-orm/node-postgres");

	if (!isWorkerRuntimeDatabaseContext()) {
		const pool = await createCachedPool({
			cacheKey: `runtime:${config.connectionString}|${environment}`,
			connectionString: config.connectionString,
			environment,
		});
		const database = drizzle({ client: pool });

		return execute(database);
	}

	const { Client } = await import("pg");
	const client = new Client(
		buildClientOptions({
			connectionString: config.connectionString,
		}),
	);
	await client.connect();
	const database = drizzle({ client: client });

	try {
		return await execute(database);
	} finally {
		await client.end();
	}
}
