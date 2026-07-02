import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { bootstrapSharedProductDatabase } from "./shared-product-database-bootstrap.mjs";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "../..");

const REQUIRED_DINING_FLOORS = [
	{ floorId: "haidian-canteen-1-1f", hallId: "haidian-canteen-1" },
	{ floorId: "haidian-canteen-2", hallId: "haidian-canteen-2" },
	{ floorId: "haidian-canteen-4", hallId: "haidian-canteen-4" },
	{ floorId: "fengtai-huixian-canteen-1f", hallId: "fengtai-huixian-canteen" },
	{ floorId: "fengtai-huixian-canteen-2f", hallId: "fengtai-huixian-canteen" },
	{ floorId: "fengtai-juya-canteen-1f", hallId: "fengtai-juya-canteen" },
	{ floorId: "fengtai-juya-canteen-2f", hallId: "fengtai-juya-canteen" },
];

const bootstrapResult = await bootstrapSharedProductDatabase(process.env);
console.log(`auth_schema: ${bootstrapResult.authSchema}`);
console.log(`chat_schema: ${bootstrapResult.chatSchema}`);
console.log("applied_migrations:");
for (const migrationFile of bootstrapResult.migrationFiles) {
	console.log(`- ${migrationFile}`);
}

await run("pnpm", ["--dir", "jobs/dining-sync", "exec", "tsx", "src/cli.ts", "import-dev-seed"], {
	cwd: repoRoot,
	env: {
		...process.env,
		DATABASE_URL: requireDatabaseUrl(process.env),
	},
});

const pool = new Pool({
	connectionString: requireDatabaseUrl(process.env),
	ssl: resolveSsl(process.env.APP_API_DATABASE_SSLMODE?.trim() || "require"),
});

try {
	await verifyDiningSchema(pool);
	await verifyPublishedDiningSnapshot(pool);
} finally {
	await pool.end();
}

function requireDatabaseUrl(env) {
	const databaseUrl = env.DATABASE_URL?.trim() || env.APP_API_OPERATOR_DATABASE_URL?.trim();
	if (!databaseUrl) {
		throw new Error(
			"APP_API_OPERATOR_DATABASE_URL or DATABASE_URL is required for local dining preparation. Run the current-worktree env sync/link step before this command.",
		);
	}
	return databaseUrl;
}

function resolveSsl(databaseSslMode) {
	return databaseSslMode === "disable"
		? false
		: {
				rejectUnauthorized: false,
			};
}

async function verifyDiningSchema(pool) {
	const result = await pool.query(
		`
      select column_name
      from information_schema.columns
      where table_schema = 'dining'
        and table_name = 'review_projections'
        and column_name = any($1::text[])
    `,
		[["stall_profile_id", "window_id"]],
	);
	const columns = new Set(result.rows.map((row) => row.column_name));
	for (const column of ["stall_profile_id", "window_id"]) {
		if (!columns.has(column)) {
			throw new Error(
				`Dining schema is missing dining.review_projections.${column}. Shared-product migrations did not converge.`,
			);
		}
	}
}

async function verifyPublishedDiningSnapshot(pool) {
	const result = await pool.query(`
    select rs.payload_json
    from dining.release_latest_pointer lp
    join dining.release_snapshots rs on rs.release_id = lp.release_id
    where lp.scope = 'global'
    limit 1
  `);
	const snapshot = result.rows[0]?.payload_json;
	if (!snapshot || typeof snapshot !== "object") {
		throw new Error("Dining published snapshot is missing after dev seed import.");
	}
	const halls = Array.isArray(snapshot.halls) ? snapshot.halls : [];
	const floors = snapshot.floors && typeof snapshot.floors === "object" ? snapshot.floors : {};
	const visibleHallIds = new Set(halls.map((hall) => hall.hallId));

	for (const required of REQUIRED_DINING_FLOORS) {
		if (!visibleHallIds.has(required.hallId)) {
			throw new Error(`Dining published snapshot is missing hall: ${required.hallId}.`);
		}
		const floor = floors[`${required.hallId}:${required.floorId}`];
		if (!floor) {
			throw new Error(
				`Dining published snapshot is missing floor: ${required.hallId}/${required.floorId}.`,
			);
		}
		if (!Array.isArray(floor.windows) || floor.windows.length === 0) {
			throw new Error(
				`Dining published snapshot floor has no windows: ${required.hallId}/${required.floorId}.`,
			);
		}
		if (!Array.isArray(floor.assignments) || floor.assignments.length === 0) {
			throw new Error(
				`Dining published snapshot floor has no assignments: ${required.hallId}/${required.floorId}.`,
			);
		}
		if (!Array.isArray(floor.menuOfferings) || floor.menuOfferings.length === 0) {
			throw new Error(
				`Dining published snapshot floor has no menu offerings: ${required.hallId}/${required.floorId}.`,
			);
		}
	}

	console.log(
		JSON.stringify(
			{
				floors: REQUIRED_DINING_FLOORS,
				hallIds: [...visibleHallIds].sort(),
				status: "local_dining_ready",
			},
			null,
			2,
		),
	);
}

function run(command, args, input = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: input.cwd,
			env: input.env,
			shell: process.platform === "win32",
			stdio: "inherit",
		});

		child.on("exit", (code, signal) => {
			if (signal) {
				reject(new Error(`${command} ${args.join(" ")} exited by signal ${signal}.`));
				return;
			}
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}.`));
		});

		child.on("error", reject);
	});
}
