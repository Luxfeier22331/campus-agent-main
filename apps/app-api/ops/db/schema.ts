import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
	createAppApiDatabasePool,
	readAppApiDatabaseEnv,
} from "../../src/script-support/shared-db/database.ts";
import { applyAppApiGrants } from "./app-api-grants.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const chatBaselinePath = fileURLToPath(
	new URL("../../drizzle/baseline/chat_pre_0001.sql", import.meta.url),
);
const authBaselinePath = fileURLToPath(
	new URL("../../drizzle/baseline/app_auth_pre_0006.sql", import.meta.url),
);
const PRE_DRIZZLE_CHAT_COLUMNS = {
	conversations: [
		"active_branch_id",
		"active_message_id",
		"active_run_id",
		"active_turn_sequence",
		"archived_at",
		"context_summary",
		"created_at",
		"deleted_at",
		"id",
		"owner_user_id",
		"pinned_at",
		"title",
		"title_updated_at",
		"updated_at",
	],
	message_feedback: [
		"conversation_id",
		"created_at",
		"feedback_id",
		"message_id",
		"owner_user_id",
		"reason_codes_json",
		"request_id",
		"updated_at",
		"vote",
	],
	messages: [
		"branch_id",
		"conversation_id",
		"created_at",
		"id",
		"is_active_branch_head",
		"kind",
		"parent_message_id",
		"request_id",
		"retryable",
		"role",
		"run_id",
		"structured_parts_json",
		"text",
		"turn_sequence",
	],
	session_slots: ["confirmed", "conversation_id", "name", "updated_at", "value"],
	turn_dispatches: [
		"actor_user_id",
		"completed_at",
		"conversation_id",
		"created_at",
		"error_code",
		"idempotency_key",
		"owner_user_id",
		"principal_snapshot_json",
		"request_fingerprint_sha256",
		"request_id",
		"requested_scope",
		"requested_tool",
		"run_id",
		"safety_identifier",
		"selected_tool",
		"status",
		"surface",
		"trace_id",
		"turn_sequence",
		"updated_at",
		"user_message_id",
		"version_query_json",
	],
} as const;
const REQUIRED_TABLES = [
	"app_auth.account_admin_event",
	"app_auth.email_access_grant",
	"app_auth.user",
	"campus_groups.sections",
	"campus_groups.groups",
	"chat.turn_dispatches",
	"runtime.request_observability_fact",
] as const;
const REQUIRED_COLUMNS = [
	"app_auth.rateLimit.id",
	"app_auth.rateLimit.key",
	"app_auth.session.impersonatedBy",
	"app_auth.user.banExpires",
	"app_auth.user.banReason",
	"app_auth.user.banned",
	"app_auth.user.passwordChangeRequired",
	"app_auth.user.role",
	"app_auth.user.temporaryPasswordExpiresAt",
] as const;
const RETIRED_TABLES = ["runtime.projection_outbox", "runtime.request_execution"] as const;
const RETIRED_SCHEMAS = [
	"campus_services_ops",
	"campus_services",
	"identity",
	"observability",
	"official_web",
	"operator",
	"provider_config",
	"docs",
	"wechat_official_account",
] as const;

async function hasAppApiMigrationLedger(
	pool: ReturnType<typeof createAppApiDatabasePool>,
): Promise<boolean> {
	const result = await pool.query<{ present: boolean }>(
		`select to_regclass('drizzle.app_api_migrations') is not null as present`,
	);
	return result.rows[0]?.present === true;
}

