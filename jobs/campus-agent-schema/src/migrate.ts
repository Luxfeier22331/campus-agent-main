import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, type ClientConfig } from "pg";
import { type AppliedMigration, compareHistory, type Migration, readHistory } from "./history.ts";

export const MIGRATIONS_FOLDER = resolve(fileURLToPath(new URL("../migrations", import.meta.url)));
export const MEMORY_MIGRATIONS_FOLDER = resolve(
	fileURLToPath(new URL("../memory-migrations", import.meta.url)),
);
export type SchemaTarget = "campus-agent" | "memory";
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "campus_agent_migrations";
const ADVISORY_LOCK_KEY = "campus-agent-schema-migrations";

interface QueryClient {
	query<T extends object = object>(
		query: string,
		values?: readonly unknown[],
	): Promise<{
		rows: T[];
	}>;
}

export interface CampusAgentSchemaResult {
	migrationCount: number;
	result: "applied" | "current";
}

export interface CampusAgentSchemaStatus {
	appliedMigrations: number;
	expectedMigrations: number;
	pendingMigrations: string[];
	status: "current" | "missing" | "pending";
}

export function readDatabaseConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
	const host = required(env, "PGHOST");
	const port = parsePort(env.PGPORT?.trim() || "5432");
	const database = required(env, "PGDATABASE");
	const user = required(env, "PGUSER");
	const password = required(env, "PGPASSWORD");
	const sslMode = env.PGSSLMODE?.trim() || "require";

	return {
		database,
		host,
		password,
		port,
		ssl: readSslConfig(sslMode, env.PGSSLROOTCERT?.trim()),
		user,
	};
}

export async function migrateCampusAgentSchema(
	env: NodeJS.ProcessEnv = process.env,
	migrationsFolder = MIGRATIONS_FOLDER,
	target: SchemaTarget = "campus-agent",
): Promise<CampusAgentSchemaResult> {
	const history = readHistory(migrationsFolder);
	const client = new Client(readDatabaseConfig(env));
	await client.connect();
	try {
		await assertMigrationOwner(client, target);
		const result = await withSchemaMigrationLock(client, async () => {
			const before = await readStatus(client, history);
			await migrate(drizzle({ client }), {
				migrationsFolder,
				migrationsSchema: MIGRATIONS_SCHEMA,
				migrationsTable: MIGRATIONS_TABLE,
			});
			const after = await readStatus(client, history);
			if (after.status !== "current") {
				throw new Error(`Schema migration incomplete: ${after.pendingMigrations.join(", ")}`);
			}
			return {
				migrationCount: after.appliedMigrations,
				result: before.status === "current" ? "current" : "applied",
			} satisfies CampusAgentSchemaResult;
		});
		return result;
	} finally {
		await client.end();
	}
}

export async function inspectCampusAgentSchema(
	env: NodeJS.ProcessEnv = process.env,
	migrationsFolder = MIGRATIONS_FOLDER,
	target: SchemaTarget = "campus-agent",
): Promise<CampusAgentSchemaStatus> {
	const history = readHistory(migrationsFolder);
	const client = new Client(readDatabaseConfig(env));
	await client.connect();
	try {
		await assertMigrationOwner(client, target);
		return await readStatus(client, history);
	} finally {
		await client.end();
	}
}

export async function withSchemaMigrationLock<T>(
	client: QueryClient,
	operation: () => Promise<T>,
): Promise<T> {
	let locked = false;
	try {
		await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [ADVISORY_LOCK_KEY]);
		locked = true;
		return await operation();
	} finally {
		if (locked) {
			await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [ADVISORY_LOCK_KEY]);
		}
	}
}

async function assertMigrationOwner(client: QueryClient, target: SchemaTarget): Promise<void> {
	const owner = target === "memory" ? "memory_service" : "campus_agent";
	const result = await client.query<{ current_user: string }>("select current_user");
	if (result.rows[0]?.current_user !== owner) {
		throw new Error(
			`schema migrations must run as ${owner}; current user is ${result.rows[0]?.current_user ?? "unknown"}`,
		);
	}
}

async function readStatus(
	client: QueryClient,
	history: Migration[],
): Promise<CampusAgentSchemaStatus> {
	const relation = await client.query<{ present: boolean }>(
		"select to_regclass($1) is not null as present",
		[`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
	);
	if (!relation.rows[0]?.present) {
		return {
			appliedMigrations: 0,
			expectedMigrations: history.length,
			pendingMigrations: history.map((migration) => migration.name),
			status: "missing",
		};
	}
	const applied = await client.query<AppliedMigration>(
		`select id, hash, created_at::text, name from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} order by id`,
	);
	const pendingMigrations = compareHistory(history, applied.rows);
	return {
		appliedMigrations: applied.rows.length,
		expectedMigrations: history.length,
		pendingMigrations,
		status: pendingMigrations.length === 0 ? "current" : "pending",
	};
}

function readSslConfig(
	sslMode: string,
	rootCertPath: string | undefined,
): false | { rejectUnauthorized: false } | { ca: string; rejectUnauthorized: true } {
	if (sslMode === "disable") {
		return false;
	}
	if (sslMode === "require") {
		return { rejectUnauthorized: false };
	}
	if (sslMode === "verify-full") {
		if (!rootCertPath) {
			throw new Error("PGSSLROOTCERT is required when PGSSLMODE=verify-full");
		}
		return { ca: readFileSync(rootCertPath, "utf8"), rejectUnauthorized: true };
	}
	throw new Error("PGSSLMODE must be disable, require, or verify-full");
}

function required(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name];
	if (!value?.trim()) {
		throw new Error(`${name} is required`);
	}
	return value;
}

function parsePort(value: string): number {
	if (!/^[1-9][0-9]{0,4}$/u.test(value) || Number(value) > 65_535) {
		throw new Error("PGPORT must be a valid TCP port");
	}
	return Number(value);
}
