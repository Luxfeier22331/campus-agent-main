// @vitest-environment node

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { applyOpsWebDatabaseGrants, verifyOpsWebDatabase } from "../ops/db/ops-web-database.ts";
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
} from "../src/server/ops-status/store/postgres.ts";

const postgres = inject("opsWebPostgres");
const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const databaseEnv = {
	DEPLOYMENT_ENVIRONMENT: "local",
	OPS_WEB_DATABASE_SSLMODE: "disable",
	OPS_WEB_DATABASE_URL: postgres.opsWebConnectionString,
	OPS_WEB_SCHEMA_DATABASE_SSLMODE: "disable",
	OPS_WEB_SCHEMA_DATABASE_URL: postgres.managementConnectionString,
} as const;

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

describe("ops-web PostgreSQL grants", () => {
	it("permits bounded terminal failure projection without granting event access", async () => {
		const client = await connect(postgres.opsWebConnectionString);
		try {
			await client.query(
				"select code, operation, detail, invocation_id, http_status from execution_control.ops_terminal_failures limit 0",
			);
			expect(
				await postgresErrorCode(
					client.query("select payload_json from execution_control.agent_run_events limit 0"),
				),
			).toBe("42501");
		} finally {
			await client.end();
		}
	});
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

	it("owns the current Dining tables", async () => {
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
			"submission_edits",
			"submission_photos",
			"submission_reports",
			"submissions",
		]);
	});

	it("upgrades old Dining data through the named migration without loss", async () => {
		const reviewId = randomUUID();
		const reportId = randomUUID();
		const editId = randomUUID();
		await management.query("begin");
		try {
			await management.query(
				"delete from drizzle.campus_agent_migrations where name in ('20260914000000_0016_dining_submissions', '20260914074417_dining_lifecycle')",
			);
			await management.query(
				"drop table dining.submission_reports, dining.submission_edits, dining.submission_photos cascade",
			);
			await management.query("drop table dining.submissions cascade");
			await management.query("drop index if exists dining_reviews_submission_created_idx");
			await management.query(
				"alter table dining.reviews drop constraint if exists dining_reviews_target_check, drop column if exists submission_id, drop column if exists content_revision",
			);
			await management.query(
				"alter table dining.reviews alter column author_display_name set not null, alter column author_id set not null, alter column body set not null, alter column menu_item_id set not null, alter column updated_by set not null",
			);
			await management.query(
				"alter table dining.review_reports drop constraint if exists dining_review_reports_resolution_state_check, drop column if exists content_expires_at, drop column if exists target_revision, alter column reporter_user_id set not null",
			);
			await management.query(
				"alter table dining.review_reports add constraint dining_review_reports_resolution_state_check check ((resolution is null and resolved_at is null and resolved_by is null) or (resolution is not null and resolved_at is not null and resolved_by is not null))",
			);
			await management.query(
				"alter table dining.review_edits drop column if exists next_revision, drop column if exists previous_revision, drop column if exists expires_at, alter column edited_by set not null, alter column next_body set not null, alter column previous_body set not null",
			);
			await management.query(
				"insert into dining.menu_items (menu_item_id, window_id, name, price_text, sort_order, created_at, created_by, updated_at, updated_by) values ('upgrade-menu-item', 'upgrade-window', '旧菜单菜品', null, 0, now(), 'upgrade-fixture', now(), 'upgrade-fixture')",
			);
			await management.query(
				"insert into dining.reviews (review_id, menu_item_id, author_kind, author_id, author_display_name, anonymous, body, idempotency_key, submission_date, created_at, updated_at, updated_by) values ($1, 'upgrade-menu-item', 'member', 'upgrade-user', '升级用户', false, '旧评价正文', 'upgrade-review-key', current_date, now(), now(), 'upgrade-user')",
				[reviewId],
			);
			await management.query(
				"insert into dining.review_reports (report_id, review_id, reporter_user_id, reason, details, created_at, resolution, resolved_at, resolved_by) values ($1, $2, 'upgrade-reporter', 'other', '旧举报说明', now(), 'keep', now(), 'upgrade-operator')",
				[reportId, reviewId],
			);
			await management.query(
				"insert into dining.review_edits (edit_id, review_id, previous_body, next_body, edited_at, edited_by) values ($1, $2, '旧评价正文', '更新后的旧评价正文', now(), 'upgrade-user')",
				[editId, reviewId],
			);
			await management.query("commit");
		} catch (error) {
			await management.query("rollback");
			throw error;
		}

		const migrationEnv = {
			...process.env,
			PGDATABASE: new URL(postgres.managementConnectionString).pathname.slice(1),
			PGHOST: new URL(postgres.managementConnectionString).hostname,
			PGPASSWORD: decodeURIComponent(new URL(postgres.managementConnectionString).password),
			PGPORT: new URL(postgres.managementConnectionString).port,
			PGSSLMODE: "disable",
			PGUSER: decodeURIComponent(new URL(postgres.managementConnectionString).username),
		};
		const first = await execFileAsync("pnpm", ["--dir", "jobs/campus-agent-schema", "migrate"], {
			cwd: repositoryRoot,
			env: migrationEnv,
		});
		expect(first.stdout).toContain("applied");
		const preserved = await management.query(
			"select r.menu_item_id, r.body, rr.details, re.previous_body from dining.reviews r join dining.review_reports rr on rr.review_id = r.review_id join dining.review_edits re on re.review_id = r.review_id where r.review_id = $1",
			[reviewId],
		);
		expect(preserved.rows[0]).toEqual({
			menu_item_id: "upgrade-menu-item",
			body: "旧评价正文",
			details: "旧举报说明",
			previous_body: "旧评价正文",
		});
		const second = await execFileAsync("pnpm", ["--dir", "jobs/campus-agent-schema", "migrate"], {
			cwd: repositoryRoot,
			env: migrationEnv,
		});
		expect(second.stdout).toContain("current");
		await management.query("delete from dining.review_reports where report_id = $1", [reportId]);
		await management.query("delete from dining.review_edits where edit_id = $1", [editId]);
		await management.query("delete from dining.reviews where review_id = $1", [reviewId]);
		await management.query(
			"delete from dining.menu_items where menu_item_id = 'upgrade-menu-item'",
		);
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
			has_table_privilege('app_api', 'dining.review_reports', 'UPDATE') as "canResolveReports",
			has_table_privilege('app_api', 'dining.review_edits', 'SELECT,INSERT,UPDATE') as "canUseEdits"`);
		expect(privileges.rows[0]).toEqual({
			canDeleteReviews: true,
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

	it("permits lifecycle identity cleanup without granting report resolution or historical bodies", async () => {
		const runtime = await connect(postgres.appApiConnectionString);
		try {
			await runtime.query("begin");
			await runtime.query(
				"select edit_id, review_id, edited_by, edited_at, expires_at from dining.review_edits limit 0",
			);
			await runtime.query("update dining.reviews set updated_by = null where false");
			await runtime.query(
				"update dining.review_reports set details = null, reporter_user_id = null, resolved_by = null where false",
			);
			await runtime.query("update dining.review_edits set edited_by = null where false");
			await runtime.query("delete from dining.review_edits where false");
			await runtime.query("delete from dining.review_reports where false");
			await runtime.query("delete from dining.reviews where false");
			await runtime.query("rollback");
			for (const statement of [
				"select previous_body from dining.review_edits limit 0",
				"select next_body from dining.review_edits limit 0",
				"update dining.review_reports set resolution = null where false",
				"update dining.review_reports set resolved_at = null where false",
				"update dining.review_edits set previous_body = null where false",
				"insert into dining.review_edits (edit_id, review_id, edited_at) select 'denied', 'denied', now() where false",
			]) {
				expect(await postgresErrorCode(runtime.query(statement))).toBe("42501");
			}
			const nullable = await management.query(
				"select is_nullable from information_schema.columns where table_schema = 'dining' and table_name = 'reviews' and column_name = 'updated_by'",
			);
			expect(nullable.rows[0]).toEqual({ is_nullable: "YES" });
		} finally {
			await runtime.query("rollback");
			await runtime.end();
		}
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
					activity_attempt, updated_at, sanitized_payload_json
				 from execution_control.agent_run_steps limit 0`,
			),
		).resolves.toBeDefined();
		await expect(
			runtime.query(
				`select step_id, request_id, attempt, status, started_at, completed_at, duration_ms,
					activity_attempt,
					updated_at,
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
