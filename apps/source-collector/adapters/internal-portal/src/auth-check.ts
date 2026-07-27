import {
	type InternalPortalConfig,
	loadInternalPortalEnv,
	resolveInternalPortalConfig,
} from "./config.js";
import { checkPortalAuthentication } from "./portal.js";
import { formatSafeErrorMessage } from "./safe-error.js";

export interface AuthCheckDependencies {
	config?: InternalPortalConfig;
	checkAuthentication?: (config: InternalPortalConfig) => Promise<void>;
}

export async function checkAuth(dependencies: AuthCheckDependencies = {}): Promise<void> {
	const config = dependencies.config ?? resolveInternalPortalConfig(process.env);
	await (dependencies.checkAuthentication ?? checkPortalAuthentication)(config);
}

export async function main(): Promise<void> {
	loadInternalPortalEnv();
	await checkAuth();
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
