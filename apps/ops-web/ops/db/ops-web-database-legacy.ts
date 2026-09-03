import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { migrateDiningSchema } from "./dining-migrations.ts";
import {
	applyOpsWebDatabaseGrants,
	applyOpsWebDiningGrants,
	verifyOpsWebDatabase,
} from "./ops-web-database.ts";
import { readDatabaseConnectionConfig } from "./postgres-tls.ts";

const LEGACY_HANDOFF_CLEANUP = `DO $ops_web_ingestion_control_cleanup$
DECLARE
	unexpected_objects text;
BEGIN
	IF pg_catalog.to_regnamespace('ingestion_control') IS NOT NULL THEN
		SELECT pg_catalog.string_agg(class.relname, ', ' ORDER BY class.relname)
		INTO unexpected_objects
		FROM pg_catalog.pg_class class
		JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
		WHERE namespace.nspname = 'ingestion_control'
			AND class.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
			AND class.relname <> 'schema_migrations';
		IF unexpected_objects IS NOT NULL THEN
			RAISE EXCEPTION
				'ingestion_control contains unexpected objects: %', unexpected_objects;
		END IF;
		EXECUTE 'DROP SCHEMA "ingestion_control" CASCADE';
	END IF;
END
$ops_web_ingestion_control_cleanup$`;

function schemaAdminConfig(env: NodeJS.ProcessEnv) {
	return readDatabaseConnectionConfig(env, {
		caCertPath: "OPS_WEB_SCHEMA_DATABASE_CA_CERT_PATH",
		databaseUrl: "OPS_WEB_SCHEMA_DATABASE_URL",
		sslMode: "OPS_WEB_SCHEMA_DATABASE_SSLMODE",
	});
}

async function withSchemaAdmin<T>(
	env: NodeJS.ProcessEnv,
	run: (client: pg.Client) => Promise<T>,
): Promise<T> {
	const config = schemaAdminConfig(env);
	const client = new pg.Client({
		connectionString: config.connectionString,
		ssl: config.ssl,
	});
	await client.connect();
	try {
		return await run(client);
	} finally {
		await client.end();
	}
}

async function migrateLegacyDiningSchema(
	env: NodeJS.ProcessEnv,
	options: { cleanupHandoff: boolean },
): Promise<void> {
	await withSchemaAdmin(env, async (client) => {
		await migrateDiningSchema(client);
		if (options.cleanupHandoff) {
			await client.query(LEGACY_HANDOFF_CLEANUP);
		}
	});
}

/**
 * Compatibility entry point for the historical Ops Web database apply command.
 * New databases must use jobs/campus-agent-schema instead.
 */
export async function applyLegacyOpsWebDatabase(env: NodeJS.ProcessEnv = process.env): Promise<{
	diningMap: "ready";
	internalPortal: "ready";
	opsWebRole: "ready";
	readModel: "ready";
}> {
	await migrateLegacyDiningSchema(env, { cleanupHandoff: true });
	return applyOpsWebDatabaseGrants(env);
}

export async function applyDiningDatabase(
	env: NodeJS.ProcessEnv = process.env,
): Promise<{ diningMap: "ready" }> {
	await migrateLegacyDiningSchema(env, { cleanupHandoff: false });
	return applyOpsWebDiningGrants(env);
}

async function main(): Promise<void> {
	const action = process.argv[2];
	if (action !== "apply" && action !== "apply-dining" && action !== "verify") {
		throw new Error("Usage: ops-web-database-legacy.ts <apply|apply-dining|verify>");
	}
	const result =
		action === "apply"
			? await applyLegacyOpsWebDatabase()
			: action === "apply-dining"
				? await applyDiningDatabase()
				: await verifyOpsWebDatabase();
	console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
