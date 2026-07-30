import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool as PgPool, type Pool } from "pg";
import { validateSharedProductCurrentSchemaSql } from "./shared-product-current-schema.ts";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const POSTGRES_PREFIX = /^(postgres|postgresql):\/\//i;

export const APP_AUTH_SCHEMA = "app_auth";
export const APP_CHAT_SCHEMA = "chat";
export interface SharedProductBootstrapEnv {
	authSchema: string;
	chatSchema: string;
	databaseCa?: string;
	databaseSslMode: string;
	databaseUrl: string;
}

const appRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sharedProductSchemaPaths = [
	join(appRoot, "db", "shared-product-schema", "chat_current.sql"),
	join(appRoot, "db", "shared-product-schema", "campus_services.sql"),
] as const;

function readRequiredEnv(key: string, env: NodeJS.ProcessEnv = process.env): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required for app-api shared product bootstrap.`);
	}

	return value;
}

function readOptionalEnv(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env[key]?.trim();
	return value ? value : undefined;
}

function assertIdentifier(label: string, value: string): string {
	if (!IDENTIFIER.test(value)) {
		throw new Error(`${label} must be a lowercase PostgreSQL identifier.`);
	}

	return value;
}

function resolveSsl(
	env: SharedProductBootstrapEnv,
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

export function readSharedProductBootstrapEnv(
	env: NodeJS.ProcessEnv = process.env,
): SharedProductBootstrapEnv {
	const databaseUrl = readRequiredEnv("APP_API_SCHEMA_DATABASE_URL", env);
	if (!POSTGRES_PREFIX.test(databaseUrl)) {
		throw new Error("APP_API_SCHEMA_DATABASE_URL must be a PostgreSQL connection string.");
	}
	const normalizedDatabaseUrl = new URL(databaseUrl);
	normalizedDatabaseUrl.searchParams.delete("sslmode");
	const databaseCaCertPath = readOptionalEnv("APP_API_SCHEMA_DATABASE_CA_CERT_PATH", env);

	return {
		authSchema: APP_AUTH_SCHEMA,
		chatSchema: APP_CHAT_SCHEMA,
		databaseSslMode: env.APP_API_SCHEMA_DATABASE_SSLMODE?.trim() || "require",
		databaseUrl: normalizedDatabaseUrl.toString(),
		databaseCa: databaseCaCertPath ? readFileSync(databaseCaCertPath, "utf8") : undefined,
	};
}

export function createSharedProductPool(env: SharedProductBootstrapEnv): Pool {
	return new PgPool({
		connectionString: env.databaseUrl,
		ssl: resolveSsl(env),
	});
}

function buildSchemaSql(env: SharedProductBootstrapEnv): string {
	return [env.authSchema, env.chatSchema]
		.map((schemaName) => `CREATE SCHEMA IF NOT EXISTS "${assertIdentifier("schema", schemaName)}";`)
		.join("\n");
}

async function applyCurrentSharedProductSchemas(pool: Pool): Promise<string[]> {
	for (const schemaPath of sharedProductSchemaPaths) {
		await applySharedProductCurrentSchemaSql(pool, await readFile(schemaPath, "utf8"));
	}
	return [...sharedProductSchemaPaths];
}

export async function applySharedProductCurrentSchemaSql(
	pool: { query(sql: string): Promise<unknown> },
	sql: string,
): Promise<void> {
	validateSharedProductCurrentSchemaSql(sql);
	await pool.query(sql);
}

export async function prepareSharedProductSchemas(
	envOverrides: NodeJS.ProcessEnv = process.env,
): Promise<{
	authSchema: string;
	chatSchema: string;
	schemaFiles: string[];
}> {
	const env = readSharedProductBootstrapEnv(envOverrides);
	const pool = createSharedProductPool(env);

	try {
		await pool.query(buildSchemaSql(env));
		const schemaFiles = await applyCurrentSharedProductSchemas(pool);
		return {
			authSchema: env.authSchema,
			chatSchema: env.chatSchema,
			schemaFiles,
		};
	} finally {
		await pool.end();
	}
}
