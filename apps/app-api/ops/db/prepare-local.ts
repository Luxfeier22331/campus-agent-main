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

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const REQUIRED_LOCAL_TABLES = ["app_auth.user", "chat.turn_dispatches"] as const;

export interface LocalSchemaInspection {
	presentTables: string[];
}

export type LocalSchemaAction = "existing" | "install";

async function inspectLocalSchema(
	pool: ReturnType<typeof createSharedProductPool>,
): Promise<LocalSchemaInspection> {
	const tables = await pool.query<{ qualifiedName: string }>(
		`select qualified_name as "qualifiedName"
		 from unnest($1::text[]) as required(qualified_name)
		 where to_regclass(qualified_name) is not null`,
		[REQUIRED_LOCAL_TABLES],
	);
	return {
		presentTables: tables.rows.map((row) => row.qualifiedName).sort(),
	};
}

function assertReadyLocalSchema(inspection: LocalSchemaInspection): void {
	if (inspection.presentTables.length !== REQUIRED_LOCAL_TABLES.length) {
		throw new Error(
			`Local app-api schema is incomplete: found ${inspection.presentTables.join(", ") || "no required tables"}. Recreate the local PostgreSQL database before running pnpm dev.`,
		);
	}
}

function countPresentTables(inspection: LocalSchemaInspection, tables: readonly string[]): number {
	return tables.filter((table) => inspection.presentTables.includes(table)).length;
}

export function resolveLocalSchemaAction(inspection: LocalSchemaInspection): LocalSchemaAction {
	const presentCount = countPresentTables(inspection, REQUIRED_LOCAL_TABLES);
	if (presentCount === REQUIRED_LOCAL_TABLES.length) {
		return "existing";
	}
	if (presentCount > 0) {
		throw new Error(
			`Local app-api schema is incomplete: found ${inspection.presentTables.join(", ")}. Recreate the local PostgreSQL database before running pnpm dev.`,
		);
	}
	return "install";
}

export async function prepareLocalAppApiSchema(
	envOverrides: NodeJS.ProcessEnv = process.env,
): Promise<{ schemaReady: true; status: "existing" | "installed" }> {
	const bootstrapEnv = {
		...envOverrides,
		APP_API_DATABASE_SSLMODE:
			envOverrides.APP_API_DATABASE_SSLMODE?.trim() === "prefer"
				? "disable"
				: envOverrides.APP_API_DATABASE_SSLMODE,
		AUTH_SHELL_ORIGIN: envOverrides.AUTH_SHELL_ORIGIN?.trim() || "http://127.0.0.1:27014",
		BETTER_AUTH_SECRET:
			envOverrides.BETTER_AUTH_SECRET?.trim() ||
			"local-schema-install-only-not-a-runtime-secret-2026",
	};
	const env = readSharedProductBootstrapEnv(bootstrapEnv);
	const pool = createSharedProductPool(env);
	try {
		const before = await inspectLocalSchema(pool);
		const action = resolveLocalSchemaAction(before);
		if (action === "existing") {
			assertReadyLocalSchema(before);
			return { schemaReady: true, status: "existing" };
		}
		await migrate(drizzle(pool), {
			migrationsFolder,
			migrationsSchema: "drizzle",
			migrationsTable: "app_api_migrations",
		});
		await bootstrapSharedProductDatabase(bootstrapEnv);
		assertReadyLocalSchema(await inspectLocalSchema(pool));
		return { schemaReady: true, status: "installed" };
	} finally {
		await pool.end();
	}
}

async function main(): Promise<void> {
	console.log(JSON.stringify(await prepareLocalAppApiSchema()));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
