import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg, { type Client } from "pg";
import { type DatabaseSslConfig, readDatabaseConnectionConfig } from "./postgres-tls.ts";

const OPS_WEB_GRANT_STATEMENTS = [
	`REVOKE ALL PRIVILEGES ON SCHEMA "execution_config" FROM "ops_web"`,
	`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "execution_config" FROM "ops_web"`,
	`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "execution_config" FROM "ops_web"`,
	`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "execution_config" FROM "ops_web"`,
	`DO $ops_web_provider_config_revoke$
	DECLARE
		relation record;
		column_names text;
	BEGIN
		FOR relation IN
			SELECT class.oid AS relation_oid, namespace.nspname AS schema_name,
				class.relname AS relation_name
			FROM pg_catalog.pg_class class
			JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
			WHERE namespace.nspname = 'execution_config'
				AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
		LOOP
			SELECT pg_catalog.string_agg(
				pg_catalog.quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum
			)
			INTO column_names
			FROM pg_catalog.pg_attribute attribute
			WHERE attribute.attrelid = relation.relation_oid
				AND attribute.attnum > 0
				AND NOT attribute.attisdropped;

			IF column_names IS NOT NULL THEN
				EXECUTE pg_catalog.format(
					'REVOKE ALL PRIVILEGES (%s) ON TABLE %I.%I FROM %I',
					column_names,
					relation.schema_name,
					relation.relation_name,
					'ops_web'
				);
			END IF;
		END LOOP;
	END
	$ops_web_provider_config_revoke$`,
	`GRANT USAGE ON SCHEMA "chat", "runtime" TO "ops_web"`,
	`REVOKE ALL PRIVILEGES ON TABLE
		"chat"."turn_dispatches",
			"chat"."messages",
			"runtime"."agent_runs",
			"runtime"."request_observability_fact"
	FROM "ops_web"`,
	`GRANT SELECT (
		"completed_at", "conversation_id", "created_at", "error_code",
		"principal_snapshot_json", "request_id", "requested_tool", "run_id", "selected_tool",
		"status", "trace_id", "updated_at", "user_message_id"
	) ON TABLE "chat"."turn_dispatches" TO "ops_web"`,
	`GRANT SELECT (
		"id", "text"
	) ON TABLE "chat"."messages" TO "ops_web"`,
	`GRANT SELECT (
		"completed_at", "fail_close_reason", "requested_tool", "run_id", "selected_tool",
		"status", "terminal_reason", "trace_id", "updated_at"
	) ON TABLE "runtime"."agent_runs" TO "ops_web"`,
	`GRANT SELECT (
			"acl_anomaly_code", "acl_decision", "completed_at", "duration_ms", "fail_closed",
			"measured_at",
			"model_name", "model_provider", "prompt_id", "prompt_version", "projection_lag_ms",
			"refusal_class", "request_id", "resolved_targets_json", "semantic_outcome", "stage_timing_json",
			"supporting_sources_json", "template_sha256", "trace_available", "updated_at",
			"workflow_trace_summary_json"
	) ON TABLE "runtime"."request_observability_fact" TO "ops_web"`,
] as const;

const OPS_WEB_DINING_WRITE_TABLES = [
	"halls",
	"floors",
	"windows",
	"stall_profiles",
	"window_assignments",
	"menu_items",
	"menu_offerings",
	"catalog_state",
	"releases",
	"publication",
	"catalog_overrides",
	"reviews",
	"review_overrides",
	"review_recheck_requests",
	"operation_events",
] as const;

const OPS_WEB_DINING_GRANT_STATEMENTS = [
	`GRANT USAGE ON SCHEMA "dining" TO "ops_web_dining"`,
	`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "dining" FROM "ops_web_dining"`,
	`GRANT SELECT ON ALL TABLES IN SCHEMA "dining" TO "ops_web_dining"`,
	`GRANT INSERT, UPDATE, DELETE ON ${OPS_WEB_DINING_WRITE_TABLES.map((table) => `"dining"."${table}"`).join(", ")} TO "ops_web_dining"`,
	`REVOKE CREATE ON SCHEMA "dining" FROM "ops_web_dining"`,
] as const;

export async function applyOpsWebGrantStatements(client: {
	query(sql: string): Promise<unknown>;
}): Promise<void> {
	for (const statement of OPS_WEB_GRANT_STATEMENTS) {
		await client.query(statement);
	}
}

