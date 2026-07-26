// @vitest-environment node

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appApiSchema } from "../src/db/schema";
import { createPgProfileMemoryStore } from "../src/modules/profile-memory";
import { applySharedProductCurrentSchemaSql } from "../src/script-support/shared-db/shared-product-database-bootstrap.ts";

const POSTGRES_IMAGE =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
const MIGRATION_DATABASE_NAME = "campus_agent_migration_test";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fullMigrationsFolder = resolve(appRoot, "drizzle");
const chatCurrentSchemaPath = resolve(appRoot, "db/shared-product-schema/chat_current.sql");

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

async function createMigrationFolderThrough(entryCount: number): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), "app-api-migration-"));
	await mkdir(resolve(root, "meta"));
	const journal = JSON.parse(
		await readFile(resolve(fullMigrationsFolder, "meta/_journal.json"), "utf8"),
	) as { dialect: string; entries: Array<{ tag: string }>; version: string };
	for (const entry of journal.entries.slice(0, entryCount)) {
		await copyFile(
			resolve(fullMigrationsFolder, `${entry.tag}.sql`),
			resolve(root, `${entry.tag}.sql`),
		);
	}
	await writeFile(
		resolve(root, "meta/_journal.json"),
		`${JSON.stringify({ ...journal, entries: journal.entries.slice(0, entryCount) }, null, 2)}\n`,
	);
	return root;
}

async function applyLegacyChatSchema(pool: Pool): Promise<void> {
	const currentSchema = await readFile(chatCurrentSchemaPath, "utf8");
	let legacySchema = currentSchema.replace(
		"    \"resolved_targets_json\" jsonb DEFAULT '[]'::jsonb NOT NULL,",
		'    "requested_scope" text,\n    "version_query_json" jsonb,',
	);
	for (const column of [
		'    "assistant_message_id" text NOT NULL,\n',
		"    \"admission_status\" text DEFAULT 'pending_input' NOT NULL,\n",
		'    "workflow_id" text,\n',
		'    "workflow_input_json" jsonb,\n',
		'    "workflow_input_sha256" text,\n',
		'    "admitted_at" timestamp with time zone,\n',
		'    "finalization_fingerprint" text,\n',
	]) {
		legacySchema = legacySchema.replace(column, "");
	}
	legacySchema = legacySchema.replace(
		/ALTER TABLE "chat"\."turn_dispatches" ADD COLUMN IF NOT EXISTS "assistant_message_id"[\s\S]*?ALTER TABLE "chat"\."turn_dispatches" ADD COLUMN IF NOT EXISTS "finalization_fingerprint" text;\n/u,
		"",
	);
	await pool.query(legacySchema);
}

async function applyCurrentChatSchema(pool: Pool): Promise<void> {
	await applySharedProductCurrentSchemaSql(pool, await readFile(chatCurrentSchemaPath, "utf8"));
}