async function preparePreDrizzleChatBaseline(
	pool: ReturnType<typeof createAppApiDatabasePool>,
): Promise<void> {
	if (await hasAppApiMigrationLedger(pool)) {
		return;
	}
	const existing = await pool.query<{ present: boolean }>(`
		select
			to_regnamespace('chat') is not null
			or to_regnamespace('app_auth') is not null
			or to_regnamespace('profile') is not null
			or to_regnamespace('campus_groups') is not null
			or to_regclass('docs.releases') is not null
			or to_regclass('runtime.request_observability_fact') is not null
			as present
	`);
	if (existing.rows[0]?.present && !(await hasExactPreDrizzleBaseline(pool))) {
		throw new Error(
			"app-api schema has owned objects without drizzle.app_api_migrations; refusing an unknown partial bootstrap",
		);
	}
	if (existing.rows[0]?.present) {
		return;
	}
	await pool.query("BEGIN");
	try {
		await pool.query(readFileSync(authBaselinePath, "utf8"));
		await pool.query(readFileSync(chatBaselinePath, "utf8"));
		await pool.query("COMMIT");
	} catch (error) {
		await pool.query("ROLLBACK");
		throw error;
	}
}

async function hasExactPreDrizzleBaseline(
	pool: ReturnType<typeof createAppApiDatabasePool>,
): Promise<boolean> {
	const schemas = await pool.query<{ app_auth: boolean; chat: boolean; other_owned: boolean }>(`
		select
			to_regnamespace('app_auth') is not null as app_auth,
			to_regnamespace('chat') is not null as chat,
			to_regnamespace('profile') is not null
				or to_regnamespace('campus_groups') is not null
				or to_regclass('docs.releases') is not null
				or to_regclass('runtime.request_observability_fact') is not null
				as other_owned
	`);
	const schemaState = schemas.rows[0];
	if (!(schemaState?.app_auth && schemaState.chat) || schemaState.other_owned) {
		return false;
	}
	const authTables = await pool.query<{ count: string }>(
		`select count(*)::text from information_schema.tables where table_schema = 'app_auth'`,
	);
	if (authTables.rows[0]?.count !== "0") {
		return false;
	}
	const chatColumns = await pool.query<{ column_name: string; table_name: string }>(`
		select table_name, column_name
		from information_schema.columns
		where table_schema = 'chat'
		order by table_name collate "C", column_name collate "C"
	`);
	const actual = new Map<string, string[]>();
	for (const row of chatColumns.rows) {
		const columns = actual.get(row.table_name) ?? [];
		columns.push(row.column_name);
		actual.set(row.table_name, columns);
	}
	return (
		Object.entries(PRE_DRIZZLE_CHAT_COLUMNS).every(
			([table, columns]) => actual.get(table)?.join(",") === columns.join(","),
		) && actual.size === Object.keys(PRE_DRIZZLE_CHAT_COLUMNS).length
	);
}

async function verifyAppliedMigrationHashes(
	pool: ReturnType<typeof createAppApiDatabasePool>,
): Promise<void> {
	if (!(await hasAppApiMigrationLedger(pool))) {
		return;
	}
	const expected = new Map(
		readMigrationFiles({ migrationsFolder }).map((migration) => [
			String(migration.folderMillis),
			migration.hash,
		]),
	);
	const applied = await pool.query<{ created_at: string; hash: string }>(
		`select created_at::text, hash
		 from drizzle.app_api_migrations
		 order by created_at, id`,
	);
	for (const migration of applied.rows) {
		const expectedHash = expected.get(migration.created_at);
		if (!expectedHash) {
			throw new Error(
				`database contains an unknown app-api migration created_at=${migration.created_at}`,
			);
		}
		if (expectedHash !== migration.hash) {
			throw new Error(
				`app-api migration was modified after apply: created_at=${migration.created_at}`,
			);
		}
	}
}

