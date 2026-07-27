import {
	type InternalPortalConfig,
	loadInternalPortalEnv,
	resolveInternalPortalConfig,
} from "./config.js";
import { checkPortalAuthentication } from "./portal.js";
import { formatSafeErrorMessage } from "./safe-error.js";

export const AUTH_CHECK_TIMEOUT_MS = 60_000;

export interface AuthCheckDependencies {
	abortSignal?: AbortSignal;
	config?: InternalPortalConfig;
	checkAuthentication?: typeof checkPortalAuthentication;
}

export async function checkAuth(dependencies: AuthCheckDependencies = {}): Promise<void> {
	const config = dependencies.config ?? resolveInternalPortalConfig(process.env);
	const timeoutSignal = AbortSignal.timeout(AUTH_CHECK_TIMEOUT_MS);
	const abortSignal = dependencies.abortSignal
		? AbortSignal.any([dependencies.abortSignal, timeoutSignal])
		: timeoutSignal;
	await (dependencies.checkAuthentication ?? checkPortalAuthentication)(config, { abortSignal });
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
