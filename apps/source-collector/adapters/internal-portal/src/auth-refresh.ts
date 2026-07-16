import { loadInternalPortalEnv, resolveInternalPortalConfig } from "./config.js";
import { refreshPortalAuthentication } from "./portal.js";
import { formatSafeErrorMessage } from "./safe-error.js";

export async function main(): Promise<void> {
	loadInternalPortalEnv();
	const result = await refreshPortalAuthentication(resolveInternalPortalConfig(process.env));
	console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
