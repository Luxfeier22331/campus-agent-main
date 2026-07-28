import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
	createSharedProductPool,
	prepareSharedProductSchemas,
	readSharedProductBootstrapEnv,
} from "../../src/script-support/shared-db/shared-product-database-bootstrap.ts";
import { applyAppApiGrants } from "./app-api-grants.ts";
import { applyCampusServicesGrants } from "./campus-services-grants.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const REQUIRED_TABLES = [
	"app_auth.account_admin_event",
	"app_auth.email_access_grant",
	"app_auth.user",
	"campus_groups.sections",
	"campus_groups.groups",
	"campus_services.transport_current",
	"campus_services.transport_departures",
	"campus_services.transport_releases",
	"campus_services.transport_routes",
	"chat.turn_dispatches",
	"docs.releases",
	"runtime.request_observability_fact",
] as const;
const REQUIRED_COLUMNS = [
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
	"identity",
	"observability",
	"official_web",
	"operator",
	"provider_config",
	"wechat_official_account",
] as const;

async function verifySchema(pool: ReturnType<typeof createSharedProductPool>): Promise<void> {
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
		canReadTransportCurrent: boolean;
		canReadTransportDepartures: boolean;
		canReadTransportReleases: boolean;
		canReadTransportRoutes: boolean;
		canReadDocs: boolean;
		canWriteTransportCurrent: boolean;
		canWriteDocs: boolean;
		canWriteObservability: boolean;
		canWriteGroupSections: boolean;
		canWriteGroups: boolean;
		docsPublisherCanWrite: boolean;
		executionControlCanReadTransport: boolean;
		opsWebCanReadTransport: boolean;
	}>(
		`select
			has_table_privilege('app_api', 'chat.turn_dispatches', 'SELECT,INSERT,UPDATE,DELETE') as "canMutateDispatches",
			has_table_privilege('app_api', 'campus_services.transport_releases', 'SELECT') as "canReadTransportReleases",
			has_table_privilege('app_api', 'campus_services.transport_current', 'SELECT') as "canReadTransportCurrent",
			has_table_privilege('app_api', 'campus_services.transport_routes', 'SELECT') as "canReadTransportRoutes",
			has_table_privilege('app_api', 'campus_services.transport_departures', 'SELECT') as "canReadTransportDepartures",
			has_table_privilege('app_api', 'campus_services.transport_current', 'INSERT,UPDATE,DELETE') as "canWriteTransportCurrent",
			has_table_privilege('app_api', 'docs.releases', 'SELECT') as "canReadDocs",
			has_table_privilege('app_api', 'docs.releases', 'INSERT,UPDATE,DELETE') as "canWriteDocs",
			has_table_privilege('docs_publish', 'docs.releases', 'SELECT,INSERT,UPDATE,DELETE') as "docsPublisherCanWrite",
			case
				when to_regclass('runtime.agent_runs') is null then false
				else has_table_privilege('app_api', 'runtime.agent_runs', 'SELECT')
			end as "canReadAgentRuns",
				has_table_privilege('app_api', 'runtime.request_observability_fact', 'SELECT,INSERT,UPDATE,DELETE') as "canWriteObservability",
				has_table_privilege('app_api', 'campus_groups.sections', 'SELECT,INSERT,UPDATE,DELETE') as "canWriteGroupSections",
				has_table_privilege('app_api', 'campus_groups.groups', 'SELECT,INSERT,UPDATE,DELETE') as "canWriteGroups",
				has_table_privilege('execution_control', 'campus_services.transport_releases', 'SELECT')
					and has_table_privilege('execution_control', 'campus_services.transport_current', 'SELECT')
					and has_table_privilege('execution_control', 'campus_services.transport_routes', 'SELECT')
					and has_table_privilege('execution_control', 'campus_services.transport_departures', 'SELECT')
					as "executionControlCanReadTransport",
				case
					when exists (select 1 from pg_roles where rolname = 'ops_web') then
						has_table_privilege('ops_web', 'campus_services.transport_releases', 'SELECT')
						or has_table_privilege('ops_web', 'campus_services.transport_routes', 'SELECT')
						or has_table_privilege('ops_web', 'campus_services.transport_departures', 'SELECT')
						or has_table_privilege('ops_web', 'campus_services.transport_current', 'SELECT')
					else false
				end as "opsWebCanReadTransport"`,
	);
	const privilege = privileges.rows[0];
	if (
		!(
			privilege?.canMutateDispatches &&
			privilege.canReadTransportReleases &&
			privilege.canReadTransportCurrent &&
			privilege.canReadDocs &&
			privilege.canWriteObservability &&
			privilege.canWriteGroupSections &&
			privilege.canWriteGroups &&
			privilege.docsPublisherCanWrite
		)
	) {
		throw new Error("app_api role is missing required table privileges.");
	}
	if (privilege.canWriteDocs) {
		throw new Error("app_api role must not mutate docs release projections.");
	}
	if (privilege.canReadAgentRuns) {
		throw new Error("app_api role must not read execution-control run tables.");
	}
	if (
		privilege.canReadTransportRoutes ||
		privilege.canReadTransportDepartures ||
		privilege.canWriteTransportCurrent
	) {
		throw new Error("app_api role exceeds its campus-services read boundary.");
	}
	if (!privilege.executionControlCanReadTransport) {
		throw new Error("execution_control role is missing campus-services read privileges.");
	}
	if (privilege.opsWebCanReadTransport) {
		throw new Error("ops_web role must not read campus-services tables.");
	}
}

export async function migrateAppApiSchema(envOverrides: NodeJS.ProcessEnv = process.env): Promise<{
	schemaFiles: string[];
}> {
	const env = readSharedProductBootstrapEnv(envOverrides);
	const prepared = await prepareSharedProductSchemas(envOverrides);
	const pool = createSharedProductPool(env);
	try {
		await migrate(drizzle(pool), {
			migrationsFolder,
			migrationsSchema: "drizzle",
			migrationsTable: "app_api_migrations",
		});
		return { schemaFiles: prepared.schemaFiles.map((path) => resolve(path)) };
	} finally {
		await pool.end();
	}
}

export async function installAppApiSchema(envOverrides: NodeJS.ProcessEnv = process.env): Promise<{
	schemaFiles: string[];
	schemaReady: true;
}> {
	const env = readSharedProductBootstrapEnv(envOverrides);
	const databaseName = decodeURIComponent(new URL(env.databaseUrl).pathname.slice(1));
	const migrated = await migrateAppApiSchema(envOverrides);
	const pool = createSharedProductPool(env);
	try {
		await pool.query("BEGIN");
		try {
			await applyAppApiGrants(pool, databaseName);
			await applyCampusServicesGrants(pool);
			await pool.query("COMMIT");
		} catch (error) {
			await pool.query("ROLLBACK");
			throw error;
		}
		await verifySchema(pool);
		return {
			schemaFiles: migrated.schemaFiles,
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
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
