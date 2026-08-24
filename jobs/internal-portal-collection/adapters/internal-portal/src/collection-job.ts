import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatNoticeJobError } from "ingestion-contracts/job-error";

import {
	type CollectionCommand,
	isCollectionHelp,
	runCollectionCommand,
} from "./collection-command.js";
import { parseNoticeStartDate } from "./notice-runner.js";
import { loadInternalPortalEnv } from "./config.js";
import { resolveInternalPortalCredentialFromEnv } from "./ops-web-credential-resolver.js";

export async function main(
	argv: string[] = process.argv.slice(2),
	env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
	if (isCollectionHelp(argv)) {
		console.log("Usage: notice-sync | notice-backfill | file-sync");
		return 0;
	}
	loadInternalPortalEnv(env);
	const command = parseCollectionJobCommand(argv, env);
	console.log(JSON.stringify({ mode: command.mode, status: "started" }));
	const credential = await resolveInternalPortalCredentialFromEnv(env);
	return await runCollectionCommand(command, { env, ssoTgc: credential.ssoTgc });
}

export function parseCollectionJobCommand(
	argv: readonly string[],
	env: NodeJS.ProcessEnv,
): CollectionCommand {
	if (argv.length !== 1) throw jobUsageError();
	const mode = argv[0];
	if (mode === "notice-sync" || mode === "file-sync") return { mode };
	if (mode === "notice-backfill") {
		const startDate = env.INTERNAL_PORTAL_NOTICE_START_DATE?.trim();
		if (!startDate) {
			throw new Error("INTERNAL_PORTAL_NOTICE_START_DATE is required");
		}
		return { mode, startDate: parseNoticeStartDate(startDate) };
	}
	throw jobUsageError();
}

function jobUsageError(): Error {
	return new Error("Usage: notice-sync | notice-backfill | file-sync");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main()
		.then((status) => {
			process.exitCode = status;
		})
		.catch((error) => {
			console.error(formatNoticeJobError(error));
			process.exitCode = 1;
		});
}
