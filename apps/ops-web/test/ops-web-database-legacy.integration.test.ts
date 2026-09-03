// @vitest-environment node

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
	applyDiningDatabase,
	applyLegacyOpsWebDatabase,
} from "../ops/db/ops-web-database-legacy.ts";
import { installNoticeSchema } from "./ops-web-postgres-legacy.global-setup.ts";

const postgres = inject("opsWebPostgres");
const databaseEnv = {
	DEPLOYMENT_ENVIRONMENT: "local",
	OPS_WEB_DATABASE_SSLMODE: "disable",
	OPS_WEB_DATABASE_URL: postgres.opsWebConnectionString,
	OPS_WEB_SCHEMA_DATABASE_SSLMODE: "disable",
	OPS_WEB_SCHEMA_DATABASE_URL: postgres.managementConnectionString,
} as const;
const diningMigrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

async function connect(connectionString: string) {
	const client = new Client({ connectionString, ssl: false });
	await client.connect();
	return client;
}

function databaseUrl(connectionString: string, databaseName: string): string {
	const url = new URL(connectionString);
	url.pathname = `/${databaseName}`;
	return url.toString();
}

async function withIsolatedDatabase(
	management: Client,
	run: (context: { env: NodeJS.ProcessEnv; managementUrl: string }) => Promise<void>,
): Promise<void> {
	const databaseName = `ops_web_migration_${randomUUID().replaceAll("-", "")}`;
	await management.query(`create database "${databaseName}"`);
	const managementUrl = databaseUrl(postgres.managementConnectionString, databaseName);
	try {
		await installNoticeSchema(managementUrl);
		await run({
			env: {
				...databaseEnv,
				OPS_WEB_DATABASE_URL: databaseUrl(postgres.opsWebConnectionString, databaseName),
				OPS_WEB_SCHEMA_DATABASE_URL: managementUrl,
			},
			managementUrl,
		});
	} finally {
		await management.query(`drop database "${databaseName}" with (force)`);
	}
}

