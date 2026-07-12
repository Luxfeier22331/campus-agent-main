import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg, { type Client } from "pg";
import { type DatabaseSslConfig, readDatabaseConnectionConfig } from "./postgres-tls.ts";

const OPS_WEB_GRANT_STATEMENTS = [
	`GRANT USAGE ON SCHEMA "operator", "runtime", "observability" TO "ops_web"`,
	`REVOKE ALL PRIVILEGES ON TABLE
		"operator"."request_projection",
			"operator"."temporal_task_queue_current",
			"runtime"."request_execution",
			"runtime"."request_observability_fact",
			"observability"."ops_observability_read_audit"
	FROM "ops_web"`,
	`GRANT SELECT (
		"completed_at", "conversation_id", "duration_ms", "error_code", "principal_id",
		"principal_type", "projected_at", "question_preview", "request_id", "requested_tool",
		"selected_tool", "started_at", "status", "trace_id"
	) ON TABLE "operator"."request_projection" TO "ops_web"`,
	`GRANT SELECT (
		"backlog_json", "current_id", "oldest_task_age_json", "poller_count", "projected_at",
		"sampled_at", "task_queue", "task_queue_kind"
	) ON TABLE "operator"."temporal_task_queue_current" TO "ops_web"`,
	`GRANT SELECT ("request_id", "run_id")
	ON TABLE "runtime"."request_execution" TO "ops_web"`,
	`GRANT SELECT (
			"acl_anomaly_code", "acl_decision", "fail_closed", "measured_at",
			"model_name", "model_provider", "prompt_id", "prompt_version", "projection_lag_ms",
			"refusal_class", "request_id", "scope_class", "semantic_outcome", "stage_timing_json",
			"supporting_sources_json", "template_sha256", "trace_available", "updated_at",
			"workflow_trace_summary_json"
	) ON TABLE "runtime"."request_observability_fact" TO "ops_web"`,
	`GRANT INSERT (
			"audit_id", "kind", "operator_id", "operator_principal_class", "read_at",
			"record_count", "request_id", "trace_id", "truncated"
		) ON TABLE "observability"."ops_observability_read_audit" TO "ops_web"`,
] as const;
const OPS_AUDIT_MAINTENANCE_GRANT_STATEMENTS = [
	`GRANT USAGE ON SCHEMA "observability" TO "ops_audit_maintenance"`,
	`CREATE OR REPLACE FUNCTION "observability"."prune_ops_observability_read_audit"()
	RETURNS bigint
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog
	AS $ops_audit_retention$
	DECLARE
		deleted_count bigint;
	BEGIN
		DELETE FROM "observability"."ops_observability_read_audit"
		WHERE "read_at" < pg_catalog.now() - interval '180 days';
		GET DIAGNOSTICS deleted_count = ROW_COUNT;
		RETURN deleted_count;
	END;
	$ops_audit_retention$`,
	`REVOKE ALL PRIVILEGES ON TABLE "observability"."ops_observability_read_audit" FROM "ops_audit_maintenance"`,
	`REVOKE ALL PRIVILEGES ON FUNCTION "observability"."prune_ops_observability_read_audit"() FROM PUBLIC`,
	`GRANT EXECUTE ON FUNCTION "observability"."prune_ops_observability_read_audit"() TO "ops_audit_maintenance"`,
] as const;

