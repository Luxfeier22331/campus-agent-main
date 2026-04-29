import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { PublicDocsPublishEnvironment } from "./check-published-reader-manifest";
import {
	type PublicDocsDeployPipelineCommandRunner,
	type PublicDocsDeployPipelineCommandSpec,
	type PublicDocsDeployPipelineOutcome,
	type PublicDocsDeployPipelineResult,
	runPublishedReaderDeployPipeline,
} from "./run-published-reader-deploy-pipeline";
import { APP_ROOT } from "./sync-real-docs/shared";
import { createS3ObjectStore, type ObjectStoreClient } from "./sync-real-docs/storage";

export type PublicDocsRollingPublishCiOutcome = PublicDocsDeployPipelineOutcome | "disabled";

export interface PublicDocsRollingPublishCiResult {
	deployResult?: PublicDocsDeployPipelineResult;
	enabled: boolean;
	environment: PublicDocsPublishEnvironment;
	ledgerDownloaded: boolean;
	ledgerUploaded: boolean;
	outcome: PublicDocsRollingPublishCiOutcome;
	persistedLedgerObjectKey?: string;
}

const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;

export async function runPublishedReaderRollingPublishCi(input: {
	client?: ObjectStoreClient;
	commandRunner?: PublicDocsDeployPipelineCommandRunner;
	commands?: PublicDocsDeployPipelineCommandSpec[];
	dryRun?: boolean;
	dueWindowMinutes?: number;
	enabled: boolean;
	environment: PublicDocsPublishEnvironment;
	force?: boolean;
	ledgerFilePath?: string;
	ledgerObjectKey?: string;
	lockFilePath?: string;
	lockStaleMs?: number;
	manifestObjectKey?: string;
	now?: string;
	runnerId?: string;
}): Promise<PublicDocsRollingPublishCiResult> {
	if (!input.enabled) {
		return {
			enabled: false,
			environment: input.environment,
			ledgerDownloaded: false,
			ledgerUploaded: false,
			outcome: "disabled",
		};
	}
	if (!input.ledgerObjectKey?.trim()) {
		throw new Error("ledgerObjectKey is required when rolling publish is enabled");
	}
	if (!input.manifestObjectKey?.trim()) {
		throw new Error("manifestObjectKey is required when rolling publish is enabled");
	}

	const client = input.client ?? createS3ObjectStore();
	const runtimeRoot = resolve(APP_ROOT, "../../.planning/runtime/public-docs-publish");
	const ledgerFilePath =
		input.ledgerFilePath ?? resolve(runtimeRoot, `${input.environment}-ledger.json`);
	const lockFilePath = input.lockFilePath ?? resolve(runtimeRoot, `${input.environment}.lock.json`);
	const downloaded = await downloadPersistedLedger({
		client,
		ledgerFilePath,
		ledgerObjectKey: input.ledgerObjectKey,
	});

	const deployResult = await runPublishedReaderDeployPipeline({
		client,
		commandRunner: input.commandRunner,
		commands: input.commands,
		dryRun: input.dryRun,
		dueWindowMinutes: input.dueWindowMinutes,
		environment: input.environment,
		force: input.force,
		ledgerFilePath,
		lockFilePath,
		lockStaleMs: input.lockStaleMs ?? DEFAULT_LOCK_STALE_MS,
		manifestObjectKey: input.manifestObjectKey,
		now: input.now,
		runnerId: input.runnerId,
	});
	const shouldUploadLedger = !input.dryRun && deployResult.outcome !== "not_due";
	if (shouldUploadLedger) {
		await uploadPersistedLedger({
			client,
			ledgerFilePath,
			ledgerObjectKey: input.ledgerObjectKey,
		});
	}

	return {
		deployResult,
		enabled: true,
		environment: input.environment,
		ledgerDownloaded: downloaded,
		ledgerUploaded: shouldUploadLedger,
		outcome: deployResult.outcome,
		persistedLedgerObjectKey: input.ledgerObjectKey,
	};
}

async function downloadPersistedLedger(input: {
	client: ObjectStoreClient;
	ledgerFilePath: string;
	ledgerObjectKey: string;
}): Promise<boolean> {
	const bytes = await input.client.readOptionalBytesObject({ key: input.ledgerObjectKey });
	mkdirSync(dirname(input.ledgerFilePath), { recursive: true });
	if (!bytes) {
		writeFileSync(
			input.ledgerFilePath,
			`${JSON.stringify({ records: [], version: 1 }, null, 2)}\n`,
		);
		return false;
	}
	writeFileSync(input.ledgerFilePath, new TextDecoder().decode(bytes));
	return true;
}

