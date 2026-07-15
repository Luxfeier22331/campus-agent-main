import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

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
		await client.query("CREATE SCHEMA IF NOT EXISTS ingestion_control");
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
	const databaseUrl = env.INGESTION_CONTROL_DATABASE_URL?.trim();
	if (!databaseUrl) {
		throw new Error("INGESTION_CONTROL_DATABASE_URL is required");
	}
	const pool = new Pool({
		connectionString: databaseUrl,
		connectionTimeoutMillis: MIGRATION_DATABASE_CONNECTION_TIMEOUT_MS,
	});
	let client: PoolClient | null = null;
	try {
		client = await pool.connect();
		return await applyIngestionControlMigrations(client, loadIngestionControlMigrations());
	} finally {
		client?.release();
		await pool.end();
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runIngestionControlMigrations()
		.then((applied) => console.log(JSON.stringify({ applied, schema_ready: true })))
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		});
}