describe("ops-web legacy PostgreSQL migrations", () => {
	let management: Client;

	beforeAll(async () => {
		management = await connect(postgres.managementConnectionString);
	});

	afterAll(async () => {
		await management.end();
	});
	it("moves the deployed ingestion-control credential table without changing rows", async () => {
		await withIsolatedDatabase(management, async ({ env, managementUrl }) => {
			const current = await connect(managementUrl);
			const credentialId = "11111111-1111-4111-8111-111111111111";
			try {
				const migrations = readMigrationFiles({ migrationsFolder: diningMigrationsFolder });
				for (const migration of migrations.slice(0, 4)) {
					for (const statement of migration.sql) {
						await current.query(statement);
					}
				}
				await current.query(`
					create schema chat;
					create table chat.turn_dispatches (
						assistant_message_id text,
						completed_at timestamptz,
						conversation_id text,
						created_at timestamptz,
						error_code text,
						request_id text,
						status text,
						surface text,
						turn_id text,
						turn_sequence integer,
						updated_at timestamptz,
						user_message_id text,
						owner_user_id text
					);
					create table chat.messages (
						conversation_id text,
						id text,
						kind text,
						request_id text,
						role text,
						structured_parts_json jsonb,
						text text
					);
					create schema runtime;
					create table runtime.request_observability_fact (request_id text);
					create schema execution_control;
					create table execution_control.agent_runs (
						completed_at timestamptz,
						fail_close_reason text,
						request_id text,
						runtime_versions_json jsonb,
						status text,
						terminal_reason text,
						updated_at timestamptz
					);
					create table execution_control.agent_run_events (
						event_id text,
						request_id text,
						payload_json jsonb
					);
					create table execution_control.agent_run_steps (
						step_id text,
						request_id text,
						conversation_id text,
						step_kind text,
						tool text,
						parent_step_id text,
						status text,
						activity_attempt integer,
						task_queue text,
						worker_id text,
						started_at timestamptz,
						completed_at timestamptz,
						updated_at timestamptz,
						payload_schema_version text,
						sanitized_payload_json jsonb,
						created_at timestamptz
					);
					create table execution_control.agent_step_attempts (
						attempt_id text,
						step_id text,
						request_id text,
						attempt integer,
						status text,
						task_queue text,
						worker_id text,
						workflow_id text,
						temporal_run_id text,
						activity_id text,
						activity_type text,
						activity_attempt integer,
						scheduled_at timestamptz,
						started_at timestamptz,
						completed_at timestamptz,
						schedule_to_start_ms bigint,
						duration_ms bigint,
						provider_request_ref text,
						provider_response_id text,
						model_provider text,
						model_name text,
						model_request_count bigint,
						input_tokens bigint,
						output_tokens bigint,
						cached_input_tokens bigint,
						usage_observed boolean,
						cancel_outcome text,
						timeout_outcome text,
						late_completion_outcome text,
						fail_close_reason text,
						terminal_reason text,
						updated_at timestamptz,
						payload_schema_version text,
						sanitized_payload_json jsonb,
						created_at timestamptz
					);
					create table execution_control.agent_step_results (
						result_id text,
						request_id text,
						sanitized_payload_json jsonb
					);
					grant usage on schema execution_control to ops_web;
					grant select (
						completed_at, fail_close_reason, request_id, status, terminal_reason, updated_at
					) on execution_control.agent_runs to ops_web;
					grant select (
						step_id, request_id, step_kind, status, started_at, completed_at, updated_at,
						sanitized_payload_json
					) on execution_control.agent_run_steps to ops_web;
					grant select (
						step_id, request_id, attempt, status, started_at, completed_at, duration_ms,
						model_provider, model_name, model_request_count, input_tokens, output_tokens,
						cached_input_tokens, usage_observed, fail_close_reason, terminal_reason,
						sanitized_payload_json
					) on execution_control.agent_step_attempts to ops_web;
					create schema ingestion_control;
					create table ingestion_control.internal_portal_credentials (
						credential_id text primary key not null,
						name text not null,
						sso_tgc text not null,
						version integer not null,
						created_at timestamptz not null,
						updated_at timestamptz not null,
						last_attempt_at timestamptz,
						last_successful_at timestamptz,
						last_outcome text,
						constraint ingestion_control_internal_portal_credentials_name_check
							check (length(btrim(name)) between 1 and 80),
						constraint ingestion_control_internal_portal_credentials_sso_tgc_check
							check (length(sso_tgc) > 0),
						constraint ingestion_control_internal_portal_credentials_version_check
							check (version > 0),
						constraint ingestion_control_internal_portal_credentials_outcome_check
							check (last_outcome is null or last_outcome in ('valid', 'credential_rejected', 'check_failed'))
					);
					create unique index ingestion_control_internal_portal_credentials_name_uidx
						on ingestion_control.internal_portal_credentials (name);
					create table ingestion_control.schema_migrations (
						migration_id text primary key,
						content_sha256 text not null,
						applied_at timestamptz not null default now()
					);
					drop table internal_portal.credentials;
					create schema drizzle;
					create table drizzle.ops_web_dining_migrations (
						id serial primary key,
						hash text not null,
						created_at bigint
					);
				`);
				await current.query(
					`insert into ingestion_control.internal_portal_credentials (
						credential_id, name, sso_tgc, version, created_at, updated_at,
						last_attempt_at, last_successful_at, last_outcome
					) values ($1, '协作者凭据', 'TGT-before-handoff', 3,
						'2026-08-20T00:00:00Z', '2026-08-22T00:00:00Z',
						'2026-08-22T00:00:00Z', '2026-08-22T00:00:00Z', 'valid')`,
					[credentialId],
				);
				for (const migration of migrations.slice(0, 5)) {
					await current.query(
						"insert into drizzle.ops_web_dining_migrations (hash, created_at) values ($1, $2)",
						[migration.hash, migration.folderMillis],
					);
				}
			} finally {
				await current.end();
			}

			await expect(applyLegacyOpsWebDatabase(env)).resolves.toMatchObject({
				internalPortal: "ready",
			});
			const migrated = await connect(managementUrl);
			try {
				const rows = await migrated.query(`select
					credential_id as "credentialId", name, sso_tgc as "ssoTgc", version,
					created_at as "createdAt", updated_at as "updatedAt",
					last_attempt_at as "lastAttemptAt", last_successful_at as "lastSuccessfulAt",
					last_outcome as "lastOutcome"
				from internal_portal.credentials`);
				expect(rows.rows).toEqual([
					{
						createdAt: new Date("2026-08-20T00:00:00.000Z"),
						credentialId,
						lastAttemptAt: new Date("2026-08-22T00:00:00.000Z"),
						lastOutcome: "valid",
						lastSuccessfulAt: new Date("2026-08-22T00:00:00.000Z"),
						name: "协作者凭据",
						ssoTgc: "TGT-before-handoff",
						updatedAt: new Date("2026-08-22T00:00:00.000Z"),
						version: 3,
					},
				]);
				const state = await migrated.query(`select
					to_regnamespace('ingestion_control')::text as "legacySchema",
					to_regclass('internal_portal.credentials')::text as "credentials"`);
				expect(state.rows[0]).toEqual({
					credentials: "internal_portal.credentials",
					legacySchema: null,
				});
			} finally {
				await migrated.end();
			}
		});
	});

	it("adopts the exact pre-Drizzle Dining schema", async () => {
		await withIsolatedDatabase(management, async ({ env, managementUrl }) => {
			const legacy = await connect(managementUrl);
			try {
				const [initialMigration] = readMigrationFiles({
					migrationsFolder: diningMigrationsFolder,
				});
				if (!initialMigration) {
					throw new Error("Dining initial migration is missing");
				}
				for (const statement of initialMigration.sql) {
					await legacy.query(statement);
				}
			} finally {
				await legacy.end();
			}

			await expect(applyDiningDatabase(env)).resolves.toEqual({ diningMap: "ready" });
			const adopted = await connect(managementUrl);
			try {
				const ledger = await adopted.query<{ count: number }>(`
					select count(*)::int as count from drizzle.ops_web_dining_migrations
				`);
				expect(ledger.rows[0]?.count).toBe(
					readMigrationFiles({ migrationsFolder: diningMigrationsFolder }).length,
				);
			} finally {
				await adopted.end();
			}
		});
	});

	it("rejects unknown partial Dining schemas without a migration ledger", async () => {
		await withIsolatedDatabase(management, async ({ env, managementUrl }) => {
			const partial = await connect(managementUrl);
			try {
				await partial.query(`
					create schema dining;
					create table dining.map_draft (scope text primary key)
				`);
			} finally {
				await partial.end();
			}
			await expect(applyDiningDatabase(env)).rejects.toThrow(
				"refusing an unknown partial bootstrap",
			);
		});
	});

	it("rejects modified applied Dining migrations", async () => {
		await withIsolatedDatabase(management, async ({ env, managementUrl }) => {
			await expect(applyDiningDatabase(env)).resolves.toEqual({ diningMap: "ready" });
			const isolated = await connect(managementUrl);
			try {
				const migration = await isolated.query<{ hash: string; id: number }>(`
					select id, hash from drizzle.ops_web_dining_migrations order by created_at limit 1
				`);
				const applied = migration.rows[0];
				if (!applied) {
					throw new Error("Applied Dining migration is missing");
				}
				await isolated.query(
					"update drizzle.ops_web_dining_migrations set hash = $1 where id = $2",
					["tampered", applied.id],
				);
				try {
					await expect(applyDiningDatabase(env)).rejects.toThrow(
						"migration was modified after apply",
					);
				} finally {
					await isolated.query(
						"update drizzle.ops_web_dining_migrations set hash = $1 where id = $2",
						[applied.hash, applied.id],
					);
				}
			} finally {
				await isolated.end();
			}
		});
	});
});