describe("app-api migration upgrade", () => {
	let container: StartedPostgreSqlContainer;
	let initialMigrationsFolder = "";
	let mainMigrationsFolder = "";
	let pool: Pool;

	beforeAll(async () => {
		process.env.RYUK_CONTAINER_IMAGE = RYUK_IMAGE;
		container = await new PostgreSqlContainer(POSTGRES_IMAGE)
			.withDatabase(MIGRATION_DATABASE_NAME)
			.withUsername("migration_test")
			.withPassword(randomUUID())
			.withResourcesQuota({ cpu: 1, memory: 512 * 1024 * 1024 })
			.start();
		pool = new Pool({ connectionString: container.getConnectionUri() });
		await resetDisposableDatabase(pool);
		initialMigrationsFolder = await createMigrationFolderThrough(1);
		mainMigrationsFolder = await createMigrationFolderThrough(3);
	}, 180_000);

	afterAll(async () => {
		try {
			if (pool) {
				await pool.end();
			}
			if (initialMigrationsFolder) {
				await rm(initialMigrationsFolder, { force: true, recursive: true });
			}
			if (mainMigrationsFolder) {
				await rm(mainMigrationsFolder, { force: true, recursive: true });
			}
		} finally {
			if (container) {
				await container.stop();
			}
		}
	}, 60_000);

	it("upgrades main 0002 directly to the production Hindsight schema", async () => {
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
			insert into "provider_config"."connections"
				("connection_id", "provider", "base_url", "features_json", "feature_config_json",
				 "api_key_secret_json", "revision", "created_at", "created_by_json", "updated_at", "updated_by_json")
			values ('connection-upgrade', 'openai-compatible', 'https://provider.example/v1', '["prompt"]', '{}',
				'{"ciphertext":"aesgcm:test:test","fingerprint":"test","last4":"test"}', 1, now(), '{}', now(), '{}');
			insert into "provider_config"."profiles"
				("profile_id", "kind", "role", "connection_id", "transport", "model", "timeout_ms",
				 "status", "active", "revision", "validation_json", "created_at", "created_by_json", "updated_at", "updated_by_json")
			values ('profile-upgrade', 'prompt', 'primary_agent', 'connection-upgrade', 'responses', 'model', 30000,
				'active', true, 1, '{"ok":true,"message":"passed","status":"passed"}', now(), '{}', now(), '{}');
		`);

		await migrate(drizzle(pool), {
			...migrationOptions,
			migrationsFolder: mainMigrationsFolder,
		});
		await pool.query(`
			insert into "docs"."releases"
				("manifest_key", "manifest_sha256", "materialized_at", "release_id")
			values ('manifests/docs.json', repeat('a', 64), now(), 'sha256:${"b".repeat(64)}');
			insert into "profile"."memory_settings"
				("owner_user_id", "profile_memory_enabled", "updated_at")
			values ('memory-upgrade-owner', false, '2026-07-15T08:00:00Z');
			insert into "profile"."memory_items"
				("item_id", "owner_user_id", "key", "runtime_episode_uuid", "value", "source_type",
				 "confidence", "visibility", "created_at", "updated_at", "last_verified_at")
			values ('memory-upgrade-item', 'memory-upgrade-owner', 'answer_style', 'episode-legacy',
				'先给结论', 'user_declared', 'low', 'user_visible',
				'2026-07-15T08:00:00Z', '2026-07-15T08:00:00Z', '2026-07-15T08:00:00Z');
		`);

		await migrate(drizzle(pool), {
			...migrationOptions,
			migrationsFolder: fullMigrationsFolder,
		});

		const retained = await pool.query<{
			admission_status: string;
			assistant_message_id: string;
			chat_targets: unknown;
			observation_targets: unknown;
		}>(`
			select dispatch."resolved_targets_json" as chat_targets,
			       dispatch."assistant_message_id", dispatch."admission_status",
			       fact."resolved_targets_json" as observation_targets
			from "chat"."turn_dispatches" dispatch
			join "runtime"."request_observability_fact" fact using (request_id)
			where dispatch."request_id" = 'request-upgrade'
		`);
		expect(retained.rows).toEqual([
			{
				admission_status: "pending_input",
				assistant_message_id: "request-upgrade:assistant",
				chat_targets: [],
				observation_targets: [],
			},
		]);

		const memory = await pool.query<{
			command_sequence: string;
			desired_state: string;
			generation: string;
			lifecycle_state: string;
			owner_generation: string;
			revision: string;
			sync_status: string;
		}>(`
			select settings."lifecycle_state", settings."generation"::text,
			       settings."command_sequence"::text, item."owner_generation"::text,
			       item."revision"::text, item."desired_state", item."sync_status"
			from "profile"."memory_settings" settings
			join "profile"."memory_items" item using (owner_user_id)
			where settings."owner_user_id" = 'memory-upgrade-owner'
		`);
		expect(memory.rows).toEqual([
			{
				command_sequence: "0",
				desired_state: "present",
				generation: "1",
				lifecycle_state: "paused",
				owner_generation: "1",
				revision: "1",
				sync_status: "pending",
			},
		]);
		await expect(
			pool.query(
				`select "release_id" from "docs"."releases" where "manifest_key" = 'manifests/docs.json'`,
			),
		).resolves.toMatchObject({ rowCount: 1 });

		const runtimeDb = drizzle(pool, { schema: appApiSchema });
		const migratedStore = createPgProfileMemoryStore({}, { getDb: async () => runtimeDb });
		await expect(
			migratedStore.createItem({
				commandId: "memory-upgrade-reconcile-command",
				idempotencyKeyHash: "memory-upgrade-reconcile-idempotency",
				itemId: "memory-upgrade-reconcile-item",
				key: "answer_style",
				ownerUserId: "memory-upgrade-reconcile-owner",
				requestFingerprint: "memory-upgrade-reconcile-request",
				updatedAt: "2026-07-15T09:01:00Z",
				value: "先给结论",
			}),
		).resolves.toMatchObject({ syncStatus: "pending" });
		await expect(
			migratedStore.applyCommandResult({
				commandId: "memory-upgrade-reconcile-command",
				resultFingerprint: "6".repeat(64),
				status: "succeeded",
				updatedAt: "2026-07-15T09:02:00Z",
			}),
		).resolves.toBe("applied");

		const retired = await pool.query<{ schema_name: string }>(`
			select schema_name
			from unnest(array['campus_services_ops', 'identity', 'observability', 'official_web', 'operator', 'provider_config', 'wechat_official_account']) schema_name
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
		expect(ledger.rows[0]?.count).toBe("6");
		const seededGroups = await pool.query<{
			count: string;
			discord_join_url: string | null;
			featured_group_name: string | null;
			lol_summary: string | null;
			mahjong_count: string;
		}>(`
				select count(*)::text as count,
				       max(name) filter (where id = 'qq-760540871') as featured_group_name,
				       max(join_url) filter (where id = 'discord-muc-community') as discord_join_url,
				       max(summary) filter (where id = 'qq-720518745') as lol_summary,
				       count(*) filter (where id in ('contact-mahjong', 'qq-863056472'))::text as mahjong_count
				from campus_groups.groups
		`);
		expect(seededGroups.rows).toEqual([
			{
				count: "55",
				discord_join_url: "https://discord.gg/XgQqU9zrPZ",
				featured_group_name: "王佐体育运动学校",
				lol_summary: "已阵亡",
				mahjong_count: "2",
			},
		]);
		const seededSections = await pool.query<{ id: string; name: string; position: number }>(`
			select id, name, position from campus_groups.sections order by position
		`);
		expect(seededSections.rows).toEqual([
			{ id: "acgn", name: "ACGN", position: 0 },
			{ id: "online-games", name: "线上游戏", position: 1 },
			{ id: "interest-groups", name: "同好群", position: 2 },
		]);

		await resetDisposableDatabase(pool);
		await applyCurrentChatSchema(pool);
		await migrate(drizzle(pool), {
			...migrationOptions,
			migrationsFolder: fullMigrationsFolder,
		});
		const cleanInstall = await pool.query<{
			assistant_message_id: string | null;
			campus_groups_ready: boolean;
			campus_group_sections_ready: boolean;
			memory_commands_ready: boolean;
			resolved_targets_json: string | null;
		}>(`
				select
					to_regclass('campus_groups.groups') is not null as campus_groups_ready,
					to_regclass('campus_groups.sections') is not null as campus_group_sections_ready,
				to_regclass('profile.memory_commands') is not null as memory_commands_ready,
				(select column_name from information_schema.columns
				 where table_schema = 'chat' and table_name = 'turn_dispatches'
				   and column_name = 'assistant_message_id') as assistant_message_id,
				(select column_name from information_schema.columns
				 where table_schema = 'chat' and table_name = 'turn_dispatches'
				   and column_name = 'resolved_targets_json') as resolved_targets_json
		`);
		expect(cleanInstall.rows).toEqual([
			{
				assistant_message_id: "assistant_message_id",
				campus_group_sections_ready: true,
				campus_groups_ready: true,
				memory_commands_ready: true,
				resolved_targets_json: "resolved_targets_json",
			},
		]);
		const groupPrimaryKey = await pool.query<{ column_name: string }>(`
			select attribute.attname as column_name
			from pg_constraint constraint_row
			join pg_class relation on relation.oid = constraint_row.conrelid
			join pg_namespace namespace on namespace.oid = relation.relnamespace
			join unnest(constraint_row.conkey) with ordinality key(attnum, position) on true
			join pg_attribute attribute
			  on attribute.attrelid = relation.oid and attribute.attnum = key.attnum
			where namespace.nspname = 'campus_groups'
			  and relation.relname = 'groups'
			  and constraint_row.contype = 'p'
			order by key.position
		`);
		expect(groupPrimaryKey.rows).toEqual([{ column_name: "id" }]);
		await expect(
			pool.query(`select id from campus_groups.groups where id = 'qq-533365461'`),
		).resolves.toMatchObject({ rowCount: 1 });
		await expect(
			pool.query(`
					insert into campus_groups.groups(
						id, section_id, position, join_url, name, qq_group_number, summary, tags
					)
						values (
							'migration-verification', 'interest-groups', 21, null,
						'迁移测试群', '123456789', '', array[]::text[]
					)
				on conflict(id) do update
				set name = excluded.name
			`),
		).resolves.toMatchObject({ rowCount: 1 });
	});
});
