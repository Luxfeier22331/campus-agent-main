import { readFileSync } from "node:fs";

import { Pool as PgPool, type Pool } from "pg";

const POSTGRES_PREFIX = /^(postgres|postgresql):\/\//i;

export interface AppApiDatabaseEnv {
	databaseCa?: string;
	databaseSslMode: string;
	databaseUrl: string;
}

function readRequiredEnv(key: string, env: NodeJS.ProcessEnv = process.env): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required for app-api database administration.`);
	}
	return value;
}

function resolveSsl(
	env: AppApiDatabaseEnv,
): false | { ca: string; rejectUnauthorized: true } | { rejectUnauthorized: false } {
	if (env.databaseSslMode === "disable") {
		return false;
	}
	if (env.databaseSslMode === "verify-full") {
		if (!env.databaseCa) {
			throw new Error(
				"APP_API_SCHEMA_DATABASE_CA_CERT_PATH is required when APP_API_SCHEMA_DATABASE_SSLMODE=verify-full.",
			);
		}
		return { ca: env.databaseCa, rejectUnauthorized: true };
	}
	if (env.databaseSslMode === "require") {
		return { rejectUnauthorized: false };
	}
	throw new Error("APP_API_SCHEMA_DATABASE_SSLMODE must be verify-full, require, or disable.");
}

export function readAppApiDatabaseEnv(env: NodeJS.ProcessEnv = process.env): AppApiDatabaseEnv {
	const databaseUrl = readRequiredEnv("APP_API_SCHEMA_DATABASE_URL", env);
	if (!POSTGRES_PREFIX.test(databaseUrl)) {
		throw new Error("APP_API_SCHEMA_DATABASE_URL must be a PostgreSQL connection string.");
	}
	const normalizedDatabaseUrl = new URL(databaseUrl);
	normalizedDatabaseUrl.searchParams.delete("sslmode");
	const databaseCaCertPath = env.APP_API_SCHEMA_DATABASE_CA_CERT_PATH?.trim();

	return {
		databaseSslMode: env.APP_API_SCHEMA_DATABASE_SSLMODE?.trim() || "require",
		databaseUrl: normalizedDatabaseUrl.toString(),
		...(databaseCaCertPath ? { databaseCa: readFileSync(databaseCaCertPath, "utf8") } : {}),
	};
}

export function createAppApiDatabasePool(env: AppApiDatabaseEnv): Pool {
	return new PgPool({
		connectionString: env.databaseUrl,
		ssl: resolveSsl(env),
	});
}
