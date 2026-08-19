import { loadInternalPortalEnv } from "./config.js";
import { runFileSync } from "./file-sync.js";
import { formatSafeErrorMessage } from "./safe-error.js";

export async function main(): Promise<void> {
	loadInternalPortalEnv();
	const summary = await runFileSync({ env: process.env });
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
