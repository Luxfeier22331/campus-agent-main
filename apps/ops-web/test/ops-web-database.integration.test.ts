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
			grant select on execution_config.profiles to ops_web;
			grant select (connection_id) on execution_config.connection_revisions to ops_web;
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
			opsWebRole: "ready",
			readModel: "ready",
		});
		expect(verifyResult).toEqual({
			opsWebRole: "ready",
			readModel: "ready",
		});
	});

	it("allows only the declared read-model columns", async () => {
		const runtime = requiredClient(opsWeb, "ops_web");
		await expect(
			runtime.query(
				`select completed_at, conversation_id, created_at, error_code,
					principal_snapshot_json, request_id, requested_tool, run_id, selected_tool,
					status, trace_id, updated_at, user_message_id
				 from chat.turn_dispatches limit 0`,
			),
		).resolves.toBeDefined();
		await expect(
			runtime.query("select id, text from chat.messages limit 0"),
		).resolves.toBeDefined();
		await expect(
			runtime.query(
				`select completed_at, fail_close_reason, requested_tool, run_id, selected_tool,
					status, terminal_reason, trace_id, updated_at
				 from runtime.agent_runs limit 0`,
			),
		).resolves.toBeDefined();
		await expect(
			runtime.query(
				`select acl_anomaly_code, acl_decision, completed_at, duration_ms, fail_closed,
					measured_at, model_name, model_provider, prompt_id, prompt_version,
					projection_lag_ms, refusal_class, request_id, resolved_targets_json,
					semantic_outcome, stage_timing_json, supporting_sources_json, template_sha256,
					trace_available, updated_at, workflow_trace_summary_json
				 from runtime.request_observability_fact limit 0`,
			),
		).resolves.toBeDefined();

		for (const query of [
			"select * from chat.turn_dispatches limit 0",
			"select owner_user_id from chat.turn_dispatches limit 0",
			"select * from chat.messages limit 0",
			"select * from runtime.agent_runs limit 0",
			"select * from runtime.request_observability_fact limit 0",
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
			"delete from runtime.request_observability_fact where false",
		]) {
			expect(await postgresErrorCode(runtime.query(query))).toBe("42501");
		}
	});

	it("revokes historical direct Provider Config access", async () => {
		const privilege = await management.query<{
			canReadConnectionID: boolean;
			canReadProfiles: boolean;
			canUseSchema: boolean;
		}>(`select
			has_schema_privilege('ops_web', 'execution_config', 'USAGE') as "canUseSchema",
			has_table_privilege('ops_web', 'execution_config.profiles', 'SELECT') as "canReadProfiles",
			has_column_privilege(
				'ops_web', 'execution_config.connection_revisions', 'connection_id', 'SELECT'
			) as "canReadConnectionID"`);
		expect(privilege.rows[0]).toEqual({
			canReadConnectionID: false,
			canReadProfiles: false,
			canUseSchema: false,
		});
	});
});