interface DatabaseConnectionConfig {
	connectionString: string;
	ssl: DatabaseSslConfig;
}
const REQUIRED_SELECTS = [
	{
		label: "operator.request_projection",
		sql: `
			select
				"completed_at",
				"conversation_id",
				"duration_ms",
				"error_code",
				"principal_id",
				"principal_type",
				"projected_at",
				"question_preview",
				"request_id",
				"requested_tool",
				"selected_tool",
				"started_at",
				"status",
				"trace_id"
			from "operator"."request_projection"
			limit 0
		`,
	},
	{
		label: "operator.temporal_task_queue_current",
		sql: `
			select
					"backlog_json",
					"oldest_task_age_json",
					"poller_count",
					"projected_at",
					"task_queue",
					"task_queue_kind",
					"sampled_at",
					"current_id"
				from "operator"."temporal_task_queue_current"
				limit 0
			`,
	},
	{
		label: "runtime.request_execution",
		sql: `
			select
				"request_id",
				"run_id"
			from "runtime"."request_execution"
			limit 0
		`,
	},
	{
		label: "runtime.request_observability_fact",
		sql: `
				select
						"acl_anomaly_code",
						"acl_decision",
						"fail_closed",
						"measured_at",
						"model_name",
						"model_provider",
						"prompt_id",
						"prompt_version",
						"projection_lag_ms",
						"refusal_class",
						"request_id",
						"scope_class",
						"semantic_outcome",
						"stage_timing_json",
						"supporting_sources_json",
						"template_sha256",
						"trace_available",
						"updated_at",
						"workflow_trace_summary_json"
				from "runtime"."request_observability_fact"
				limit 0
			`,
	},
];

function createClient(config: DatabaseConnectionConfig): Client {
	return new pg.Client({
		connectionString: config.connectionString,
		ssl: config.ssl,
	});
}

async function withClient<T>(
	config: DatabaseConnectionConfig,
	fn: (client: Client) => Promise<T>,
): Promise<T> {
	const client = createClient(config);
	await client.connect();
	try {
		return await fn(client);
	} finally {
		await client.end();
	}
}

async function assertDatabaseRole(client: Client, roleName: string): Promise<void> {
	const roleResult = await client.query("select 1 as present from pg_roles where rolname = $1", [
		roleName,
	]);
	if (roleResult.rowCount !== 1) {
		throw new Error(
			`${roleName} role is missing; create the role before applying database grants.`,
		);
	}
}

async function verifyDatabaseRoles(config: DatabaseConnectionConfig): Promise<void> {
	return withClient(config, async (client) => {
		await assertDatabaseRole(client, "ops_web");
		await assertDatabaseRole(client, "ops_audit_maintenance");
	});
}