async function verifySchema(pool: ReturnType<typeof createAppApiDatabasePool>): Promise<void> {
	const required = await pool.query<{ qualified_name: string | null }>(
		`select qualified_name
		 from unnest($1::text[]) as required(qualified_name)
		 where to_regclass(qualified_name) is null`,
		[REQUIRED_TABLES],
	);
	if (required.rows.length > 0) {
		throw new Error(
			`app-api schema is missing required tables: ${required.rows.map((row) => row.qualified_name).join(", ")}`,
		);
	}

	const requiredColumns = await pool.query<{ qualified_name: string }>(
		`select qualified_name
		 from unnest($1::text[]) as required(qualified_name)
		 where not exists (
			select 1
			from information_schema.columns
			where table_schema = split_part(qualified_name, '.', 1)
			  and table_name = split_part(qualified_name, '.', 2)
			  and column_name = split_part(qualified_name, '.', 3)
		 )`,
		[REQUIRED_COLUMNS],
	);
	if (requiredColumns.rows.length > 0) {
		throw new Error(
			`app-api schema is missing required columns: ${requiredColumns.rows
				.map((row) => row.qualified_name)
				.join(", ")}`,
		);
	}

	const retired = await pool.query<{ qualified_name: string }>(
		`select qualified_name
		 from unnest($1::text[]) as retired(qualified_name)
		 where to_regclass(qualified_name) is not null`,
		[RETIRED_TABLES],
	);
	if (retired.rows.length > 0) {
		throw new Error(
			`retired app-api tables are still present: ${retired.rows.map((row) => row.qualified_name).join(", ")}`,
		);
	}

	const retiredSchemas = await pool.query<{ schema_name: string }>(
		`select schema_name
		 from unnest($1::text[]) as retired(schema_name)
		 where to_regnamespace(schema_name) is not null`,
		[RETIRED_SCHEMAS],
	);
	if (retiredSchemas.rows.length > 0) {
		throw new Error(
			`retired app-api schemas are still present: ${retiredSchemas.rows
				.map((row) => row.schema_name)
				.join(", ")}`,
		);
	}

	const privileges = await pool.query<{
		canMutateDispatches: boolean;
		canReadAgentRuns: boolean;
		canWriteObservability: boolean;
		canWriteGroupSections: boolean;
		canWriteGroups: boolean;
	}>(
		`select
			has_table_privilege('app_api', 'chat.turn_dispatches', 'SELECT,INSERT,UPDATE,DELETE') as "canMutateDispatches",
			case
				when to_regclass('runtime.agent_runs') is null then false
				else has_table_privilege('app_api', 'runtime.agent_runs', 'SELECT')
			end as "canReadAgentRuns",
				has_table_privilege('app_api', 'runtime.request_observability_fact', 'SELECT,INSERT,UPDATE,DELETE') as "canWriteObservability",
				has_table_privilege('app_api', 'campus_groups.sections', 'SELECT,INSERT,UPDATE,DELETE') as "canWriteGroupSections",
				has_table_privilege('app_api', 'campus_groups.groups', 'SELECT,INSERT,UPDATE,DELETE') as "canWriteGroups"`,
	);
	const privilege = privileges.rows[0];
	if (
		!(
			privilege?.canMutateDispatches &&
			privilege.canWriteObservability &&
			privilege.canWriteGroupSections &&
			privilege.canWriteGroups
		)
	) {
		throw new Error("app_api role is missing required table privileges.");
	}
	if (privilege.canReadAgentRuns) {
		throw new Error("app_api role must not read execution-control run tables.");
	}
}

export async function migrateAppApiSchema(
	envOverrides: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	const env = readAppApiDatabaseEnv(envOverrides);
	const pool = createAppApiDatabasePool(env);
	try {
		await preparePreDrizzleChatBaseline(pool);
		await verifyAppliedMigrationHashes(pool);
		await migrate(drizzle(pool), {
			migrationsFolder,
			migrationsSchema: "drizzle",
			migrationsTable: "app_api_migrations",
		});
	} finally {
		await pool.end();
	}
}

export async function installAppApiSchema(envOverrides: NodeJS.ProcessEnv = process.env): Promise<{
	schemaReady: true;
}> {
	const env = readAppApiDatabaseEnv(envOverrides);
	const databaseName = decodeURIComponent(new URL(env.databaseUrl).pathname.slice(1));
	await migrateAppApiSchema(envOverrides);
	const pool = createAppApiDatabasePool(env);
	try {
		await pool.query("BEGIN");
		try {
			await applyAppApiGrants(pool, databaseName);
			await pool.query("COMMIT");
		} catch (error) {
			await pool.query("ROLLBACK");
			throw error;
		}
		await verifySchema(pool);
		return {
			schemaReady: true,
		};
	} finally {
		await pool.end();
	}
}

async function main(): Promise<void> {
	const result = await installAppApiSchema();
	console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
