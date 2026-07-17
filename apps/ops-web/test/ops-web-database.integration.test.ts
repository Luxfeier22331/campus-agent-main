// @vitest-environment node

import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { applyOpsWebDatabaseGrants, verifyOpsWebDatabase } from "../ops/db/ops-web-database.ts";

const postgres = inject("opsWebPostgres");
const databaseEnv = {
	DEPLOYMENT_ENVIRONMENT: "local",
	OPS_AUDIT_MAINTENANCE_DATABASE_SSLMODE: "disable",
	OPS_AUDIT_MAINTENANCE_DATABASE_URL: postgres.auditMaintenanceConnectionString,
	OPS_WEB_DATABASE_SSLMODE: "disable",
	OPS_WEB_DATABASE_URL: postgres.opsWebConnectionString,
	OPS_WEB_SCHEMA_DATABASE_SSLMODE: "disable",
	OPS_WEB_SCHEMA_DATABASE_URL: postgres.managementConnectionString,
} as const;

async function connect(connectionString: string): Promise<Client> {
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

describe("ops-web PostgreSQL grants", () => {
	let applyResult: Awaited<ReturnType<typeof applyOpsWebDatabaseGrants>>;
	let auditMaintenance: Client;
	let management: Client;
	let opsWeb: Client;
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
		[opsWeb, auditMaintenance] = await Promise.all([
			connect(postgres.opsWebConnectionString),
			connect(postgres.auditMaintenanceConnectionString),
		]);
	});

	afterAll(async () => {
		await Promise.all([management.end(), opsWeb.end(), auditMaintenance.end()]);
	});

	it("applies and verifies the production grant contract without persisting preflight audit rows", async () => {
		expect(applyResult).toEqual({
			auditMaintenance: "ready",
			opsWebRole: "ready",
			readAudit: "ready",
			readModel: "ready",
		});
		expect(verifyResult).toEqual(applyResult);

		const preflightRows = await management.query<{ count: string }>(
			`select count(*) from observability.ops_observability_read_audit
			 where audit_id like 'ops_web_preflight_%'`,
		);
		expect(preflightRows.rows[0]?.count).toBe("0");
	});

	it("allows only the declared read-model columns", async () => {
		await expect(
			opsWeb.query(
				`select completed_at, conversation_id, created_at, error_code, owner_user_id,
					principal_snapshot_json, request_id, requested_tool, run_id, selected_tool,
					status, trace_id, updated_at, user_message_id
				 from chat.turn_dispatches limit 0`,
			),
		).resolves.toBeDefined();
		await expect(opsWeb.query("select id, text from chat.messages limit 0")).resolves.toBeDefined();
		await expect(
			opsWeb.query(
				`select completed_at, fail_close_reason, requested_tool, run_id, selected_tool,
					status, terminal_reason, trace_id, updated_at
				 from runtime.agent_runs limit 0`,
			),
		).resolves.toBeDefined();
		await expect(
			opsWeb.query(
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
			"select * from chat.messages limit 0",
			"select * from runtime.agent_runs limit 0",
			"select * from runtime.request_observability_fact limit 0",
			"select actor_user_id from chat.turn_dispatches limit 0",
			"select conversation_id from chat.messages limit 0",
			"select owner_user_id from runtime.agent_runs limit 0",
			"select conversation_id from runtime.request_observability_fact limit 0",
		]) {
			expect(await postgresErrorCode(opsWeb.query(query))).toBe("42501");
		}
	});

	it("rejects business-table writes with insufficient_privilege", async () => {
		for (const query of [
			"update chat.turn_dispatches set status = status where false",
			"delete from chat.messages where false",
			"update runtime.agent_runs set status = status where false",
			"delete from runtime.request_observability_fact where false",
		]) {
			expect(await postgresErrorCode(opsWeb.query(query))).toBe("42501");
		}
	});

	it("lets ops_web insert audit records but not read, update or delete them", async () => {
		const auditId = `ops-web-integration-${randomUUID()}`;
		await opsWeb.query(
			`insert into observability.ops_observability_read_audit (
				audit_id, kind, operator_id, operator_principal_class, read_at,
				record_count, request_id, trace_id, truncated
			 ) values ($1, 'logs', 'integration-operator', 'service', now(), 1, $2, $3, false)`,
			[auditId, `request-${auditId}`, `trace-${auditId}`],
		);

		const persisted = await management.query<{ audit_id: string }>(
			"select audit_id from observability.ops_observability_read_audit where audit_id = $1",
			[auditId],
		);
		expect(persisted.rows).toEqual([{ audit_id: auditId }]);

		expect(
			await postgresErrorCode(
				opsWeb.query(
					"select audit_id from observability.ops_observability_read_audit where audit_id = $1",
					[auditId],
				),
			),
		).toBe("42501");
		expect(
			await postgresErrorCode(
				opsWeb.query(
					"update observability.ops_observability_read_audit set record_count = 2 where audit_id = $1",
					[auditId],
				),
			),
		).toBe("42501");
		expect(
			await postgresErrorCode(
				opsWeb.query("delete from observability.ops_observability_read_audit where audit_id = $1", [
					auditId,
				]),
			),
		).toBe("42501");
		await management.query(
			"delete from observability.ops_observability_read_audit where audit_id = $1",
			[auditId],
		);
	});

	it("confines audit maintenance to the security-definer retention function", async () => {
		const oldAuditId = `old-${randomUUID()}`;
		const recentAuditId = `recent-${randomUUID()}`;
		await management.query(
			`insert into observability.ops_observability_read_audit (
				audit_id, kind, operator_id, operator_principal_class, read_at,
				record_count, request_id, trace_id, truncated
			 ) values
				($1, 'logs', 'retention-test', 'service', now() - interval '181 days', 1, null, null, false),
				($2, 'logs', 'retention-test', 'service', now() - interval '179 days', 1, null, null, false)`,
			[oldAuditId, recentAuditId],
		);

		expect(
			await postgresErrorCode(
				auditMaintenance.query("select * from observability.ops_observability_read_audit limit 0"),
			),
		).toBe("42501");
		expect(
			await postgresErrorCode(
				auditMaintenance.query(
					"delete from observability.ops_observability_read_audit where audit_id = $1",
					[oldAuditId],
				),
			),
		).toBe("42501");

		const pruned = await auditMaintenance.query<{ deletedCount: string }>(
			`select observability.prune_ops_observability_read_audit() as "deletedCount"`,
		);
		expect(pruned.rows[0]?.deletedCount).toBe("1");

		const remaining = await management.query<{ audit_id: string }>(
			`select audit_id from observability.ops_observability_read_audit
			 where audit_id = any($1::text[]) order by audit_id`,
			[[oldAuditId, recentAuditId]],
		);
		expect(remaining.rows).toEqual([{ audit_id: recentAuditId }]);

		expect(
			await postgresErrorCode(
				opsWeb.query("select observability.prune_ops_observability_read_audit()"),
			),
		).toBe("42501");
		await management.query(
			"delete from observability.ops_observability_read_audit where audit_id = $1",
			[recentAuditId],
		);
	});

	it("revokes historical execution-control provider configuration access from ops_web", async () => {
		const privilege = await management.query<{
			canReadConnectionID: boolean;
			canReadProfiles: boolean;
			canUseSchema: boolean;
		}>(
			`select
				has_schema_privilege('ops_web', 'execution_config', 'USAGE') as "canUseSchema",
				has_table_privilege('ops_web', 'execution_config.profiles', 'SELECT') as "canReadProfiles",
				has_column_privilege(
					'ops_web', 'execution_config.connection_revisions', 'connection_id', 'SELECT'
				) as "canReadConnectionID"`,
		);
		expect(privilege.rows[0]).toEqual({
			canReadConnectionID: false,
			canReadProfiles: false,
			canUseSchema: false,
		});
		expect(
			await postgresErrorCode(opsWeb.query("select * from execution_config.profiles limit 0")),
		).toBe("42501");
		expect(
			await postgresErrorCode(
				opsWeb.query("select connection_id from execution_config.connection_revisions limit 0"),
			),
		).toBe("42501");
	});
});
