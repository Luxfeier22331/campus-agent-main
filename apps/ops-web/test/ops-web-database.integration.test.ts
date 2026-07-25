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
