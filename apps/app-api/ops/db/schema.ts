import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
	bootstrapSharedProductDatabase,
	createSharedProductPool,
	readSharedProductBootstrapEnv,
} from "../../src/script-support/shared-db/shared-product-database-bootstrap.ts";
import { applyAppApiGrants } from "./app-api-grants.ts";
import { applyOpsWebGrantStatements } from "./ops-web-database.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const REQUIRED_TABLES = [
	"app_auth.user",
	"chat.turn_dispatches",
	"docs.releases",
	"observability.ops_observability_read_audit",
	"provider_config.connections",
	"provider_config.profiles",
	"runtime.request_observability_fact",
] as const;
const RETIRED_TABLES = ["runtime.projection_outbox", "runtime.request_execution"] as const;
const RETIRED_SCHEMAS = ["official_web", "operator", "wechat_official_account"] as const;

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
		canReadDocs: boolean;
		canWriteDocs: boolean;
		canWriteObservability: boolean;
		docsPublisherCanWrite: boolean;
		appApiCanReadProviderConfig: boolean;
		providerConfigOwnerCanWrite: boolean;
	}>(
		`select
			has_table_privilege('app_api', 'chat.turn_dispatches', 'SELECT,INSERT,UPDATE,DELETE') as "canMutateDispatches",
			has_table_privilege('app_api', 'docs.releases', 'SELECT') as "canReadDocs",
			has_table_privilege('app_api', 'docs.releases', 'INSERT,UPDATE,DELETE') as "canWriteDocs",
			has_table_privilege('docs_publish', 'docs.releases', 'SELECT,INSERT,UPDATE,DELETE') as "docsPublisherCanWrite",
			has_table_privilege('app_api', 'provider_config.connections', 'SELECT') as "appApiCanReadProviderConfig",
			has_table_privilege('ops_web_provider_config', 'provider_config.connections', 'SELECT,INSERT,UPDATE') as "providerConfigOwnerCanWrite",
			case
				when to_regclass('runtime.agent_runs') is null then false
				else has_table_privilege('app_api', 'runtime.agent_runs', 'SELECT')
			end as "canReadAgentRuns",
			has_table_privilege('app_api', 'runtime.request_observability_fact', 'SELECT,INSERT,UPDATE,DELETE') as "canWriteObservability"`,
	);
	const privilege = privileges.rows[0];
	if (
		!(privilege?.canMutateDispatches && privilege.canReadDocs && privilege.canWriteObservability)
	) {
		throw new Error("app_api role is missing required table privileges.");
	}
	if (privilege.canWriteDocs) {
		throw new Error("app_api role must not mutate docs release projections.");
	}
	if (!privilege.docsPublisherCanWrite) {
		throw new Error("docs_publish role is missing required docs table privileges.");
	}
	if (privilege.appApiCanReadProviderConfig) {
		throw new Error("app_api role must not read provider config.");
	}
	if (!privilege.providerConfigOwnerCanWrite) {
		throw new Error("ops_web_provider_config role is missing required privileges.");
	}
	if (privilege.canReadAgentRuns) {
		throw new Error("app_api role must not read execution-control run tables.");
	}
}

export async function installAppApiSchema(envOverrides: NodeJS.ProcessEnv = process.env): Promise<{
	schemaFiles: string[];
	schemaReady: true;
}> {
	const bootstrapEnv = {
		...envOverrides,
		BETTER_AUTH_SECRET:
			envOverrides.BETTER_AUTH_SECRET?.trim() || "schema-install-only-not-a-runtime-secret-2026",
	};
	const env = readSharedProductBootstrapEnv(bootstrapEnv);
	const bootstrap = await bootstrapSharedProductDatabase(bootstrapEnv);
	const pool = createSharedProductPool(env);
	try {
		await migrate(drizzle(pool), {
			migrationsFolder,
			migrationsSchema: "drizzle",
			migrationsTable: "app_api_migrations",
		});
		await pool.query("BEGIN");
		try {
			await applyAppApiGrants(pool);
			await applyOpsWebGrantStatements(pool);
			await pool.query("COMMIT");
		} catch (error) {
			await pool.query("ROLLBACK");
			throw error;
		}
		await verifySchema(pool);
		return {
			schemaFiles: bootstrap.schemaFiles.map((path) => resolve(path)),
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