async function uploadPersistedLedger(input: {
	client: ObjectStoreClient;
	ledgerFilePath: string;
	ledgerObjectKey: string;
}): Promise<void> {
	if (!input.client.writeTextObject) {
		throw new Error("object store client does not support writeTextObject");
	}
	await input.client.writeTextObject({
		key: input.ledgerObjectKey,
		text: readFileSync(input.ledgerFilePath, "utf8"),
	});
}

export function parsePublishedReaderRollingPublishCiArgs(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
): {
	dryRun: boolean;
	dueWindowMinutes: number;
	enabled: boolean;
	environment: PublicDocsPublishEnvironment;
	force: boolean;
	ledgerFilePath?: string;
	ledgerObjectKey?: string;
	lockFilePath?: string;
	lockStaleMs: number;
	manifestObjectKey?: string;
	now?: string;
	outputPath?: string;
} {
	const args = [...argv];
	let dryRun = parseBooleanEnv(env.PUBLIC_DOCS_ROLLING_PUBLISH_DRY_RUN, true);
	let dueWindowMinutes = 15;
	let enabled = parseBooleanEnv(env.PUBLIC_DOCS_ROLLING_PUBLISH_ENABLED, false);
	let environment: PublicDocsPublishEnvironment =
		env.CLOUDFLARE_ENV === "staging" ? "staging" : "prod";
	let force = false;
	let ledgerFilePath: string | undefined;
	let ledgerObjectKey: string | undefined = env.PUBLIC_DOCS_RELEASE_LEDGER_KEY;
	let lockFilePath: string | undefined;
	let lockStaleMs = DEFAULT_LOCK_STALE_MS;
	let manifestObjectKey: string | undefined = env.PUBLIC_DOCS_SYNC_MANIFEST_KEY;
	let now: string | undefined;
	let outputPath: string | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--dry-run") {
			dryRun = true;
		} else if (arg === "--no-dry-run") {
			dryRun = false;
		} else if (arg === "--due-window-minutes") {
			dueWindowMinutes = Number.parseInt(requireArgValue(args, index, arg), 10);
			index += 1;
		} else if (arg === "--enabled") {
			enabled = true;
		} else if (arg === "--disabled") {
			enabled = false;
		} else if (arg === "--env") {
			environment = parseEnvironment(requireArgValue(args, index, arg));
			index += 1;
		} else if (arg === "--force") {
			force = true;
		} else if (arg === "--ledger") {
			ledgerFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--ledger-key") {
			ledgerObjectKey = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--lock-file") {
			lockFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--lock-stale-ms") {
			lockStaleMs = Number.parseInt(requireArgValue(args, index, arg), 10);
			index += 1;
		} else if (arg === "--manifest-key") {
			manifestObjectKey = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--now") {
			now = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--output") {
			outputPath = requireArgValue(args, index, arg);
			index += 1;
		} else {
			throw new Error(`unsupported argument: ${arg}`);
		}
	}

	return {
		dryRun,
		dueWindowMinutes,
		enabled,
		environment,
		force,
		ledgerFilePath,
		ledgerObjectKey,
		lockFilePath,
		lockStaleMs,
		manifestObjectKey,
		now,
		outputPath,
	};
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
	if (value === undefined || value.trim() === "") {
		return defaultValue;
	}
	return value.trim().toLowerCase() === "true";
}

function requireArgValue(args: string[], index: number, name: string): string {
	const value = args[index + 1]?.trim();
	if (!value) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

function parseEnvironment(value: string): PublicDocsPublishEnvironment {
	if (value === "prod" || value === "staging") {
		return value;
	}
	throw new Error("--env must be prod or staging");
}

async function main(): Promise<void> {
	const args = parsePublishedReaderRollingPublishCiArgs(process.argv.slice(2));
	const result = await runPublishedReaderRollingPublishCi({
		client: createS3ObjectStore(),
		dryRun: args.dryRun,
		dueWindowMinutes: args.dueWindowMinutes,
		enabled: args.enabled,
		environment: args.environment,
		force: args.force,
		ledgerFilePath: args.ledgerFilePath,
		ledgerObjectKey: args.ledgerObjectKey,
		lockFilePath: args.lockFilePath,
		lockStaleMs: args.lockStaleMs,
		manifestObjectKey: args.manifestObjectKey,
		now: args.now,
		runnerId: process.env.PUBLIC_DOCS_PUBLISH_RUNNER_ID,
	});
	const output = `${JSON.stringify(result, null, 2)}\n`;
	if (args.outputPath) {
		mkdirSync(dirname(args.outputPath), { recursive: true });
		writeFileSync(args.outputPath, output);
	}
	console.log(output);
	if (result.outcome === "lock_busy") {
		process.exitCode = 2;
	}
	if (result.outcome === "failed" || result.outcome === "not_deployable") {
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
