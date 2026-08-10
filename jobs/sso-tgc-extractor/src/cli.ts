#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSSOTGC } from "./extract";
import { loadConfig } from "./config";
import { syncViaAutomationApi } from "./report";
import type { CredentialSyncResult, ExtractionOutput, SsoTgcResult } from "./types";

interface CliArgs {
	dryRun: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
	return {
		dryRun: argv.includes("--dry-run"),
	};
}

export function buildExtractionOutput(
	args: CliArgs,
	cookieData: SsoTgcResult,
	sync?: CredentialSyncResult,
): ExtractionOutput {
	if (args.dryRun) {
		return {
			mode: "dry-run",
			extractedAt: cookieData.extractedAt,
			reused: cookieData.reused,
		};
	}
	if (!sync) {
		throw new Error("凭据同步结果缺失。");
	}
	return { mode: "sync", ...sync };
}

export async function main(): Promise<void> {
	const args = parseCliArgs(process.argv.slice(2));
	const config = loadConfig({ dryRun: args.dryRun });

	const cookieData = await getSSOTGC(config);

	if (args.dryRun) {
		console.log(JSON.stringify(buildExtractionOutput(args, cookieData), null, 2));
		return;
	}

	const result = await syncViaAutomationApi(config, cookieData);
	console.log(JSON.stringify(buildExtractionOutput(args, cookieData, result), null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
