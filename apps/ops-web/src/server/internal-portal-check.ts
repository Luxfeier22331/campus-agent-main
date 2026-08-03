import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	runScheduledInternalPortalChecks,
	type ScheduledInternalPortalCheck,
	type ScheduledInternalPortalCheckRun,
} from "./internal-portal-credential-service.ts";
import {
	createInternalPortalCredentialStoreFromEnv,
	InternalPortalCredentialStoreUnavailableError,
} from "./internal-portal-credential-store.ts";

export async function main(): Promise<void> {
	const startedAt = performance.now();
	const run = await runScheduledInternalPortalChecks({
		store: createInternalPortalCredentialStoreFromEnv(process.env),
	});
	for (const check of run.checks) {
		console.log(JSON.stringify(buildCredentialCheckEvent(check)));
	}
	const failed = run.checks.filter(
		(check) => check.outcome === "credential_rejected" || check.outcome === "check_failed",
	);
	console.log(JSON.stringify(buildCheckRunEvent(run, elapsedMilliseconds(startedAt))));
	if (failed.length > 0) {
		process.exitCode = 1;
	}
}

export function buildCredentialCheckEvent(check: ScheduledInternalPortalCheck) {
	return {
		duration_ms: check.durationMs,
		event_type: "internal_portal.credential_check",
		...(check.failureKind ? { failure_kind: check.failureKind } : {}),
		"internal_portal.credential_id": check.credentialId,
		"internal_portal.credential_name": check.credentialName,
		"internal_portal.refreshed": check.refreshed,
		level:
			check.outcome === "credential_rejected" || check.outcome === "check_failed"
				? "error"
				: check.outcome === "stale"
					? "warning"
					: "info",
		status: check.outcome,
	};
}

export function buildCheckRunEvent(run: ScheduledInternalPortalCheckRun, durationMs: number) {
	const failedCount = run.checks.filter(
		(check) => check.outcome === "credential_rejected" || check.outcome === "check_failed",
	).length;
	return {
		duration_ms: durationMs,
		event_type: "internal_portal.check_run",
		"internal_portal.checked_count": run.checks.length,
		"internal_portal.failed_count": failedCount,
		"internal_portal.stale_count": run.checks.filter((check) => check.outcome === "stale").length,
		"internal_portal.suspended_count": run.suspended.length,
		level: failedCount > 0 ? "error" : "info",
		status: failedCount > 0 ? "failed" : "succeeded",
	};
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

function elapsedMilliseconds(startedAt: number): number {
	return Math.max(0, Math.round(performance.now() - startedAt));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const startedAt = performance.now();
	void main().catch((error) => {
		console.error(JSON.stringify(buildCheckRunFailureEvent(error, elapsedMilliseconds(startedAt))));
		process.exitCode = 1;
	});
}
