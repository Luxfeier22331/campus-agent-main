import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, type ClientConfig } from "pg";

const MIGRATIONS_FOLDER = resolve(fileURLToPath(new URL("../migrations", import.meta.url)));
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "campus_agent_migrations";
const ADVISORY_LOCK_KEY = "campus-agent-schema-migrations";
const LEGACY_OBJECTS = [
	"drizzle.app_api_migrations",
	"drizzle.ops_web_dining_migrations",
	"public.execution_control_migrations",
	"model_config.schema_migrations",
	"notices.schema_migrations",
	"execution_config",
] as const;

interface QueryClient {
	query<T extends object = object>(query: string, values?: readonly unknown[]): Promise<{
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
	legacyObjects: string[];
	status: "current" | "missing" | "pending" | "legacy";
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
): Promise<CampusAgentSchemaResult> {
	const client = new Client(readDatabaseConfig(env));
	await client.connect();
	try {
		await assertMigrationOwner(client);
		await assertLegacyObjectsAbsent(client);
		const result = await withSchemaMigrationLock(client, async () => {
			await assertLegacyObjectsAbsent(client);
			const before = await readMigrationCount(client);
			await migrate(drizzle(client), {
				migrationsFolder: MIGRATIONS_FOLDER,
				migrationsSchema: MIGRATIONS_SCHEMA,
				migrationsTable: MIGRATIONS_TABLE,
			});
			await assertLegacyObjectsAbsent(client);
			const migrationCount = await readMigrationCount(client);
			return {
				migrationCount,
				result: migrationCount > before ? "applied" : "current",
			} satisfies CampusAgentSchemaResult;
		});
		return result;
	} finally {
		await client.end();
	}
}

export async function inspectCampusAgentSchema(
	env: NodeJS.ProcessEnv = process.env,
): Promise<CampusAgentSchemaStatus> {
	const client = new Client(readDatabaseConfig(env));
	await client.connect();
	try {
		const legacyObjects = await readLegacyObjects(client);
		if (legacyObjects.length > 0) {
			return {
				appliedMigrations: 0,
				expectedMigrations: expectedMigrationCount(),
				legacyObjects,
				status: "legacy",
			};
		}
		const relation = await client.query<{ present: boolean }>(
			"select to_regclass($1) is not null as present",
			[`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
		);
		if (!relation.rows[0]?.present) {
			return {
				appliedMigrations: 0,
				expectedMigrations: expectedMigrationCount(),
				legacyObjects: [],
				status: "missing",
			};
		}
		const appliedMigrations = await readMigrationCount(client);
		const expectedMigrations = expectedMigrationCount();
		return {
			appliedMigrations,
			expectedMigrations,
			legacyObjects: [],
			status: appliedMigrations === expectedMigrations ? "current" : "pending",
		};
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
			await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [
				ADVISORY_LOCK_KEY,
			]);
		}
	}
}

export async function assertLegacyObjectsAbsent(client: QueryClient): Promise<void> {
	const legacyObjects = await readLegacyObjects(client);
	if (legacyObjects.length > 0) {
		throw new Error(`legacy database objects are still present: ${legacyObjects.join(", ")}`);
	}
}

async function readLegacyObjects(client: QueryClient): Promise<string[]> {
	const result = await client.query<{ object_name: string }>(
					`select object_name
		 from unnest($1::text[]) as legacy(object_name)
		 where case
			when object_name = 'execution_config' then to_regnamespace(object_name) is not null
			else to_regclass(object_name) is not null
			end`,
		[LEGACY_OBJECTS],
	);
	return result.rows.map((row) => row.object_name);
}

export const legacyObjects = LEGACY_OBJECTS;

async function assertMigrationOwner(client: QueryClient): Promise<void> {
	const result = await client.query<{ current_user: string }>("select current_user");
	if (result.rows[0]?.current_user !== "campus_agent") {
		throw new Error(
			`schema migrations must run as campus_agent; current user is ${result.rows[0]?.current_user ?? "unknown"}`,
		);
	}
}

async function readMigrationCount(client: QueryClient): Promise<number> {
	const relation = await client.query<{ present: boolean }>(
		"select to_regclass($1) is not null as present",
		[`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
	);
	if (!relation.rows[0]?.present) {
		return 0;
	}
	const result = await client.query<{ count: string }>(
		`select count(*)::text as count
		 from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
	);
	return Number(result.rows[0]?.count ?? 0);
}

function expectedMigrationCount(): number {
	const journal = JSON.parse(
		readFileSync(resolve(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"),
	) as { entries?: unknown[] };
	return Array.isArray(journal.entries) ? journal.entries.length : 0;
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
