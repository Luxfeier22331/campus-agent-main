import { loadInternalPortalEnv } from "./config.js";
import { resolveInternalPortalCredentialFromEnv } from "./ingestion-control-credential-resolver.js";
import { parseNoticeCommand, runNoticeCommand } from "./notice-cli.js";
import { formatSafeErrorMessage } from "./safe-error.js";

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	loadInternalPortalEnv();
	const command = parseNoticeCommand(["sync", ...argv]);
	const credential = await resolveInternalPortalCredentialFromEnv(process.env);
	await runNoticeCommand(command, {
		env: process.env,
		ssoTgc: credential.ssoTgc,
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
