import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	COLLECTION_USAGE,
	isCollectionHelp,
	parseCollectionCommand,
	runCollectionCommand,
} from "./collection-command.js";
import { loadInternalPortalEnv } from "./config.js";
import { resolveInternalPortalCredentialFromEnv } from "./ingestion-control-credential-resolver.js";
import { formatSafeErrorMessage } from "./safe-error.js";

export async function main(
	argv: string[] = process.argv.slice(2),
	env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
	if (isCollectionHelp(argv)) {
		console.log(COLLECTION_USAGE);
		return 0;
	}
	loadInternalPortalEnv(env);
	const command = parseCollectionCommand(argv);
	const credential = await resolveInternalPortalCredentialFromEnv(env);
	return await runCollectionCommand(command, { env, ssoTgc: credential.ssoTgc });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main()
		.then((status) => {
			process.exitCode = status;
		})
		.catch((error) => {
			console.error(formatSafeErrorMessage(error));
			process.exitCode = 1;
		});
}
