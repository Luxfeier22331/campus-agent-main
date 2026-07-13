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
	"observability.ops_observability_read_audit",
	"operator.authenticated_notice_processing_projection",
	"runtime.request_observability_fact",
] as const;
const RETIRED_TABLES = [
	"operator.request_audit_projection",
	"operator.request_projection",
	"operator.temporal_task_queue_current",
	"operator.temporal_task_queue_snapshot",
	"operator.worker_autoscaler_actuation",
	"operator.worker_autoscaler_decision",
	"operator.worker_autoscaler_decision_current",
	"operator.worker_autoscaler_posture",
	"runtime.projection_outbox",
	"runtime.request_execution",
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

	const privileges = await pool.query<{
		canMutateDispatches: boolean;
		canReadAgentRuns: boolean;
		canWriteObservability: boolean;
	}>(
		`select
			has_table_privilege('app_api', 'chat.turn_dispatches', 'SELECT,INSERT,UPDATE,DELETE') as "canMutateDispatches",
			case
				when to_regclass('runtime.agent_runs') is null then false
				else has_table_privilege('app_api', 'runtime.agent_runs', 'SELECT')
			end as "canReadAgentRuns",
			has_table_privilege('app_api', 'runtime.request_observability_fact', 'SELECT,INSERT,UPDATE,DELETE') as "canWriteObservability"`,
	);
	const privilege = privileges.rows[0];
	if (!(privilege?.canMutateDispatches && privilege.canWriteObservability)) {
		throw new Error("app_api role is missing required table privileges.");
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
	const pool = createSharedProductPool(env);
	try {
		await migrate(drizzle(pool), {
			migrationsFolder,
			migrationsSchema: "drizzle",
			migrationsTable: "app_api_migrations",
		});
		const bootstrap = await bootstrapSharedProductDatabase(bootstrapEnv);
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
