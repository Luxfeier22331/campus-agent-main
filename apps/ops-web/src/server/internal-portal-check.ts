import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runScheduledInternalPortalChecks } from "./internal-portal-credential-service.ts";
import { createInternalPortalCredentialStoreFromEnv } from "./internal-portal-credential-store.ts";

export async function main(): Promise<void> {
	const checks = await runScheduledInternalPortalChecks({
		store: createInternalPortalCredentialStoreFromEnv(process.env),
	});
	const failed = checks.filter(
		(check) => check.outcome === "credential_rejected" || check.outcome === "check_failed",
	);
	console.log(
		JSON.stringify({
			checked: checks.length,
			failed: failed.length,
			outcomes: checks,
		}),
	);
	if (failed.length > 0) {
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error) => {
		console.error(error instanceof Error ? error.message : "内部门户凭据检查失败。");
		process.exitCode = 1;
	});
}
