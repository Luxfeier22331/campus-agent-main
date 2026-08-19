import { loadInternalPortalEnv } from "./config.js";
import { runFileSync } from "./file-sync.js";
import { resolveInternalPortalCredentialFromEnv } from "./ingestion-control-credential-resolver.js";
import { formatSafeErrorMessage } from "./safe-error.js";

export async function main(): Promise<void> {
	loadInternalPortalEnv();
	const credential = await resolveInternalPortalCredentialFromEnv(process.env);
	const summary = await runFileSync({ env: process.env, ssoTgc: credential.ssoTgc });
	console.log(JSON.stringify(summary));
	if (summary.failed > 0) {
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
