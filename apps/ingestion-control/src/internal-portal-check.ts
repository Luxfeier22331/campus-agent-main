import { Pool } from "pg";
import { runScheduledInternalPortalChecks } from "./internal-portal-credential-service.ts";
import { createPgInternalPortalCredentialStore } from "./internal-portal-credential-store.ts";
import { readPostgresConnectionConfig } from "./postgres-config.ts";

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
	const database = readPostgresConnectionConfig(env, {
		caCertPath: "INGESTION_CONTROL_DATABASE_CA_CERT_PATH",
		connectionString: "INGESTION_CONTROL_DATABASE_URL",
		sslMode: "INGESTION_CONTROL_DATABASE_SSLMODE",
	});
	const pool = new Pool({ ...database, connectionTimeoutMillis: 10_000 });
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

if (import.meta.url === `file://${process.argv[1]}`) {
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
