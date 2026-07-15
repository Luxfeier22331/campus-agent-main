// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applySharedProductCurrentSchemaSql } from "../src/script-support/shared-db/shared-product-database-bootstrap.ts";

const databaseUrl = process.env.APP_API_MIGRATION_TEST_DATABASE_URL?.trim();
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fullMigrationsFolder = resolve(appRoot, "drizzle");
const chatCurrentSchemaPath = resolve(appRoot, "db/shared-product-schema/chat_current.sql");

function requireDisposableDatabaseUrl(): string {
	if (!databaseUrl) {
		throw new Error("APP_API_MIGRATION_TEST_DATABASE_URL is required.");
	}
	const databaseName = new URL(databaseUrl).pathname.slice(1);
	if (databaseName !== "campus_agent_migration_test") {
		throw new Error("APP_API_MIGRATION_TEST_DATABASE_URL must target campus_agent_migration_test.");
	}
	return databaseUrl;
}

async function resetDisposableDatabase(pool: Pool): Promise<void> {
	const schemas = await pool.query<{ schema_name: string }>(
		`select nspname as schema_name
		 from pg_namespace
		 where nspname not in ('public', 'information_schema')
		   and nspname not like 'pg_%'`,
	);
	for (const { schema_name: schemaName } of schemas.rows) {
		await pool.query(`drop schema if exists "${schemaName.replaceAll('"', '""')}" cascade`);
	}
}

async function createInitialMigrationFolder(): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), "app-api-migration-"));
	await mkdir(resolve(root, "meta"));
	await copyFile(
		resolve(fullMigrationsFolder, "0000_initial.sql"),
		resolve(root, "0000_initial.sql"),
	);
	const journal = JSON.parse(
		await readFile(resolve(fullMigrationsFolder, "meta/_journal.json"), "utf8"),
	) as { dialect: string; entries: unknown[]; version: string };
	await writeFile(
		resolve(root, "meta/_journal.json"),
		`${JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }, null, 2)}\n`,
	);
	return root;
}

async function applyLegacyChatSchema(pool: Pool): Promise<void> {
	const currentSchema = await readFile(chatCurrentSchemaPath, "utf8");
	const legacySchema = currentSchema.replace(
		"    \"resolved_targets_json\" jsonb DEFAULT '[]'::jsonb NOT NULL,",
		'    "requested_scope" text,\n    "version_query_json" jsonb,',
	);
	if (legacySchema === currentSchema) {
		throw new Error("chat_current.sql no longer contains the expected target column");
	}
	await pool.query(legacySchema);
}

async function applyCurrentChatSchema(pool: Pool): Promise<void> {
	await applySharedProductCurrentSchemaSql(pool, await readFile(chatCurrentSchemaPath, "utf8"));
}

describe.skipIf(!databaseUrl)("app-api migration upgrade", () => {
	let initialMigrationsFolder = "";
	let pool: Pool;

	beforeAll(async () => {
		pool = new Pool({ connectionString: requireDisposableDatabaseUrl() });
		await resetDisposableDatabase(pool);
		initialMigrationsFolder = await createInitialMigrationFolder();
	});

	afterAll(async () => {
		if (pool) {
			await resetDisposableDatabase(pool);
			await pool.end();
		}
		if (initialMigrationsFolder) {
			await rm(initialMigrationsFolder, { force: true, recursive: true });
		}
	});

	it("upgrades the published initial schema without rewriting or losing retained rows", async () => {
		const migrationOptions = {
			migrationsSchema: "drizzle",
			migrationsTable: "app_api_migrations",
		};
		await migrate(drizzle(pool), {
			...migrationOptions,
			migrationsFolder: initialMigrationsFolder,
		});
		await applyLegacyChatSchema(pool);

		await pool.query(`
			insert into "chat"."conversations"
				("id", "owner_user_id", "title", "created_at", "updated_at")
			values ('conversation-upgrade', 'user-upgrade', 'Upgrade', now(), now());
			insert into "chat"."messages"
				("id", "conversation_id", "role", "text", "created_at")
			values ('message-upgrade', 'conversation-upgrade', 'user', 'test', now());
			insert into "chat"."turn_dispatches"
				("request_id", "conversation_id", "user_message_id", "turn_sequence", "surface",
				 "owner_user_id", "actor_user_id", "principal_snapshot_json", "trace_id", "status",
				 "created_at", "updated_at")
			values ('request-upgrade', 'conversation-upgrade', 'message-upgrade', 1, 'web',
				'user-upgrade', 'user-upgrade', '{}'::jsonb, 'trace-upgrade', 'running', now(), now());
			insert into "runtime"."request_observability_fact"
				("request_id", "trace_id", "conversation_id", "surface", "principal_type", "status",
				 "started_at", "measured_at", "updated_at")
			values ('request-upgrade', 'trace-upgrade', 'conversation-upgrade', 'web', 'user', 'running',
				now(), now(), now());
		`);
		await applyCurrentChatSchema(pool);

		await migrate(drizzle(pool), {
			...migrationOptions,
			migrationsFolder: fullMigrationsFolder,
		});

		const retained = await pool.query<{
			chat_targets: unknown;
			observation_targets: unknown;
		}>(`
			select dispatch."resolved_targets_json" as chat_targets,
			       fact."resolved_targets_json" as observation_targets
			from "chat"."turn_dispatches" dispatch
			join "runtime"."request_observability_fact" fact using (request_id)
			where dispatch."request_id" = 'request-upgrade'
		`);
		expect(retained.rows).toEqual([{ chat_targets: [], observation_targets: [] }]);

		const retired = await pool.query<{ schema_name: string }>(`
			select schema_name
			from unnest(array['official_web', 'operator', 'wechat_official_account']) schema_name
			where to_regnamespace(schema_name) is not null
		`);
		expect(retired.rows).toEqual([]);

		await migrate(drizzle(pool), {
			...migrationOptions,
			migrationsFolder: fullMigrationsFolder,
		});
		const ledger = await pool.query<{ count: string }>(
			`select count(*)::text as count from "drizzle"."app_api_migrations"`,
		);
		expect(ledger.rows[0]?.count).toBe("2");

		await resetDisposableDatabase(pool);
		await applyCurrentChatSchema(pool);
		await migrate(drizzle(pool), {
			...migrationOptions,
			migrationsFolder: fullMigrationsFolder,
		});
		const cleanInstall = await pool.query<{
			resolved_targets_json: string | null;
			requested_scope: string | null;
			table_ready: boolean;
			version_query_json: string | null;
		}>(`
			select
				to_regclass('chat.turn_dispatches') is not null as table_ready,
				(select column_name from information_schema.columns
				 where table_schema = 'chat' and table_name = 'turn_dispatches'
				   and column_name = 'resolved_targets_json') as resolved_targets_json,
				(select column_name from information_schema.columns
				 where table_schema = 'chat' and table_name = 'turn_dispatches'
				   and column_name = 'requested_scope') as requested_scope,
				(select column_name from information_schema.columns
				 where table_schema = 'chat' and table_name = 'turn_dispatches'
				   and column_name = 'version_query_json') as version_query_json
		`);
		expect(cleanInstall.rows).toEqual([
			{
				requested_scope: null,
				resolved_targets_json: "resolved_targets_json",
				table_ready: true,
				version_query_json: null,
			},
		]);
	});
});
