import { Pool, type PoolClient } from "pg";
import { readPostgresConnectionConfig } from "./postgres-config";

const SCHEMA_DATABASE_CONNECTION_TIMEOUT_MS = 10_000;

export interface IngestionControlSchemaClient {
	query(sql: string): Promise<unknown>;
}

export async function bootstrapIngestionControlSchema(
	client: IngestionControlSchemaClient,
): Promise<void> {
	await client.query("CREATE SCHEMA IF NOT EXISTS ingestion_control");
	await client.query("REVOKE ALL ON SCHEMA ingestion_control FROM PUBLIC");
	await client.query("GRANT USAGE, CREATE ON SCHEMA ingestion_control TO ingestion_control");
}

export async function runIngestionControlSchemaBootstrap(
	env: Record<string, string | undefined> = process.env,
): Promise<void> {
	const database = readPostgresConnectionConfig(env, {
		caCertPath: "INGESTION_CONTROL_SCHEMA_DATABASE_CA_CERT_PATH",
		connectionString: "INGESTION_CONTROL_SCHEMA_DATABASE_URL",
		sslMode: "INGESTION_CONTROL_SCHEMA_DATABASE_SSLMODE",
	});
	const pool = new Pool({
		...database,
		connectionTimeoutMillis: SCHEMA_DATABASE_CONNECTION_TIMEOUT_MS,
	});
	let client: PoolClient | null = null;
	try {
		client = await pool.connect();
		await bootstrapIngestionControlSchema(client);
	} finally {
		client?.release();
		await pool.end();
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runIngestionControlSchemaBootstrap()
		.then(() => console.log(JSON.stringify({ schema_ready: true })))
		.catch(() => {
			console.error(
				JSON.stringify({
					error_code: "schema_bootstrap_failed",
					event_type: "ingestion_control.schema_bootstrap_failed",
					level: "error",
					status: "failed",
				}),
			);
			process.exitCode = 1;
		});
}
