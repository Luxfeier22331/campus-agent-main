import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpsWebDatabasePool } from "../src/server/database.ts";
import { runScheduledInternalPortalChecks } from "../src/server/internal-portal-credential-service.ts";
import { createPgInternalPortalCredentialStore } from "../src/server/internal-portal-credential-store.ts";

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
	const pool = createOpsWebDatabasePool(env);
	try {
		const result = await runScheduledInternalPortalChecks({
			store: createPgInternalPortalCredentialStore(pool),
		});
		console.log(
			JSON.stringify({
				checked: result.checks.length,
				event_type: "internal_portal.check_run",
				status: "completed",
				suspended: result.suspended.length,
			}),
		);
	} finally {
		await pool.end();
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	const startedAt = performance.now();
	main().catch((error) => {
		console.error(
			JSON.stringify({
				duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
				error_code:
					error instanceof Error && /^[A-Za-z0-9_.:-]{1,80}$/u.test(error.name)
						? error.name
						: "internal_portal_check_failed",
				event_type: "internal_portal.check_run",
				level: "error",
				status: "failed",
			}),
		);
		process.exitCode = 1;
	});
}
