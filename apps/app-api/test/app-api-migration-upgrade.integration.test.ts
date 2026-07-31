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
import { installAppApiSchema } from "../ops/db/schema.ts";
import { appApiSchema } from "../src/db/schema";
import { createPgProfileMemoryStore } from "../src/modules/profile-memory";

const POSTGRES_IMAGE =
	"postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
const MIGRATION_DATABASE_NAME = "campus_agent_migration_test";
const DEPLOYMENT_ROLES = ["app_api", "docs_publish", "execution_control", "ops_web"] as const;
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fullMigrationsFolder = resolve(appRoot, "drizzle");
const OWNERSHIP_MIGRATION_TAG = "0007_execution_runtime_ownership";
const legacyAuthSchemaPath = resolve(appRoot, "test/fixtures/app-auth-pre-drizzle.sql");
// Exact chat_current.sql from e05c5a52, immediately before 0001_docs_release_scope.
const legacyChatSchemaPath = resolve(appRoot, "drizzle/baseline/chat_pre_0001.sql");

interface MigrationJournal {
	dialect: string;
	entries: Array<{ tag: string; when: number }>;
	version: string;
}

const EXPECTED_AUTH_FOREIGN_KEYS = [
	{
		column_name: "userId",
		constraint_name: "account_userId_user_id_fk",
		delete_action: "CASCADE",
		referenced_column: "id",
		referenced_table: "user",
		table_name: "account",
	},
	{
		column_name: "clientId",
		constraint_name: "oauthAccessToken_clientId_oauthClient_clientId_fk",
		delete_action: "CASCADE",
		referenced_column: "clientId",
		referenced_table: "oauthClient",
		table_name: "oauthAccessToken",
	},
	{
		column_name: "refreshId",
		constraint_name: "oauthAccessToken_refreshId_oauthRefreshToken_id_fk",
		delete_action: "CASCADE",
		referenced_column: "id",
		referenced_table: "oauthRefreshToken",
		table_name: "oauthAccessToken",
	},
	{
		column_name: "sessionId",
		constraint_name: "oauthAccessToken_sessionId_session_id_fk",
		delete_action: "SET NULL",
		referenced_column: "id",
		referenced_table: "session",
		table_name: "oauthAccessToken",
	},
	{
		column_name: "userId",
		constraint_name: "oauthAccessToken_userId_user_id_fk",
		delete_action: "CASCADE",
		referenced_column: "id",
		referenced_table: "user",
		table_name: "oauthAccessToken",
	},
	{
		column_name: "userId",
		constraint_name: "oauthClient_userId_user_id_fk",
		delete_action: "CASCADE",
		referenced_column: "id",
		referenced_table: "user",
		table_name: "oauthClient",
	},
	{
		column_name: "clientId",
		constraint_name: "oauthConsent_clientId_oauthClient_clientId_fk",
		delete_action: "CASCADE",
		referenced_column: "clientId",
		referenced_table: "oauthClient",
		table_name: "oauthConsent",
	},
	{
		column_name: "userId",
		constraint_name: "oauthConsent_userId_user_id_fk",
		delete_action: "CASCADE",
		referenced_column: "id",
		referenced_table: "user",
		table_name: "oauthConsent",
	},
	{
		column_name: "clientId",
		constraint_name: "oauthRefreshToken_clientId_oauthClient_clientId_fk",
		delete_action: "CASCADE",
		referenced_column: "clientId",
		referenced_table: "oauthClient",
		table_name: "oauthRefreshToken",
	},
	{
		column_name: "sessionId",
		constraint_name: "oauthRefreshToken_sessionId_session_id_fk",
		delete_action: "SET NULL",
		referenced_column: "id",
		referenced_table: "session",
		table_name: "oauthRefreshToken",
	},
	{
		column_name: "userId",
		constraint_name: "oauthRefreshToken_userId_user_id_fk",
		delete_action: "CASCADE",
		referenced_column: "id",
		referenced_table: "user",
		table_name: "oauthRefreshToken",
	},
	{
		column_name: "userId",
		constraint_name: "session_userId_user_id_fk",
		delete_action: "CASCADE",
		referenced_column: "id",
		referenced_table: "user",
		table_name: "session",
	},
] as const;

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