async function verifyOpsWebRoleAndGrants(config: DatabaseConnectionConfig): Promise<void> {
	return withClient(config, async (client) => {
		const currentUserResult = await client.query(`select current_user as "currentUser"`);
		const currentUser = currentUserResult.rows[0]?.currentUser;
		if (currentUser !== "ops_web") {
			throw new Error(
				`OPS_WEB_DATABASE_URL must connect as ops_web; current_user is ${currentUser ?? "<unknown>"}.`,
			);
		}

		for (const check of REQUIRED_SELECTS) {
			try {
				await client.query(check.sql);
			} catch (error) {
				throw new Error(
					`ops_web cannot read ${check.label}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		await client.query("begin");
		try {
			await client.query(
				`
					insert into "observability"."ops_observability_read_audit" (
						"audit_id",
						"kind",
						"operator_id",
						"operator_principal_class",
						"read_at",
						"record_count",
						"request_id",
						"trace_id",
						"truncated"
					)
					values ($1, $2, $3, $4, now(), $5, $6, $7, $8)
				`,
				[
					`ops_web_preflight_${Date.now()}`,
					"logs",
					"ops-web-preflight",
					"service",
					0,
					"ops_web_preflight_request",
					"ops_web_preflight_trace",
					false,
				],
			);
		} finally {
			await client.query("rollback");
		}
	});
}

async function verifyAuditMaintenanceRoleAndGrants(
	config: DatabaseConnectionConfig,
): Promise<void> {
	return withClient(config, async (client) => {
		const currentUserResult = await client.query(`select current_user as "currentUser"`);
		const currentUser = currentUserResult.rows[0]?.currentUser;
		if (currentUser !== "ops_audit_maintenance") {
			throw new Error(
				`OPS_AUDIT_MAINTENANCE_DATABASE_URL must connect as ops_audit_maintenance; current_user is ${currentUser ?? "<unknown>"}.`,
			);
		}

		const tablePrivilegeResult = await client.query(
			`select
				has_table_privilege(current_user, 'observability.ops_observability_read_audit', 'SELECT') as "canSelectAudit",
				has_table_privilege(current_user, 'observability.ops_observability_read_audit', 'DELETE') as "canDeleteAudit",
				has_function_privilege(current_user, 'observability.prune_ops_observability_read_audit()', 'EXECUTE') as "canPruneAudit"`,
		);
		const privileges = tablePrivilegeResult.rows[0];
		if (privileges?.canSelectAudit === true || privileges?.canDeleteAudit === true) {
			throw new Error("ops_audit_maintenance must not have direct audit table privileges.");
		}
		if (privileges?.canPruneAudit !== true) {
			throw new Error("ops_audit_maintenance must be able to execute the audit pruning function.");
		}
		await client.query("begin");
		try {
			await client.query(
				`select "observability"."prune_ops_observability_read_audit"() as "deletedCount"`,
			);
		} finally {
			await client.query("rollback");
		}
	});
}

function readDatabaseConfigs(env: NodeJS.ProcessEnv): {
	auditMaintenance: DatabaseConnectionConfig;
	operator: DatabaseConnectionConfig;
	opsWeb: DatabaseConnectionConfig;
} {
	return {
		operator: readDatabaseConnectionConfig(env, {
			caCertPath: "APP_API_DATABASE_CA_CERT_PATH",
			databaseUrl: "APP_API_OPERATOR_DATABASE_URL",
			sslMode: "APP_API_DATABASE_SSLMODE",
		}),
		opsWeb: readDatabaseConnectionConfig(env, {
			caCertPath: "OPS_WEB_DATABASE_CA_CERT_PATH",
			databaseUrl: "OPS_WEB_DATABASE_URL",
			sslMode: "OPS_WEB_DATABASE_SSLMODE",
		}),
		auditMaintenance: readDatabaseConnectionConfig(env, {
			caCertPath: "OPS_AUDIT_MAINTENANCE_DATABASE_CA_CERT_PATH",
			databaseUrl: "OPS_AUDIT_MAINTENANCE_DATABASE_URL",
			sslMode: "OPS_AUDIT_MAINTENANCE_DATABASE_SSLMODE",
		}),
	};
}

export async function applyOpsWebDatabaseGrants(env: NodeJS.ProcessEnv = process.env): Promise<{
	auditMaintenance: "ready";
	opsWebRole: "ready";
	readAudit: "ready";
	readModel: "ready";
}> {
	const config = readDatabaseConfigs(env);
	await withClient(config.operator, async (client) => {
		await assertDatabaseRole(client, "ops_web");
		await assertDatabaseRole(client, "ops_audit_maintenance");
		await client.query("begin");
		try {
			for (const statement of [
				...OPS_WEB_GRANT_STATEMENTS,
				...OPS_AUDIT_MAINTENANCE_GRANT_STATEMENTS,
			]) {
				await client.query(statement);
			}
			await client.query("commit");
		} catch (error) {
			await client.query("rollback");
			throw error;
		}
	});
	await verifyOpsWebRoleAndGrants(config.opsWeb);
	await verifyAuditMaintenanceRoleAndGrants(config.auditMaintenance);
	return {
		auditMaintenance: "ready",
		opsWebRole: "ready",
		readAudit: "ready",
		readModel: "ready",
	};
}

export async function verifyOpsWebDatabase(env: NodeJS.ProcessEnv = process.env): Promise<{
	auditMaintenance: "ready";
	opsWebRole: "ready";
	readAudit: "ready";
	readModel: "ready";
}> {
	const config = readDatabaseConfigs(env);

	await verifyDatabaseRoles(config.operator);
	await verifyOpsWebRoleAndGrants(config.opsWeb);
	await verifyAuditMaintenanceRoleAndGrants(config.auditMaintenance);

	return {
		auditMaintenance: "ready",
		opsWebRole: "ready",
		readModel: "ready",
		readAudit: "ready",
	};
}

async function main(): Promise<void> {
	const action = process.argv[2];
	if (action !== "apply" && action !== "verify") {
		throw new Error("Usage: ops-web-database.ts <apply|verify>");
	}
	const result =
		action === "apply" ? await applyOpsWebDatabaseGrants() : await verifyOpsWebDatabase();
	console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
