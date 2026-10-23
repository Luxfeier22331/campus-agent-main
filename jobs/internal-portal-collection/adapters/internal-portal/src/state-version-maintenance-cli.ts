import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatRawError } from "ingestion-contracts/raw-error";
import { loadInternalPortalEnv } from "./config.js";
import {
	runStateVersionMaintenance,
	withNoticeMaintenanceLock,
} from "./state-version-maintenance.js";

function parseArgs(argv: string[]): { apply: boolean; backupFile?: string } {
	let apply = false;
	let backupFile: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		switch (argv[index]) {
			case "--apply":
				apply = true;
				break;
			case "--backup-file":
				backupFile = argv[++index];
				if (!backupFile) throw new Error("--backup-file requires a path");
				break;
			case "--help":
				console.log("Usage: state-version-maintenance [--apply --backup-file PATH]");
				process.exitCode = 0;
				return { apply: false };
			default:
				throw new Error(`unknown argument: ${argv[index]}`);
		}
	}
	if (!apply && backupFile) {
		throw new Error("--backup-file is only valid with --apply");
	}
	return { apply, ...(backupFile ? { backupFile } : {}) };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
	const options = parseArgs(argv);
	if (process.exitCode === 0 && argv.includes("--help")) return 0;
	loadInternalPortalEnv();
	const env = process.env;
	const report = await withNoticeMaintenanceLock(env, () =>
		runStateVersionMaintenance({ env, ...options }),
	);
	console.log(
		JSON.stringify(
			{
				...report,
				mode: options.apply ? "apply" : "dry-run",
				retained: {
					bucket: report.bucket,
					key: report.key,
					versionId: report.currentVersionId,
				},
			},
			null,
			2,
		),
	);
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error) => {
		console.error(formatRawError(error));
		process.exitCode = 1;
	});
}