async function createDeploymentRoles(pool: Pool): Promise<void> {
	for (const role of DEPLOYMENT_ROLES) {
		await pool.query(`create role "${role}" nologin`);
	}
}

async function readMigrationJournal(): Promise<MigrationJournal> {
	return JSON.parse(
		await readFile(resolve(fullMigrationsFolder, "meta/_journal.json"), "utf8"),
	) as MigrationJournal;
}

async function createMigrationFolderThrough(
	entryCount: number,
	journal: MigrationJournal,
): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), "app-api-migration-"));
	await mkdir(resolve(root, "meta"));
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

async function applyLegacyChatBaseline(pool: Pool): Promise<void> {
	await pool.query(await readFile(legacyChatSchemaPath, "utf8"));
}

async function applyLegacyBetterAuthBaseline(pool: Pool): Promise<void> {
	await pool.query(await readFile(legacyAuthSchemaPath, "utf8"));
}

async function seedLegacyBetterAuthData(pool: Pool): Promise<void> {
	await pool.query(`
		insert into "app_auth"."user"
			("id", "name", "email", "emailVerified", "role", "banned")
		values ('legacy-user', 'Legacy User', 'legacy@example.test', true, null, null);
		insert into "app_auth"."account"
			("id", "accountId", "providerId", "userId", "password", "updatedAt")
		values ('legacy-account', 'legacy-user', 'credential', 'legacy-user', 'legacy-password', now());
		insert into "app_auth"."session"
			("id", "expiresAt", "token", "updatedAt", "userId")
		values ('legacy-session', now() + interval '1 day', 'legacy-token', now(), 'legacy-user');
		insert into "app_auth"."oauthClient"
			("id", "clientId", "userId", "redirectUris")
		values ('legacy-client-row', 'legacy-client', 'legacy-user',
			'["https://client.example/callback"]'::jsonb);
		insert into "app_auth"."oauthRefreshToken"
			("id", "token", "clientId", "sessionId", "userId", "expiresAt", "createdAt", "scopes")
		values ('legacy-refresh-row', 'legacy-refresh-token', 'legacy-client', 'legacy-session',
			'legacy-user', now() + interval '1 day', now(), '["openid"]'::jsonb);
		insert into "app_auth"."oauthAccessToken"
			("id", "token", "clientId", "sessionId", "userId", "refreshId", "expiresAt", "createdAt", "scopes")
		values ('legacy-access-row', 'legacy-access-token', 'legacy-client', 'legacy-session',
			'legacy-user', 'legacy-refresh-row', now() + interval '1 hour', now(), '["openid"]'::jsonb);
		insert into "app_auth"."oauthConsent"
			("id", "clientId", "userId", "scopes", "createdAt", "updatedAt")
		values ('legacy-consent-row', 'legacy-client', 'legacy-user', '["openid"]'::jsonb, now(), now());
	`);
}

function errorChainText(error: unknown): string {
	const messages: string[] = [];
	const seen = new Set<unknown>();
	let current = error;
	while (current && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		if ("message" in current && typeof current.message === "string") {
			messages.push(current.message);
		}
		current = "cause" in current ? current.cause : undefined;
	}
	return messages.join("\n");
}

