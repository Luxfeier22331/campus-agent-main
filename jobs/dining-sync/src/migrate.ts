import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { applyDiningDatabaseGrants } from "./database-grants.ts";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function installDiningDatabase(databaseUrl: string): Promise<{
	roles: string[];
	status: "ready";
}> {
	await migrateDining(databaseUrl);
	return applyDiningDatabaseGrants(databaseUrl, ["app_api", "dining_sync", "ops_web_dining"]);
}

export async function migrateDining(databaseUrl: string): Promise<void> {
	const pool = new Pool({ connectionString: databaseUrl, max: 1 });
	try {
		await migrate(drizzle(pool), {
			migrationsFolder,
			migrationsSchema: "dining_migrations",
			migrationsTable: "history",
		});
		await verifyDiningSchema(pool);
	} finally {
		await pool.end();
	}
}

async function verifyDiningSchema(pool: Pick<Pool, "query">): Promise<void> {
	const requiredTables = [
		"dining.catalog_state",
		"dining.publication",
		"dining.releases",
		"dining.reviews",
		"dining.source_observations",
		"dining.source_sync_runs",
	] as const;
	const result = await pool.query<{ qualifiedName: string }>(
		`select required as "qualifiedName"
		 from unnest($1::text[]) as required
		 where to_regclass(required) is null`,
		[requiredTables],
	);
	if (result.rows.length > 0) {
		throw new Error(
			`Dining schema is missing required tables: ${result.rows
				.map((row) => row.qualifiedName)
				.join(", ")}.`,
		);
	}
}
