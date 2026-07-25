// @vitest-environment node

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { applyOpsWebDatabaseGrants, verifyOpsWebDatabase } from "../ops/db/ops-web-database.ts";

const postgres = inject("opsWebPostgres");
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
	let applyResult: Awaited<ReturnType<typeof applyOpsWebDatabaseGrants>>;
	let management: Client;
	let opsWeb: Client | undefined;
	let verifyResult: Awaited<ReturnType<typeof verifyOpsWebDatabase>>;

	beforeAll(async () => {
		management = await connect(postgres.managementConnectionString);
		await management.query(`
			grant usage on schema execution_config to ops_web;
			grant select on execution_config.model_settings to ops_web;
		`);
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
			opsWebRole: "ready",
			readModel: "ready",
		});
		expect(verifyResult).toEqual({
			diningMap: "ready",
			opsWebRole: "ready",
			readModel: "ready",
		});
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

	it("allows only the declared read-model columns", async () => {
		const runtime = requiredClient(opsWeb, "ops_web");
		await expect(
			runtime.query(
				`select admission_status, assistant_message_id, completed_at, conversation_id,
					created_at, error_code, request_id, run_id, status, surface, trace_id,
					turn_sequence, updated_at, user_message_id, workflow_id
				 from chat.turn_dispatches limit 0`,
			),
		).resolves.toBeDefined();
		await expect(
			runtime.query("select id, text from chat.messages limit 0"),
		).resolves.toBeDefined();
		await expect(
			runtime.query(
				`select completed_at, fail_close_reason, run_id, runtime_versions_json,
					status, terminal_reason, trace_id, updated_at
				 from runtime.agent_runs limit 0`,
			),
		).resolves.toBeDefined();
		await expect(
			runtime.query(
				`select run_id, started_at, status, step_kind, tool, updated_at
				 from runtime.agent_run_steps limit 0`,
			),
		).resolves.toBeDefined();
		await expect(
			runtime.query(
				`select cached_input_tokens, input_tokens, output_tokens, run_id, step_id,
					usage_observed
				 from runtime.agent_step_attempts limit 0`,
			),
		).resolves.toBeDefined();

		for (const query of [
			"select * from chat.turn_dispatches limit 0",
			"select owner_user_id from chat.turn_dispatches limit 0",
			"select * from chat.messages limit 0",
			"select * from runtime.agent_runs limit 0",
			"select * from runtime.agent_run_steps limit 0",
			"select * from runtime.agent_step_attempts limit 0",
		]) {
			expect(await postgresErrorCode(runtime.query(query))).toBe("42501");
		}
	});

	it("rejects business-table writes", async () => {
		const runtime = requiredClient(opsWeb, "ops_web");
		for (const query of [
			"update chat.turn_dispatches set status = status where false",
			"delete from chat.messages where false",
			"update runtime.agent_runs set status = status where false",
			"update runtime.agent_run_steps set status = status where false",
			"delete from runtime.agent_step_attempts where false",
		]) {
			expect(await postgresErrorCode(runtime.query(query))).toBe("42501");
		}
	});

	it("revokes direct Provider Config access", async () => {
		const privilege = await management.query<{
			canReadModelSettings: boolean;
			canUseSchema: boolean;
		}>(`select
			has_schema_privilege('ops_web', 'execution_config', 'USAGE') as "canUseSchema",
			has_table_privilege(
				'ops_web', 'execution_config.model_settings', 'SELECT'
			) as "canReadModelSettings"`);
		expect(privilege.rows[0]).toEqual({
			canReadModelSettings: false,
			canUseSchema: false,
		});
	});
});
