// @vitest-environment node

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
	applyDiningDatabase,
	applyOpsWebDatabaseGrants,
	verifyOpsWebDatabase,
} from "../ops/db/ops-web-database.ts";
import { hashAutomationToken } from "../src/server/internal-portal-automation-token-service.ts";
import { createPgInternalPortalAutomationTokenStore } from "../src/server/internal-portal-automation-token-store.ts";
import {
	createPgInternalPortalCredentialStore,
	InternalPortalCredentialConflictError,
	InternalPortalCredentialNameConflictError,
} from "../src/server/internal-portal-credential-store.ts";
import {
	createPgOpsStatusStore,
	createPgOpsStatusStoreDatabase,
} from "../src/server/pg-ops-status-store.ts";
import { installNoticeSchema } from "./ops-web-postgres.global-setup.ts";

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

async function postgresErrorCode(query: Promise<unknown>): Promise<string | undefined> {
	try {
		await query;
		return;
	} catch (error) {
		return error instanceof Error && "code" in error && typeof error.code === "string"
			? error.code
			: undefined;
	}
}

function requiredClient(client: Client | undefined, name: string): Client {
	if (!client) {
		throw new Error(`${name} test client is unavailable`);
	}
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

describe("ops-web PostgreSQL grants", () => {
	let applyResult: Awaited<ReturnType<typeof applyOpsWebDatabaseGrants>>;
	let management: Client;
	let opsWeb: Client | undefined;
	let verifyResult: Awaited<ReturnType<typeof verifyOpsWebDatabase>>;

	beforeAll(async () => {
		management = await connect(postgres.managementConnectionString);
		applyResult = await applyOpsWebDatabaseGrants(databaseEnv);
		verifyResult = await verifyOpsWebDatabase(databaseEnv);
		opsWeb = await connect(postgres.opsWebConnectionString);
	});

	afterAll(async () => {
		await Promise.all([management.end(), opsWeb?.end()]);
	});

	it("applies and verifies the read-model grant contract", () => {
		expect(applyResult).toEqual({
			diningMap: "ready",
			internalPortal: "ready",
			opsWebRole: "ready",
			readModel: "ready",
		});
		expect(verifyResult).toEqual({
			diningMap: "ready",
			internalPortal: "ready",
			opsWebRole: "ready",
			readModel: "ready",
		});
	});

	it("owns credentials through the Ops Web runtime role after the handoff", async () => {
		const runtime = requiredClient(opsWeb, "ops_web");
		const store = createPgInternalPortalCredentialStore(runtime);
		const credentialId = randomUUID();
		try {
			await expect(
				store.create({
					credentialId,
					name: "Ops Web 数据库测试凭据",
					now: new Date("2026-08-23T01:00:00.000Z"),
					ssoTgc: "TGT-ops-web-database-test",
				}),
			).resolves.toMatchObject({ credentialId, version: 1 });
			await expect(store.list()).resolves.toContainEqual(
				expect.objectContaining({ credentialId, ssoTgc: "TGT-ops-web-database-test" }),
			);
			await expect(
				store.create({
					credentialId: randomUUID(),
					name: "Ops Web 数据库测试凭据",
					now: new Date("2026-08-23T01:05:00.000Z"),
					ssoTgc: "TGT-duplicate",
				}),
			).rejects.toBeInstanceOf(InternalPortalCredentialNameConflictError);
			await expect(
				store.rotate({
					attemptedAt: new Date("2026-08-23T01:10:00.000Z"),
					credentialId,
					expectedVersion: 2,
					ssoTgc: "TGT-stale",
				}),
			).rejects.toBeInstanceOf(InternalPortalCredentialConflictError);
		} finally {
			await management.query("delete from internal_portal.credentials where credential_id = $1", [
				credentialId,
			]);
		}
		const retired = await management.query(`select
			to_regnamespace('ingestion_control')::text as "legacySchema",
			to_regclass('internal_portal.credentials')::text as "credentials"`);
		expect(retired.rows[0]).toEqual({
			credentials: "internal_portal.credentials",
			legacySchema: null,
		});
	});

	it("persists multiple automation tokens and rejects revoked token authentication", async () => {
		const runtime = requiredClient(opsWeb, "ops_web");
		const store = createPgInternalPortalAutomationTokenStore(runtime);
		const tokenId = randomUUID();
		const tokenValue = "ops_database_integration";
		const createdAt = new Date("2026-08-06T01:00:00.000Z");
		try {
			await expect(
				store.create({
					createdAt,
					name: "数据库集成测试",
					tokenHash: hashAutomationToken(tokenValue),
					tokenId,
					tokenValue,
				}),
			).resolves.toMatchObject({ tokenId, tokenValue });
			await expect(store.list()).resolves.toContainEqual({
				createdAt: createdAt.toISOString(),
				name: "数据库集成测试",
				revokedAt: null,
				tokenId,
			});
			await expect(store.authenticate(hashAutomationToken(tokenValue))).resolves.toMatchObject({
				tokenId,
			});
			await expect(store.get(tokenId)).resolves.toMatchObject({ tokenValue });

			await store.revoke(tokenId, new Date("2026-08-06T02:00:00.000Z"));
			await expect(store.authenticate(hashAutomationToken(tokenValue))).resolves.toBeNull();
			await expect(store.get(tokenId)).resolves.toMatchObject({ tokenValue });
		} finally {
			await management.query("delete from internal_portal.automation_tokens where token_id = $1", [
				tokenId,
			]);
		}
	});

	it("owns only the seven current Dining tables", async () => {
		const tables = await management.query<{ table_name: string }>(`
			select table_name
			from information_schema.tables
			where table_schema = 'dining' and table_type = 'BASE TABLE'
			order by table_name
		`);
		expect(tables.rows.map((row) => row.table_name)).toEqual([
			"map_draft",
			"map_publication",
			"map_releases",
			"menu_items",
			"review_edits",
			"review_reports",
			"reviews",
		]);
	});

	it("allows Ops Web writes and limits App API to public content operations", async () => {
		const runtime = requiredClient(opsWeb, "ops_web");
		await runtime.query("begin");
		try {
			await expect(
				runtime.query(
					`insert into dining.map_draft
					 (scope, bundle_json, fingerprint, revision, updated_at, updated_by)
					 values ('global', '{}'::jsonb, $1, 1, now(), 'test')
					 on conflict (scope) do update set updated_at = excluded.updated_at`,
					[`sha256:${"a".repeat(64)}`],
				),
			).resolves.toBeDefined();
		} finally {
			await runtime.query("rollback");
		}

		const privileges = await management.query(`select
			has_table_privilege('app_api', 'dining.map_draft', 'SELECT') as "canReadDraft",
			has_table_privilege('app_api', 'dining.map_releases', 'SELECT') as "canReadReleases",
			has_table_privilege('app_api', 'dining.map_publication', 'SELECT') as "canReadPublication",
			has_table_privilege('app_api', 'dining.map_releases', 'INSERT,UPDATE,DELETE') as "canMutateReleases",
			has_table_privilege('app_api', 'dining.menu_items', 'SELECT') as "canReadMenu",
			has_table_privilege('app_api', 'dining.menu_items', 'INSERT,UPDATE,DELETE') as "canMutateMenu",
			has_table_privilege('app_api', 'dining.reviews', 'SELECT,INSERT,UPDATE') as "canUseReviews",
			has_table_privilege('app_api', 'dining.reviews', 'DELETE') as "canDeleteReviews",
			has_table_privilege('app_api', 'dining.review_reports', 'SELECT,INSERT') as "canUseReports",
			has_table_privilege('app_api', 'dining.review_reports', 'UPDATE,DELETE') as "canResolveReports",
			has_table_privilege('app_api', 'dining.review_edits', 'SELECT,INSERT,UPDATE,DELETE') as "canUseEdits"`);
		expect(privileges.rows[0]).toEqual({
			canDeleteReviews: false,
			canMutateMenu: false,
			canMutateReleases: false,
			canReadDraft: false,
			canReadMenu: true,
			canReadPublication: true,
			canReadReleases: true,
			canResolveReports: false,
			canUseEdits: false,
			canUseReports: true,
			canUseReviews: true,
		});
	});

	it("preserves Dining content when schema and grants are applied again", async () => {
		await management.query(`
			insert into dining.menu_items
			 (menu_item_id, window_id, name, price_text, sort_order, created_at, created_by, updated_at, updated_by)
			 values ('dmi_preserve', 'hall:floor:window-01', '保留菜品', '10 元', 0, now(), 'test', now(), 'test');
			insert into dining.reviews
			 (review_id, menu_item_id, author_kind, author_id, author_display_name, anonymous, body,
			  idempotency_key, submission_date, created_at, updated_at, updated_by)
			 values ('drv_preserve', 'dmi_preserve', 'member', 'user_preserve', '测试用户', true,
			  '保留评价', 'preserve-key', current_date, now(), now(), 'user_preserve');
			insert into dining.review_reports
			 (report_id, review_id, reporter_user_id, reason, details, created_at)
			 values ('drp_preserve', 'drv_preserve', 'user_reporter', 'other', null, now());
			insert into dining.review_edits
			 (edit_id, review_id, previous_body, next_body, edited_at, edited_by)
			 values ('dre_preserve', 'drv_preserve', '旧正文', '保留评价', now(), 'test');
		`);

		await applyOpsWebDatabaseGrants(databaseEnv);

		const counts = await management.query(`select
			(select count(*)::int from dining.menu_items where menu_item_id = 'dmi_preserve') as menu,
			(select count(*)::int from dining.reviews where review_id = 'drv_preserve') as reviews,
			(select count(*)::int from dining.review_reports where report_id = 'drp_preserve') as reports,
			(select count(*)::int from dining.review_edits where edit_id = 'dre_preserve') as edits`);
		expect(counts.rows[0]).toEqual({ edits: 1, menu: 1, reports: 1, reviews: 1 });
	});

	it("projects request status separately from execution-stage failures", async () => {
		const runtime = requiredClient(opsWeb, "ops_web");
		const suffix = randomUUID().replaceAll("-", "");
		const conversationId = `ops_status_${suffix}`;
		const requestIds = [
			`ops_status_answer_${suffix}`,
			`ops_status_tool_${suffix}`,
			`ops_status_missing_${suffix}`,
			`ops_status_failed_${suffix}`,
			`ops_status_waiting_${suffix}`,
		];
		const answerRequestId = requestIds[0];
		const toolRequestId = requestIds[1];
		if (!(answerRequestId && toolRequestId)) {
			throw new Error("request fixture IDs are incomplete");
		}
		const userMessageIds = requestIds.map((requestId) => `${requestId}:user`);
		const assistantMessageIds = [
			`${requestIds[0]}:assistant`,
			`${requestIds[1]}:assistant`,
			`${requestIds[3]}:assistant`,
			`${requestIds[4]}:assistant`,
		];
		const generatedAt = new Date("2026-08-30T01:00:00.000Z");
		const answerStartedAt = new Date("2026-08-30T00:59:00.000Z");
		const toolStartedAt = new Date("2026-08-30T00:58:00.000Z");
		const missingStartedAt = new Date("2026-08-30T00:57:00.000Z");
		const failedStartedAt = new Date("2026-08-30T00:56:00.000Z");
		const waitingStartedAt = new Date("2026-08-30T00:55:00.000Z");

		try {
			await management.query(
				`insert into chat.conversations
					(id, owner_user_id, title, created_at, updated_at)
				 values ($1, 'ops-status-test', 'Ops status integration test', $2, $2)`,
				[conversationId, answerStartedAt],
			);

			for (const [index, requestId] of requestIds.entries()) {
				const startedAt = [
					answerStartedAt,
					toolStartedAt,
					missingStartedAt,
					failedStartedAt,
					waitingStartedAt,
				][index];
				await management.query(
					`insert into chat.messages
						(id, conversation_id, role, kind, text, created_at, request_id)
					 values ($1, $2, 'user', null, $3, $4, $5)`,
					[userMessageIds[index], conversationId, `问题 ${requestId}`, startedAt, requestId],
				);
			}

			const assistantMessages = [
				{
					createdAt: new Date("2026-08-30T00:59:04.000Z"),
					id: assistantMessageIds[0],
					kind: "answer",
					requestId: requestIds[0],
					text: `回答 ${requestIds[0]}`,
				},
				{
					createdAt: new Date("2026-08-30T00:58:05.000Z"),
					id: assistantMessageIds[1],
					kind: "answer",
					requestId: requestIds[1],
					text: `回答 ${requestIds[1]}`,
				},
				{
					createdAt: new Date("2026-08-30T00:56:05.000Z"),
					id: assistantMessageIds[2],
					kind: "error",
					requestId: requestIds[3],
					text: "当前暂时无法完成查询。",
				},
				{
					createdAt: new Date("2026-08-30T00:55:05.000Z"),
					id: assistantMessageIds[3],
					kind: "error",
					requestId: requestIds[4],
					text: "请补充要查询的具体事项。",
				},
			];
			for (const assistant of assistantMessages) {
				await management.query(
					`insert into chat.messages
						(id, conversation_id, role, kind, text, created_at, request_id)
					 values ($1, $2, 'assistant', $3, $4, $5, $6)`,
					[
						assistant.id,
						conversationId,
						assistant.kind,
						assistant.text,
						assistant.createdAt,
						assistant.requestId,
					],
				);
			}

			const dispatches = [
				{
					assistantMessageId: assistantMessageIds[0],
					completedAt: new Date("2026-08-30T00:59:04.000Z"),
					requestId: requestIds[0],
					startedAt: answerStartedAt,
					status: "completed",
				},
				{
					assistantMessageId: assistantMessageIds[1],
					completedAt: new Date("2026-08-30T00:58:05.000Z"),
					requestId: requestIds[1],
					startedAt: toolStartedAt,
					status: "completed",
				},
				{
					assistantMessageId: `${requestIds[2]}:assistant-missing`,
					completedAt: new Date("2026-08-30T00:57:05.000Z"),
					requestId: requestIds[2],
					startedAt: missingStartedAt,
					status: "completed",
				},
				{
					assistantMessageId: assistantMessageIds[2],
					completedAt: new Date("2026-08-30T00:56:05.000Z"),
					requestId: requestIds[3],
					startedAt: failedStartedAt,
					status: "error",
				},
				{
					assistantMessageId: assistantMessageIds[3],
					completedAt: null,
					requestId: requestIds[4],
					startedAt: waitingStartedAt,
					status: "approval_required",
				},
			];
			for (const [index, dispatch] of dispatches.entries()) {
				await management.query(
					`insert into chat.turn_dispatches
						(request_id, conversation_id, user_message_id, assistant_message_id, turn_sequence,
						 surface, owner_user_id, actor_user_id, principal_snapshot_json, status,
						 created_at, completed_at, updated_at)
					 values ($1, $2, $3, $4, $5, 'campus_web', 'ops-status-test', 'ops-status-test', '{}'::jsonb,
						 $6, $7, $8, $9)`,
					[
						dispatch.requestId,
						conversationId,
						userMessageIds[index],
						dispatch.assistantMessageId,
						index + 1,
						dispatch.status,
						dispatch.startedAt,
						dispatch.completedAt,
						index === 0
							? new Date("2026-08-30T00:59:10.000Z")
							: (dispatch.completedAt ?? dispatch.startedAt),
					],
				);
			}

			for (const [index, requestId] of requestIds.slice(0, 2).entries()) {
				const startedAt = index === 0 ? answerStartedAt : toolStartedAt;
				await management.query(
					`insert into execution_control.agent_runs
						(request_id, conversation_id, owner_user_id, surface, task_queue, status, created_at, completed_at, updated_at)
					 values ($1, $2, 'ops-status-test', 'campus_web', 'ops-status-test', 'completed', $3, $4, $5)`,
					[
						requestId,
						conversationId,
						startedAt,
						new Date(startedAt.valueOf() + 5_000),
						index === 0
							? new Date("2026-08-30T00:59:10.000Z")
							: new Date("2026-08-30T00:58:05.000Z"),
					],
				);
			}

			const steps = [
				{
					completedAt: new Date("2026-08-30T00:59:03.000Z"),
					failure: null,
					requestId: requestIds[0],
					startedAt: new Date("2026-08-30T00:59:01.000Z"),
					status: "completed",
					stepId: "agent.primary",
					stepKind: "agent",
					updatedAt: new Date("2026-08-30T00:59:03.000Z"),
				},
				{
					completedAt: new Date("2026-08-30T00:59:10.000Z"),
					failure: { code: "hindsight_append_failed", operation: "memory.append" },
					requestId: requestIds[0],
					startedAt: new Date("2026-08-30T00:59:09.000Z"),
					status: "failed",
					stepId: "memory.append",
					stepKind: "memory",
					updatedAt: new Date("2026-08-30T00:59:10.000Z"),
				},
				{
					completedAt: new Date("2026-08-30T00:58:02.000Z"),
					failure: { code: "agent_tool_failed", operation: "tool.call" },
					requestId: requestIds[1],
					startedAt: new Date("2026-08-30T00:58:01.000Z"),
					status: "failed",
					stepId: "tool.call",
					stepKind: "tool",
					updatedAt: new Date("2026-08-30T00:58:02.000Z"),
				},
				{
					completedAt: new Date("2026-08-30T00:58:05.000Z"),
					failure: null,
					requestId: requestIds[1],
					startedAt: new Date("2026-08-30T00:58:04.000Z"),
					status: "completed",
					stepId: "finalization.write",
					stepKind: "finalization",
					updatedAt: new Date("2026-08-30T00:58:05.000Z"),
				},
			];
			for (const step of steps) {
				await management.query(
					`insert into execution_control.agent_run_steps
						(step_id, request_id, conversation_id, step_kind, status, started_at, completed_at,
						 updated_at, payload_schema_version, sanitized_payload_json)
					 values ($1, $2, $3, $4, $5, $6, $7, $8, 'ops-status-test.v1', $9::jsonb)`,
					[
						step.stepId,
						step.requestId,
						conversationId,
						step.stepKind,
						step.status,
						step.startedAt,
						step.completedAt,
						step.updatedAt,
						JSON.stringify(step.failure ? { failure: step.failure } : {}),
					],
				);
			}

			const store = createPgOpsStatusStore({
				db: createPgOpsStatusStoreDatabase(runtime as never),
				now: () => generatedAt,
			});
			const detail = await store.getRequestDetail(answerRequestId);
			if (!detail) {
				throw new Error("completed request detail is missing");
			}
			expect(detail.request).toMatchObject({ lifecyclePhase: "FINISHED", status: "COMPLETED" });
			expect(detail.result).toMatchObject({ kind: "answer", state: "WRITTEN" });
			expect(detail.execution.failure).toMatchObject({
				code: "hindsight_append_failed",
				operation: "memory.append",
			});
			expect(detail.execution.stages.map((stage) => stage.kind)).toEqual(["agent", "memory"]);

			const toolDetail = await store.getRequestDetail(toolRequestId);
			if (!toolDetail) {
				throw new Error("tool request detail is missing");
			}
			expect(toolDetail.result).toMatchObject({ kind: "answer", state: "WRITTEN" });
			expect(toolDetail.execution.failure).toMatchObject({
				code: "agent_tool_failed",
				operation: "tool.call",
			});
			expect(toolDetail.execution.stages.map((stage) => stage.kind)).toEqual([
				"tool",
				"finalization",
			]);

			const attention = await store.listRequests({ view: "attention", window: "1h" });
			expect(attention.data.map((request) => request.requestId)).toEqual([
				requestIds[2],
				requestIds[0],
				requestIds[1],
				requestIds[3],
				requestIds[4],
			]);
			expect(attention.data[1]).toMatchObject({
				attentionReason: "EXECUTION_STAGE_FAILED",
				failureKind: "hindsight_append_failed",
				result: { kind: "answer", state: "WRITTEN" },
				status: "COMPLETED",
			});
			expect(attention.statusCounts).toMatchObject({
				actionRequired: 1,
				completed: 3,
				failed: 1,
				total: 5,
			});

			const searched = await store.listRequests({ q: "hindsight_append_failed", window: "1h" });
			expect(searched.data.map((request) => request.requestId)).toEqual([requestIds[0]]);

			const overview = await store.getOverview("1h");
			expect(overview.requests.updatedAt).toBe("2026-08-30T00:59:10.000Z");
		} finally {
			await management.query(
				"delete from chat.turn_dispatches where request_id = any($1::text[])",
				[requestIds],
			);
			await management.query(
				"delete from execution_control.agent_runs where request_id = any($1::text[])",
				[requestIds],
			);
			await management.query("delete from chat.messages where id = any($1::text[])", [
				userMessageIds.concat(assistantMessageIds),
			]);
			await management.query("delete from chat.conversations where id = $1", [conversationId]);
		}
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

			await expect(applyOpsWebDatabaseGrants(env)).resolves.toMatchObject({
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
		const migration = await management.query<{ hash: string; id: number }>(`
			select id, hash from drizzle.ops_web_dining_migrations order by created_at limit 1
		`);
		const applied = migration.rows[0];
		if (!applied) {
			throw new Error("Applied Dining migration is missing");
		}
		await management.query("update drizzle.ops_web_dining_migrations set hash = $1 where id = $2", [
			"tampered",
			applied.id,
		]);
		try {
			await expect(applyDiningDatabase(databaseEnv)).rejects.toThrow(
				"migration was modified after apply",
			);
		} finally {
			await management.query(
				"update drizzle.ops_web_dining_migrations set hash = $1 where id = $2",
				[applied.hash, applied.id],
			);
		}
	});

	it("allows only the declared read-model columns", async () => {
		const runtime = requiredClient(opsWeb, "ops_web");
		await expect(
			runtime.query(
				`select assistant_message_id, completed_at, conversation_id,
					created_at, error_code, request_id, status, updated_at, user_message_id
				 from chat.turn_dispatches limit 0`,
			),
		).resolves.toBeDefined();
		await expect(
			runtime.query("select id, text from chat.messages limit 0"),
		).resolves.toBeDefined();
		await expect(
			runtime.query(
				`select completed_at, fail_close_reason, request_id, status, terminal_reason, updated_at
				 from execution_control.agent_runs limit 0`,
			),
		).resolves.toBeDefined();
		await expect(
			runtime.query(
				`select step_id, request_id, step_kind, status, started_at, completed_at,
					updated_at, sanitized_payload_json
				 from execution_control.agent_run_steps limit 0`,
			),
		).resolves.toBeDefined();
		await expect(
			runtime.query(
				`select step_id, request_id, attempt, status, started_at, completed_at, duration_ms,
					model_provider, model_name, model_request_count, input_tokens, output_tokens,
					cached_input_tokens, usage_observed, fail_close_reason, terminal_reason,
					sanitized_payload_json
				 from execution_control.agent_step_attempts limit 0`,
			),
		).resolves.toBeDefined();

		for (const query of [
			"select * from chat.turn_dispatches limit 0",
			"select owner_user_id from chat.turn_dispatches limit 0",
			"select * from chat.messages limit 0",
			"select * from execution_control.agent_runs limit 0",
			"select runtime_versions_json from execution_control.agent_runs limit 0",
			"select workflow_id from execution_control.agent_step_attempts limit 0",
			"select provider_response_id from execution_control.agent_step_attempts limit 0",
			"select event_id from execution_control.agent_run_events limit 0",
			"select result_id from execution_control.agent_step_results limit 0",
		]) {
			expect(await postgresErrorCode(runtime.query(query))).toBe("42501");
		}
	});

	it("rejects business-table writes", async () => {
		const runtime = requiredClient(opsWeb, "ops_web");
		for (const query of [
			"update chat.turn_dispatches set status = status where false",
			"delete from chat.messages where false",
			"update execution_control.agent_runs set status = status where false",
			"update execution_control.agent_run_steps set status = status where false",
			"delete from execution_control.agent_step_attempts where false",
		]) {
			expect(await postgresErrorCode(runtime.query(query))).toBe("42501");
		}
	});

	it("has no direct Model Config access", async () => {
		const privilege = await management.query<{
			canReadModelConfigs: boolean;
		}>(`select
			coalesce(
				(
					select has_table_privilege('ops_web', relation.oid, 'SELECT')
						or has_any_column_privilege('ops_web', relation.oid, 'SELECT')
					from pg_catalog.pg_class relation
					join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
					where namespace.nspname = 'model_config' and relation.relname = 'model_configs'
				),
				false
			) as "canReadModelConfigs"`);
		expect(privilege.rows[0]).toEqual({
			canReadModelConfigs: false,
		});
	});
});