export async function applyOpsWebDiningGrantStatements(client: {
	query(sql: string): Promise<unknown>;
}): Promise<void> {
	for (const statement of OPS_WEB_DINING_GRANT_STATEMENTS) {
		await client.query(statement);
	}
}

interface DatabaseConnectionConfig {
	connectionString: string;
	ssl: DatabaseSslConfig;
}
const REQUIRED_SELECTS = [
	{
		label: "chat.turn_dispatches",
		sql: `
			select
				"completed_at",
				"conversation_id",
				"created_at",
				"error_code",
				"principal_snapshot_json",
				"request_id",
				"requested_tool",
				"run_id",
				"selected_tool",
				"status",
				"trace_id",
				"updated_at",
				"user_message_id"
			from "chat"."turn_dispatches"
			limit 0
		`,
	},
	{
		label: "chat.messages",
		sql: `
			select
				"id",
				"text"
			from "chat"."messages"
			limit 0
		`,
	},
	{
		label: "runtime.agent_runs",
		sql: `
			select
				"completed_at",
				"fail_close_reason",
				"requested_tool",
				"run_id",
				"selected_tool",
				"status",
				"terminal_reason",
				"trace_id",
				"updated_at"
			from "runtime"."agent_runs"
			limit 0
		`,
	},
	{
		label: "runtime.request_observability_fact",
		sql: `
				select
						"acl_anomaly_code",
						"acl_decision",
						"completed_at",
						"duration_ms",
						"fail_closed",
						"measured_at",
						"model_name",
						"model_provider",
						"prompt_id",
						"prompt_version",
						"projection_lag_ms",
						"refusal_class",
						"request_id",
						"resolved_targets_json",
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
		await assertDatabaseRole(client, "ops_web_dining");
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

		const providerConfigPrivileges = await client.query(`
				select
					has_schema_privilege(current_user, 'execution_config', 'CREATE') as "canCreateSchema",
					has_schema_privilege(current_user, 'execution_config', 'USAGE') as "canUseSchema",
					exists (
						select 1
						from pg_catalog.pg_class class
						join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
						where namespace.nspname = 'execution_config'
							and class.relkind in ('r', 'p', 'v', 'm', 'f')
							and (
								has_table_privilege(current_user, class.oid, 'SELECT')
								or has_table_privilege(current_user, class.oid, 'INSERT')
								or has_table_privilege(current_user, class.oid, 'UPDATE')
								or has_table_privilege(current_user, class.oid, 'DELETE')
								or has_table_privilege(current_user, class.oid, 'TRUNCATE')
								or has_table_privilege(current_user, class.oid, 'REFERENCES')
								or has_table_privilege(current_user, class.oid, 'TRIGGER')
								or has_any_column_privilege(current_user, class.oid, 'SELECT')
								or has_any_column_privilege(current_user, class.oid, 'INSERT')
								or has_any_column_privilege(current_user, class.oid, 'UPDATE')
								or has_any_column_privilege(current_user, class.oid, 'REFERENCES')
							)
					) as "canAccessRelations",
					exists (
						select 1
						from pg_catalog.pg_class class
						join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
						where namespace.nspname = 'execution_config'
							and class.relkind = 'S'
							and (
								has_sequence_privilege(current_user, class.oid, 'USAGE')
								or has_sequence_privilege(current_user, class.oid, 'SELECT')
								or has_sequence_privilege(current_user, class.oid, 'UPDATE')
							)
					) as "canAccessSequences",
					exists (
						select 1
						from pg_catalog.pg_proc procedure
						join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
						where namespace.nspname = 'execution_config'
							and has_function_privilege(current_user, procedure.oid, 'EXECUTE')
					) as "canExecuteFunctions"
			`);
		const providerConfigAccess = providerConfigPrivileges.rows[0];
		if (
			providerConfigAccess?.canCreateSchema !== false ||
			providerConfigAccess.canUseSchema !== false ||
			providerConfigAccess.canAccessRelations !== false ||
			providerConfigAccess.canAccessSequences !== false ||
			providerConfigAccess.canExecuteFunctions !== false
		) {
			throw new Error("ops_web must not have direct or inherited privileges on execution_config.");
		}
	});
}

async function verifyOpsWebDiningRoleAndGrants(config: DatabaseConnectionConfig): Promise<void> {
	return withClient(config, async (client) => {
		const currentUserResult = await client.query(`select current_user as "currentUser"`);
		const currentUser = currentUserResult.rows[0]?.currentUser;
		if (currentUser !== "ops_web_dining") {
			throw new Error(
				`OPS_WEB_DINING_DATABASE_URL must connect as ops_web_dining; current_user is ${currentUser ?? "<unknown>"}.`,
			);
		}

		const schemaPrivileges = await client.query(`select
			has_schema_privilege(current_user, 'dining', 'USAGE') as "canUseSchema",
			has_schema_privilege(current_user, 'dining', 'CREATE') as "canCreateSchema"`);
		if (
			schemaPrivileges.rows[0]?.canUseSchema !== true ||
			schemaPrivileges.rows[0]?.canCreateSchema !== false
		) {
			throw new Error("ops_web_dining must have USAGE but not CREATE on the dining schema.");
		}

		const missingPrivileges = await client.query(
			`with required(table_name, privilege) as (
				select tablename, 'SELECT'::text
				from pg_catalog.pg_tables
				where schemaname = 'dining'
				union all
				select table_name, privilege
				from unnest($1::text[]) as required_table(table_name)
				cross join unnest(array['INSERT', 'UPDATE', 'DELETE']::text[])
					as required_privilege(privilege)
			)
			select table_name, privilege
			from required
			where not has_table_privilege(
				current_user,
				format('%I.%I', 'dining', table_name),
				privilege
			)`,
			[[...OPS_WEB_DINING_WRITE_TABLES]],
		);
		if (missingPrivileges.rowCount !== 0) {
			const missing = missingPrivileges.rows
				.map((row) => `${String(row.table_name)}:${String(row.privilege)}`)
				.join(", ");
			throw new Error(`ops_web_dining is missing required privileges: ${missing}`);
		}
	});
}

function readDatabaseConfigs(env: NodeJS.ProcessEnv): {
	schemaAdmin: DatabaseConnectionConfig;
	opsWeb: DatabaseConnectionConfig;
	opsWebDining: DatabaseConnectionConfig;
} {
	return {
		schemaAdmin: readDatabaseConnectionConfig(env, {
			caCertPath: "OPS_WEB_SCHEMA_DATABASE_CA_CERT_PATH",
			databaseUrl: "OPS_WEB_SCHEMA_DATABASE_URL",
			sslMode: "OPS_WEB_SCHEMA_DATABASE_SSLMODE",
		}),
		opsWeb: readDatabaseConnectionConfig(env, {
			caCertPath: "OPS_WEB_DATABASE_CA_CERT_PATH",
			databaseUrl: "OPS_WEB_DATABASE_URL",
			sslMode: "OPS_WEB_DATABASE_SSLMODE",
		}),
		opsWebDining: readDatabaseConnectionConfig(env, {
			caCertPath: "OPS_WEB_DINING_DATABASE_CA_CERT_PATH",
			databaseUrl: "OPS_WEB_DINING_DATABASE_URL",
			sslMode: "OPS_WEB_DINING_DATABASE_SSLMODE",
		}),
	};
}

export async function applyOpsWebDatabaseGrants(env: NodeJS.ProcessEnv = process.env): Promise<{
	opsWebRole: "ready";
	opsWebDiningRole: "ready";
	readModel: "ready";
}> {
	const config = readDatabaseConfigs(env);
	await withClient(config.schemaAdmin, async (client) => {
		await assertDatabaseRole(client, "ops_web");
		await assertDatabaseRole(client, "ops_web_dining");
		await client.query("begin");
		try {
			await applyOpsWebGrantStatements(client);
			await applyOpsWebDiningGrantStatements(client);
			await client.query("commit");
		} catch (error) {
			await client.query("rollback");
			throw error;
		}
	});
	await verifyOpsWebRoleAndGrants(config.opsWeb);
	await verifyOpsWebDiningRoleAndGrants(config.opsWebDining);
	return {
		opsWebRole: "ready",
		opsWebDiningRole: "ready",
		readModel: "ready",
	};
}

export async function verifyOpsWebDatabase(env: NodeJS.ProcessEnv = process.env): Promise<{
	opsWebRole: "ready";
	opsWebDiningRole: "ready";
	readModel: "ready";
}> {
	const config = readDatabaseConfigs(env);

	await verifyDatabaseRoles(config.schemaAdmin);
	await verifyOpsWebRoleAndGrants(config.opsWeb);
	await verifyOpsWebDiningRoleAndGrants(config.opsWebDining);

	return {
		opsWebRole: "ready",
		opsWebDiningRole: "ready",
		readModel: "ready",
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
