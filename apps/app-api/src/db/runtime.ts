import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type Env, isDeployedEnvironment, resolveEnvironment } from "../config";
import { reportRuntimeFailure } from "../runtime-diagnostics";

export const APP_AUTH_SCHEMA = "app_auth";
export type RuntimeDatabase = NodePgDatabase;
export type RuntimeDbGetter = () => Promise<RuntimeDatabase>;

const DEVELOPMENT_POOL_MAX = 1;
const PRODUCTION_POOL_MAX = 4;
const DEVELOPMENT_IDLE_TIMEOUT_MS = 5_000;
const PRODUCTION_IDLE_TIMEOUT_MS = 30_000;
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
		reportRuntimeFailure(error, {
			error_code: "idle_database_client_error",
			source: "app-api.runtime-db.pool",
		});
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
	return createPool({
		connectionString: config.connectionString,
		environment: resolveEnvironment(env),
	});
}

export async function createRuntimeDatabase(env: Env): Promise<RuntimeDatabase> {
	const { drizzle } = await import("drizzle-orm/node-postgres");
	return drizzle({ client: await createRuntimePool(env) });
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
