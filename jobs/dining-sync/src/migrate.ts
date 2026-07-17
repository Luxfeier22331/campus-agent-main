import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

const migrationId = "0001_dining";
const migrationPath = resolve(
	fileURLToPath(new URL("..", import.meta.url)),
	"migrations/0001_dining.sql",
);

export async function migrateDining(databaseUrl: string): Promise<void> {
	const sql = await readFile(migrationPath, "utf8");
	const sha256 = createHash("sha256").update(sql).digest("hex");
	const client = new Client({ connectionString: databaseUrl });
	await client.connect();
	try {
		await client.query(`CREATE TABLE IF NOT EXISTS public.dining_migrations (
			migration_id text PRIMARY KEY,
			sha256 text NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`);
		const applied = await client.query(
			"SELECT sha256 FROM public.dining_migrations WHERE migration_id = $1",
			[migrationId],
		);
		const appliedSha256 = applied.rows[0]?.sha256;
		if (appliedSha256) {
			if (appliedSha256 !== sha256) {
				throw new Error(`Dining migration ${migrationId} changed after it was applied.`);
			}
			return;
		}
		await client.query("BEGIN");
		try {
			await client.query(sql);
			await client.query(
				"INSERT INTO public.dining_migrations(migration_id, sha256) VALUES ($1, $2)",
				[migrationId, sha256],
			);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		}
	} finally {
		await client.end();
	}
}