describe("app-api migration upgrade", () => {
	let container: StartedPostgreSqlContainer;
	let initialMigrationsFolder = "";
	let mainMigrationsFolder = "";
	let ownershipPredecessorMigrationsFolder = "";
	let predecessorMigrationsFolder = "";
	let fullMigrationCount = 0;
	let predecessorMigrationCount = 0;
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
		await createDeploymentRoles(pool);
		const journal = await readMigrationJournal();
		fullMigrationCount = journal.entries.length;
		const ownershipMigrationIndex = journal.entries.findIndex(
			({ tag }) => tag === OWNERSHIP_MIGRATION_TAG,
		);
		if (ownershipMigrationIndex < 0) {
			throw new Error(`Missing ownership migration ${OWNERSHIP_MIGRATION_TAG}.`);
		}
		predecessorMigrationCount = ownershipMigrationIndex + 1;
		initialMigrationsFolder = await createMigrationFolderThrough(1, journal);
		mainMigrationsFolder = await createMigrationFolderThrough(3, journal);
		ownershipPredecessorMigrationsFolder = await createMigrationFolderThrough(
			ownershipMigrationIndex,
			journal,
		);
		predecessorMigrationsFolder = await createMigrationFolderThrough(
			predecessorMigrationCount,
			journal,
		);
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
			if (ownershipPredecessorMigrationsFolder) {
				await rm(ownershipPredecessorMigrationsFolder, { force: true, recursive: true });
			}
			if (predecessorMigrationsFolder) {
				await rm(predecessorMigrationsFolder, { force: true, recursive: true });
			}
		} finally {
			if (container) {
				await container.stop();
			}
		}
	}, 60_000);

	it("upgrades historical schemas and removes unrecoverable execution records", async () => {
		const migrationOptions = {
			migrationsSchema: "drizzle",
			migrationsTable: "app_api_migrations",
		};
		await applyLegacyBetterAuthBaseline(pool);
		await seedLegacyBetterAuthData(pool);
		await migrate(drizzle(pool), {
			...migrationOptions,
			migrationsFolder: initialMigrationsFolder,
		});
		await applyLegacyChatBaseline(pool);
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
				 "created_at", "completed_at", "updated_at")
			values ('request-upgrade', 'conversation-upgrade', 'message-upgrade', 1, 'web',
				'user-upgrade', 'user-upgrade', '{}'::jsonb, 'trace-upgrade', 'completed',
				'2026-07-23T00:00:00Z', '2026-07-23T00:02:00Z', '2026-07-23T00:03:00Z');
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
			migrationsFolder: predecessorMigrationsFolder,
		});
		const deployedPredecessorLedger = await pool.query<{ count: string }>(
			`select count(*)::text as count from "drizzle"."app_api_migrations"`,
		);
		expect(deployedPredecessorLedger.rows[0]?.count).toBe(String(predecessorMigrationCount));
		await pool.query(`
			update "chat"."turn_dispatches"
			set "run_id" = 'run-upgrade',
			    "workflow_id" = 'workflow-upgrade',
			    "admission_status" = 'admitted',
			    "execution_input_json" = '{"goal":"retained"}',
			    "execution_input_sha256" = repeat('d', 64),
			    "execution_input_released_at" = null
			where "request_id" = 'request-upgrade';

			insert into "chat"."messages"
				("id", "conversation_id", "role", "text", "created_at", "turn_sequence")
			values ('message-invalid', 'conversation-upgrade', 'user', 'invalid dispatch', now(), 2);
			insert into "chat"."turn_dispatches"
				("request_id", "conversation_id", "user_message_id", "assistant_message_id",
				 "turn_sequence", "surface", "owner_user_id", "actor_user_id",
				 "principal_snapshot_json", "trace_id", "run_id", "workflow_id",
				 "admission_status", "execution_input_released_at", "status", "created_at", "completed_at", "updated_at")
			values ('request-invalid', 'conversation-upgrade', 'message-invalid', 'assistant-invalid',
				2, 'web', 'user-upgrade', 'user-upgrade', '{}'::jsonb, 'trace-invalid',
				'run-invalid', 'workflow-invalid', 'admitted', now(), 'completed', now(), now(), now());
			insert into "runtime"."request_observability_fact"
				("request_id", "trace_id", "conversation_id", "surface", "principal_type", "status",
				 "started_at", "measured_at", "updated_at")
			values ('request-invalid', 'trace-invalid', 'conversation-upgrade', 'web', 'user', 'completed',
				now(), now(), now());
			update "chat"."conversations"
			set "active_run_id" = 'run-invalid'
			where "id" = 'conversation-upgrade';
		`);

		await installAppApiSchema({
			APP_API_SCHEMA_DATABASE_SSLMODE: "disable",
			APP_API_SCHEMA_DATABASE_URL: container.getConnectionUri(),
		});

		const migratedExecutionRecords = await pool.query<{
			active_run_id: string | null;
			invalid_dispatch_count: string;
			invalid_fact_count: string;
			retained_conversation_count: string;
			retained_dispatch_count: string;
			retained_message_count: string;
		}>(`
			select
				(select "active_run_id" from "chat"."conversations" where "id" = 'conversation-upgrade') as active_run_id,
				(select count(*)::text from "chat"."conversations" where "id" = 'conversation-upgrade') as retained_conversation_count,
				(select count(*)::text from "chat"."messages" where "id" in ('message-upgrade', 'message-invalid')) as retained_message_count,
				(select count(*)::text from "chat"."turn_dispatches" where "request_id" = 'request-upgrade') as retained_dispatch_count,
				(select count(*)::text from "chat"."turn_dispatches" where "request_id" = 'request-invalid') as invalid_dispatch_count,
				(select count(*)::text from "runtime"."request_observability_fact" where "request_id" = 'request-invalid') as invalid_fact_count
		`);
		expect(migratedExecutionRecords.rows).toEqual([
			{
				active_run_id: null,
				invalid_dispatch_count: "0",
				invalid_fact_count: "0",
				retained_conversation_count: "1",
				retained_dispatch_count: "1",
				retained_message_count: "2",
			},
		]);
		const upgradedChatColumns = await pool.query<{ column_name: string }>(`
			select column_name
			from information_schema.columns
			where table_schema = 'chat'
			  and table_name = 'turn_dispatches'
			  and column_name in (
				'assistant_message_id', 'memory_append_enabled', 'memory_owner_generation',
				'memory_owner_sequence', 'memory_recall_enabled', 'requested_scope',
				'resolved_targets_json', 'version_query_json'
			  )
			order by column_name
		`);
		expect(upgradedChatColumns.rows.map(({ column_name: columnName }) => columnName)).toEqual([
			"assistant_message_id",
			"memory_append_enabled",
			"memory_owner_generation",
			"memory_owner_sequence",
			"memory_recall_enabled",
		]);
		const retiredColumns = await pool.query<{ qualified_name: string }>(`
			select table_schema || '.' || table_name || '.' || column_name as qualified_name
			from information_schema.columns
			where (table_schema, table_name) in (
			        ('chat', 'conversations'),
			        ('chat', 'turn_dispatches'),
			        ('runtime', 'request_observability_fact')
			      )
			  and column_name in (
			    'context_summary',
			    'requested_tool',
			    'resolved_targets_json',
			    'selected_tool',
			    'execution_input_released_at',
			    'workflow_input_json',
			    'workflow_input_sha256'
			  )
			order by qualified_name
		`);
		expect(retiredColumns.rows).toEqual([]);

		const retainedIdentity = await pool.query<{
			banned: boolean;
			impersonated_by: string | null;
			password: string | null;
			password_change_required: boolean;
			role: string | null;
			temporary_password_expires_at: Date | null;
			token: string;
		}>(`
			select u."role", u."banned",
			       u."passwordChangeRequired" as password_change_required,
			       u."temporaryPasswordExpiresAt" as temporary_password_expires_at,
			       a."password", s."token", s."impersonatedBy" as impersonated_by
			from "app_auth"."user" u
			join "app_auth"."account" a on a."userId" = u."id"
			join "app_auth"."session" s on s."userId" = u."id"
			where u."id" = 'legacy-user'
		`);
		expect(retainedIdentity.rows).toEqual([
			{
				banned: false,
				impersonated_by: null,
				password: "legacy-password",
				password_change_required: false,
				role: "user",
				temporary_password_expires_at: null,
				token: "legacy-token",
			},
		]);
		const retainedOAuth = await pool.query<{
			access_token: string;
			client_id: string;
			consent_id: string;
			refresh_token: string;
		}>(`
			select client."clientId" as client_id,
			       refresh."token" as refresh_token,
			       access."token" as access_token,
			       consent."id" as consent_id
			from "app_auth"."oauthClient" client
			join "app_auth"."oauthRefreshToken" refresh
			  on refresh."clientId" = client."clientId"
			join "app_auth"."oauthAccessToken" access
			  on access."refreshId" = refresh."id"
			join "app_auth"."oauthConsent" consent
			  on consent."clientId" = client."clientId"
			where client."id" = 'legacy-client-row'
		`);
		expect(retainedOAuth.rows).toEqual([
			{
				access_token: "legacy-access-token",
				client_id: "legacy-client",
				consent_id: "legacy-consent-row",
				refresh_token: "legacy-refresh-token",
			},
		]);
		const authShape = await pool.query<{
			new_index_count: string;
			old_index_count: string;
			password_change_nullable: string;
			rate_limit_ready: boolean;
		}>(`
			select
				to_regclass('app_auth."rateLimit"') is not null as rate_limit_ready,
				(select is_nullable from information_schema.columns
				 where table_schema = 'app_auth' and table_name = 'user'
				   and column_name = 'passwordChangeRequired') as password_change_nullable,
				(select count(*)::text from pg_indexes
				 where schemaname = 'app_auth'
				   and indexname in (
					'account_userId_idx', 'oauthAccessToken_token_uidx',
					'oauthClient_clientId_uidx', 'oauthRefreshToken_token_uidx',
					'session_token_uidx', 'session_user_id_expires_at_idx', 'user_email_uidx'
				   )) as new_index_count,
				(select count(*)::text from pg_indexes
				 where schemaname = 'app_auth'
				   and indexname in (
					'oauthAccessToken_token_key', 'oauthClient_clientId_key',
					'oauthRefreshToken_token_key', 'session_token_key',
					'session_userId_idx', 'user_email_key'
				   )) as old_index_count
		`);
		expect(authShape.rows).toEqual([
			{
				new_index_count: "7",
				old_index_count: "0",
				password_change_nullable: "NO",
				rate_limit_ready: true,
			},
		]);
		const authForeignKeys = await pool.query<{
			column_name: string;
			constraint_name: string;
			delete_action: string;
			referenced_column: string;
			referenced_table: string;
			table_name: string;
		}>(`
			select constraint_row.conname as constraint_name,
			       relation.relname as table_name,
			       source_attribute.attname as column_name,
			       referenced_relation.relname as referenced_table,
			       referenced_attribute.attname as referenced_column,
			       case constraint_row.confdeltype
			         when 'a' then 'NO ACTION'
			         when 'r' then 'RESTRICT'
			         when 'c' then 'CASCADE'
			         when 'n' then 'SET NULL'
			         when 'd' then 'SET DEFAULT'
			       end as delete_action
			from pg_constraint constraint_row
			join pg_class relation on relation.oid = constraint_row.conrelid
			join pg_namespace namespace on namespace.oid = relation.relnamespace
			join pg_class referenced_relation on referenced_relation.oid = constraint_row.confrelid
			join lateral unnest(constraint_row.conkey) with ordinality
			  as source_key(attnum, position) on true
			join lateral unnest(constraint_row.confkey) with ordinality
			  as referenced_key(attnum, position) on referenced_key.position = source_key.position
			join pg_attribute source_attribute
			  on source_attribute.attrelid = relation.oid
			 and source_attribute.attnum = source_key.attnum
			join pg_attribute referenced_attribute
			  on referenced_attribute.attrelid = referenced_relation.oid
			 and referenced_attribute.attnum = referenced_key.attnum
			where namespace.nspname = 'app_auth'
			  and constraint_row.contype = 'f'
			  and relation.relname in (
				'account', 'oauthAccessToken', 'oauthClient', 'oauthConsent',
				'oauthRefreshToken', 'session'
			  )
			order by constraint_row.conname collate "C", source_key.position
		`);
		expect(authForeignKeys.rows).toEqual(EXPECTED_AUTH_FOREIGN_KEYS);

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
			from unnest(array['campus_services', 'campus_services_ops', 'identity', 'observability', 'official_web', 'operator', 'provider_config', 'wechat_official_account']) schema_name
			where to_regnamespace(schema_name) is not null
		`);
		expect(retired.rows).toEqual([]);

		await installAppApiSchema({
			APP_API_SCHEMA_DATABASE_SSLMODE: "disable",
			APP_API_SCHEMA_DATABASE_URL: container.getConnectionUri(),
		});
		const ledger = await pool.query<{ count: string }>(
			`select count(*)::text as count from "drizzle"."app_api_migrations"`,
		);
		expect(ledger.rows[0]?.count).toBe(String(fullMigrationCount));
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
		await installAppApiSchema({
			APP_API_SCHEMA_DATABASE_SSLMODE: "disable",
			APP_API_SCHEMA_DATABASE_URL: container.getConnectionUri(),
		});
		const cleanInstall = await pool.query<{
			assistant_message_id: string | null;
			auth_rate_limit_ready: boolean;
			auth_session_ready: boolean;
			auth_user_ready: boolean;
			campus_groups_ready: boolean;
			campus_group_sections_ready: boolean;
			memory_commands_ready: boolean;
			retired_column_count: string;
		}>(`
				select
					to_regclass('app_auth."user"') is not null as auth_user_ready,
					to_regclass('app_auth."session"') is not null as auth_session_ready,
					to_regclass('app_auth."rateLimit"') is not null as auth_rate_limit_ready,
					to_regclass('campus_groups.groups') is not null as campus_groups_ready,
					to_regclass('campus_groups.sections') is not null as campus_group_sections_ready,
				to_regclass('profile.memory_commands') is not null as memory_commands_ready,
				(select column_name from information_schema.columns
				 where table_schema = 'chat' and table_name = 'turn_dispatches'
				   and column_name = 'assistant_message_id') as assistant_message_id,
				(select count(*)::text from information_schema.columns
				 where (table_schema, table_name) in (
				         ('chat', 'conversations'),
				         ('chat', 'turn_dispatches'),
				         ('runtime', 'request_observability_fact')
				       )
				   and column_name in (
				     'context_summary', 'requested_tool', 'resolved_targets_json', 'selected_tool'
				   )) as retired_column_count
		`);
		expect(cleanInstall.rows).toEqual([
			{
				assistant_message_id: "assistant_message_id",
				auth_rate_limit_ready: true,
				auth_session_ready: true,
				auth_user_ready: true,
				campus_group_sections_ready: true,
				campus_groups_ready: true,
				memory_commands_ready: true,
				retired_column_count: "0",
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

	it("rejects app-owned partial state before creating a migration ledger", async () => {
		await resetDisposableDatabase(pool);
		await pool.query('create schema "chat"');

		await expect(
			installAppApiSchema({
				APP_API_SCHEMA_DATABASE_SSLMODE: "disable",
				APP_API_SCHEMA_DATABASE_URL: container.getConnectionUri(),
			}),
		).rejects.toThrow("refusing an unknown partial bootstrap");
		await expect(
			pool.query(`select to_regclass('drizzle.app_api_migrations') as ledger`),
		).resolves.toMatchObject({ rows: [{ ledger: null }] });
	});

	it("rejects an applied migration whose SQL content changed", async () => {
		await resetDisposableDatabase(pool);
		await installAppApiSchema({
			APP_API_SCHEMA_DATABASE_SSLMODE: "disable",
			APP_API_SCHEMA_DATABASE_URL: container.getConnectionUri(),
		});
		await pool.query(
			`update drizzle.app_api_migrations
			 set hash = repeat('0', 64)
			 where created_at = (select min(created_at) from drizzle.app_api_migrations)`,
		);

		await expect(
			installAppApiSchema({
				APP_API_SCHEMA_DATABASE_SSLMODE: "disable",
				APP_API_SCHEMA_DATABASE_URL: container.getConnectionUri(),
			}),
		).rejects.toThrow("app-api migration was modified after apply");
	});

	it("rejects the ownership migration while a v2 run is nonterminal", async () => {
		const migrationOptions = {
			migrationsSchema: "drizzle",
			migrationsTable: "app_api_migrations",
		};
		await resetDisposableDatabase(pool);
		await applyLegacyBetterAuthBaseline(pool);
		await migrate(drizzle(pool), {
			...migrationOptions,
			migrationsFolder: initialMigrationsFolder,
		});
		await applyLegacyChatBaseline(pool);
		await pool.query(`
			insert into "chat"."conversations"
				("id", "owner_user_id", "title", "created_at", "updated_at")
			values ('conversation-pending-v2', 'user-pending-v2', 'Pending v2', now(), now());
			insert into "chat"."messages"
				("id", "conversation_id", "role", "text", "created_at")
			values ('message-pending-v2', 'conversation-pending-v2', 'user', 'test', now());
			insert into "chat"."turn_dispatches"
				("request_id", "conversation_id", "user_message_id", "turn_sequence", "surface",
				 "owner_user_id", "actor_user_id", "principal_snapshot_json", "trace_id", "status",
				 "created_at", "updated_at")
			values ('request-pending-v2', 'conversation-pending-v2', 'message-pending-v2', 1, 'web',
				'user-pending-v2', 'user-pending-v2', '{}'::jsonb, 'trace-pending-v2', 'running',
				now(), now());
		`);
		await migrate(drizzle(pool), {
			...migrationOptions,
			migrationsFolder: ownershipPredecessorMigrationsFolder,
		});
		await pool.query(`
			update "chat"."turn_dispatches"
			set "workflow_input_json" = '{"request_id":"request-pending-v2"}'::jsonb,
			    "workflow_input_sha256" = repeat('a', 64)
			where "request_id" = 'request-pending-v2'
		`);

		let migrationError: unknown;
		try {
			await migrate(drizzle(pool), {
				...migrationOptions,
				migrationsFolder: fullMigrationsFolder,
			});
		} catch (error) {
			migrationError = error;
		}
		expect(errorChainText(migrationError)).toContain(
			"tool_execution_v3 migration requires all v2 chat runs to be in a contract terminal status",
		);

		const journal = await readMigrationJournal();
		const ownershipMigration = journal.entries.find(
			(entry) => entry.tag === "0007_execution_runtime_ownership",
		);
		expect(ownershipMigration).toBeDefined();
		const rollbackState = await pool.query<{
			admission_input_present: boolean;
			admission_status: string;
			nonterminal_rows: string;
			ownership_migration_rows: string;
			workflow_input_present: boolean;
		}>(
			`select
				(select count(*)::text from "chat"."turn_dispatches"
				 where "request_id" = 'request-pending-v2' and "status" = 'running')
				   as nonterminal_rows,
				(select "admission_status" from "chat"."turn_dispatches"
				 where "request_id" = 'request-pending-v2') as admission_status,
				exists(select 1 from information_schema.columns
				 where table_schema = 'chat' and table_name = 'turn_dispatches'
				   and column_name = 'workflow_input_json') as workflow_input_present,
				exists(select 1 from information_schema.columns
				 where table_schema = 'chat' and table_name = 'turn_dispatches'
				   and column_name = 'admission_input_json') as admission_input_present,
				(select count(*)::text from "drizzle"."app_api_migrations"
				 where created_at = $1::bigint) as ownership_migration_rows`,
			[ownershipMigration?.when],
		);
		expect(rollbackState.rows).toEqual([
			{
				admission_input_present: false,
				admission_status: "pending_input",
				nonterminal_rows: "1",
				ownership_migration_rows: "0",
				workflow_input_present: true,
			},
		]);
	});
});
