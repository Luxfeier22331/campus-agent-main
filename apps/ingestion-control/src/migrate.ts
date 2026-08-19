import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { readPostgresConnectionConfig } from "./postgres-config";

const MIGRATION_FILE_PATTERN = /^\d+_[a-z0-9_-]+\.sql$/u;
const MIGRATION_LOCK_ID = "74021920260713";
const MIGRATION_DATABASE_CONNECTION_TIMEOUT_MS = 10_000;

export interface IngestionControlMigration {
	contentSha256: string;
	migrationId: string;
	sql: string;
}

export interface IngestionControlMigrationClient {
	query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export function loadIngestionControlMigrations(
	directory = fileURLToPath(new URL("../migrations", import.meta.url)),
): IngestionControlMigration[] {
	const migrations = readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
		.map((entry) => entry.name)
		.sort()
		.map((migrationId) => {
			const sql = readFileSync(resolve(directory, migrationId), "utf8");
			return {
				contentSha256: createHash("sha256").update(sql).digest("hex"),
				migrationId,
				sql,
			};
		});
	if (migrations.length === 0) {
		throw new Error(`no ingestion-control migrations found in ${directory}`);
	}
	return migrations;
}

export async function applyIngestionControlMigrations(
	client: IngestionControlMigrationClient,
	migrations: readonly IngestionControlMigration[],
): Promise<string[]> {
	const applied: string[] = [];
	await client.query("BEGIN");
	try {
		await client.query("SET LOCAL lock_timeout = '30s'");
		await client.query(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID}::bigint)`);
		await client.query(
			`CREATE TABLE IF NOT EXISTS ingestion_control.schema_migrations (
				migration_id text PRIMARY KEY,
				content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
				applied_at timestamptz NOT NULL DEFAULT now()
			)`,
		);
		for (const migration of migrations) {
			const existing = await client.query(
				`SELECT content_sha256
				 FROM ingestion_control.schema_migrations
				 WHERE migration_id = $1`,
				[migration.migrationId],
			);
			if (existing.rows[0]) {
				if (existing.rows[0].content_sha256 !== migration.contentSha256) {
					throw new Error(
						`ingestion-control migration was modified after apply: ${migration.migrationId}`,
					);
				}
				continue;
			}
			await client.query(migration.sql);
			await client.query(
				`INSERT INTO ingestion_control.schema_migrations (migration_id, content_sha256)
				 VALUES ($1, $2)`,
				[migration.migrationId, migration.contentSha256],
			);
			applied.push(migration.migrationId);
		}
		await client.query("REVOKE ALL ON SCHEMA ingestion_control FROM PUBLIC, ingestion_control");
		await client.query("GRANT USAGE ON SCHEMA ingestion_control TO ingestion_control");
		await client.query(
			"REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ingestion_control FROM PUBLIC, ingestion_control",
		);
		await client.query(
			"REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ingestion_control FROM PUBLIC, ingestion_control",
		);
		await client.query(
			`GRANT SELECT, INSERT, UPDATE, DELETE
			 ON TABLE ingestion_control.internal_portal_credentials
			 TO ingestion_control`,
		);
		await client.query("COMMIT");
		return applied;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

export async function runIngestionControlMigrations(
	env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
	const database = readPostgresConnectionConfig(env, {
		caCertPath: "INGESTION_CONTROL_SCHEMA_DATABASE_CA_CERT_PATH",
		connectionString: "INGESTION_CONTROL_SCHEMA_DATABASE_URL",
		sslMode: "INGESTION_CONTROL_SCHEMA_DATABASE_SSLMODE",
	});
	const pool = new Pool({
		...database,
		connectionTimeoutMillis: MIGRATION_DATABASE_CONNECTION_TIMEOUT_MS,
	});
	let client: PoolClient | null = null;
	try {
		client = await pool.connect();
		const role = await client.query<{ currentUser: string }>(
			`SELECT current_user AS "currentUser"`,
		);
		assertIngestionControlMigrationRole(role.rows[0]?.currentUser);
		return await applyIngestionControlMigrations(client, loadIngestionControlMigrations());
	} finally {
		client?.release();
		await pool.end();
	}
}

export function assertIngestionControlMigrationRole(currentUser: string | undefined): void {
	if (!currentUser) {
		throw new Error("ingestion-control migration could not resolve the database role");
	}
	if (currentUser === "ingestion_control") {
		throw new Error("ingestion-control migrations cannot run as the runtime role");
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runIngestionControlMigrations()
		.then((applied) => console.log(JSON.stringify({ applied, schema_ready: true })))
		.catch(() => {
			console.error(
				JSON.stringify({
					error_code: "migration_failed",
					event_type: "ingestion_control.migration_failed",
					level: "error",
					status: "failed",
				}),
			);
			process.exitCode = 1;
		});
}
