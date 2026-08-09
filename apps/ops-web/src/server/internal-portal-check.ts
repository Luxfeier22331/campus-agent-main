import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runScheduledInternalPortalChecks } from "./internal-portal-credential-service.ts";
import {
	createInternalPortalCredentialStoreFromEnv,
	InternalPortalCredentialStoreUnavailableError,
} from "./internal-portal-credential-store.ts";

export async function main(): Promise<void> {
	await runScheduledInternalPortalChecks({
		store: createInternalPortalCredentialStoreFromEnv(process.env),
	});
}

export function buildCheckRunFailureEvent(error: unknown, durationMs: number) {
	return {
		duration_ms: durationMs,
		event_type: "internal_portal.check_run",
		failure_kind:
			error instanceof InternalPortalCredentialStoreUnavailableError
				? "store_unavailable"
				: "unexpected",
		level: "error",
		status: "failed",
	};
}

export async function runCli(run: () => Promise<void> = main): Promise<void> {
	const startedAt = performance.now();
	try {
		await run();
	} catch (error) {
		console.error(JSON.stringify(buildCheckRunFailureEvent(error, elapsedMilliseconds(startedAt))));
		process.exitCode = 1;
	}
}

function elapsedMilliseconds(startedAt: number): number {
	return Math.max(0, Math.round(performance.now() - startedAt));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void runCli();
}
