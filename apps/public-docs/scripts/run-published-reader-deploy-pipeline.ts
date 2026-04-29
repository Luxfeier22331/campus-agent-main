import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
	appendPublicDocsReleaseLedgerRecord,
	checkPublishedReaderManifest,
	type PublicDocsPublishEnvironment,
	type PublicDocsReleaseLedgerRecord,
} from "./check-published-reader-manifest";
import {
	acquirePublicDocsPublishLock,
	type PublicDocsScheduledCheckResult,
	releasePublicDocsPublishLock,
	resolvePublicDocsPublishScheduleWindow,
} from "./run-published-reader-scheduled-check";
import { APP_ROOT } from "./sync-real-docs/shared";
import { createS3ObjectStore, type ObjectStoreClient } from "./sync-real-docs/storage";

export type PublicDocsDeployPipelineCommandPhase = "build" | "deploy" | "smoke" | "verify";
export type PublicDocsDeployPipelineOutcome =
	| "deployed"
	| "dry_run"
	| "failed"
	| "lock_busy"
	| "not_changed"
	| "not_deployable"
	| "not_due";
export type PublicDocsDeployPipelineTrigger = "forced" | "hook" | "scheduled";

export interface PublicDocsDeployPipelineCommandSpec {
	args: string[];
	command: string;
	cwd?: string;
	env?: Record<string, string>;
	phase: PublicDocsDeployPipelineCommandPhase;
}

export interface PublicDocsDeployPipelineCommandResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}

export interface PublicDocsDeployPipelineExecutedCommand {
	command: PublicDocsDeployPipelineCommandSpec;
	result: PublicDocsDeployPipelineCommandResult;
}

export type PublicDocsDeployPipelineCommandRunner = (
	command: PublicDocsDeployPipelineCommandSpec,
) => Promise<PublicDocsDeployPipelineCommandResult>;

export interface PublicDocsDeployPipelineResult {
	checkResult: PublicDocsScheduledCheckResult;
	cloudflareDeploymentId?: string;
	cloudflareVersionId?: string;
	executedCommands: PublicDocsDeployPipelineExecutedCommand[];
	finalLedgerRecord?: PublicDocsReleaseLedgerRecord;
	outcome: PublicDocsDeployPipelineOutcome;
	plannedCommands: PublicDocsDeployPipelineCommandSpec[];
}

const DEFAULT_DUE_WINDOW_MINUTES = 15;
const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;

export async function runPublishedReaderDeployPipeline(input: {
	client: ObjectStoreClient;
	commandRunner?: PublicDocsDeployPipelineCommandRunner;
	commands?: PublicDocsDeployPipelineCommandSpec[];
	dryRun?: boolean;
	dueWindowMinutes?: number;
	environment: PublicDocsPublishEnvironment;
	force?: boolean;
	ledgerFilePath: string;
	lockFilePath: string;
	lockStaleMs?: number;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	now?: string;
	retryAttemptNumber?: number;
	retryOfRecordId?: string;
	runnerId?: string;
	trigger?: PublicDocsDeployPipelineTrigger;
}): Promise<PublicDocsDeployPipelineResult> {
	const now = input.now ?? new Date().toISOString();
	const schedule = resolvePublicDocsPublishScheduleWindow({
		dueWindowMinutes: input.dueWindowMinutes,
		now,
	});
	const plannedCommands =
		input.commands ??
		buildPublishedReaderDeployCommands({
			environment: input.environment,
			manifestFilePath: input.manifestFilePath,
		});

	if (!(schedule.due || input.force)) {
		return {
			checkResult: { outcome: "not_due", schedule },
			executedCommands: [],
			outcome: "not_due",
			plannedCommands,
		};
	}

	const acquired = acquirePublicDocsPublishLock({
		environment: input.environment,
		lockFilePath: input.lockFilePath,
		lockStaleMs: input.lockStaleMs ?? DEFAULT_LOCK_STALE_MS,
		now,
		ownerId: input.runnerId ?? "public-docs-deploy-pipeline",
	});
	if (!acquired.acquired) {
		return {
			checkResult: {
				activeLock: acquired.activeLock,
				outcome: "lock_busy",
				schedule,
				staleLockRemoved: acquired.staleLockRemoved,
			},
			executedCommands: [],
			outcome: "lock_busy",
			plannedCommands,
		};
	}

	try {
		const check = await checkPublishedReaderManifest({
			client: input.client,
			environment: input.environment,
			ledgerFilePath: input.ledgerFilePath,
			manifestFilePath: input.manifestFilePath,
			manifestObjectKey: input.manifestObjectKey,
			now,
			runnerId: input.runnerId,
		});
		const ledgerRecord: PublicDocsReleaseLedgerRecord = {
			...check.ledgerRecord,
			lockId: acquired.lock.lockId,
			runnerId: input.runnerId,
			scheduleKey: resolveDeployPipelineScheduleKey({
				force: input.force,
				scheduleKey: schedule.scheduleKey,
				trigger: input.trigger,
			}),
			trigger: input.trigger ?? (input.force ? "forced" : "scheduled"),
		};
		appendPublicDocsReleaseLedgerRecord({
			ledgerFilePath: input.ledgerFilePath,
			record: ledgerRecord,
		});
		const checkResult: PublicDocsScheduledCheckResult = {
			check: { ...check, ledgerRecord },
			lockId: acquired.lock.lockId,
			outcome: "checked",
			schedule,
			staleLockRemoved: acquired.staleLockRemoved,
		};
		const baseResult = {
			checkResult,
			executedCommands: [],
			plannedCommands,
		} satisfies Omit<PublicDocsDeployPipelineResult, "outcome">;

		if (check.verdict === "unchanged") {
			return { ...baseResult, outcome: "not_changed" };
		}
		if (check.verdict !== "changed") {
			return { ...baseResult, outcome: "not_deployable" };
		}
		if (input.dryRun) {
			return { ...baseResult, outcome: "dry_run" };
		}

		const executedCommands: PublicDocsDeployPipelineExecutedCommand[] = [];
		const commandRunner = input.commandRunner ?? runCommand;
		for (const command of plannedCommands) {
			let commandResult: PublicDocsDeployPipelineCommandResult;
			try {
				commandResult = await commandRunner(command);
			} catch (error) {
				const finalLedgerRecord = appendDeploymentLedgerRecord({
					baseRecord: ledgerRecord,
					completedAt: now,
					ledgerFilePath: input.ledgerFilePath,
					status: "failed",
					failureReason: error instanceof Error ? error.message : String(error),
				});
				return {
					...baseResult,
					executedCommands,
					finalLedgerRecord,
					outcome: "failed",
				};
			}
			executedCommands.push({ command, result: commandResult });
			if (commandResult.exitCode !== 0) {
				const finalLedgerRecord = appendDeploymentLedgerRecord({
					baseRecord: ledgerRecord,
					completedAt: now,
					ledgerFilePath: input.ledgerFilePath,
					status: "failed",
					failureReason: formatCommandFailure(command, commandResult),
				});
				return {
					...baseResult,
					executedCommands,
					finalLedgerRecord,
					outcome: "failed",
				};
			}
		}

		const cloudflareDeploymentId = extractCloudflareDeploymentId(
			executedCommands
				.filter(({ command }) => command.phase === "deploy")
				.map(({ result }) => `${result.stdout}\n${result.stderr}`)
				.join("\n"),
		);
		const cloudflareVersionId = extractCloudflareVersionId(
			executedCommands
				.filter(({ command }) => command.phase === "deploy")
				.map(({ result }) => `${result.stdout}\n${result.stderr}`)
				.join("\n"),
		);
		const finalLedgerRecord = appendDeploymentLedgerRecord({
			baseRecord: ledgerRecord,
			cloudflareDeploymentId,
			cloudflareVersionId,
			completedAt: now,
			ledgerFilePath: input.ledgerFilePath,
			retryAttemptNumber: input.retryAttemptNumber,
			retryOfRecordId: input.retryOfRecordId,
			status: "deployed",
		});
		return {
			...baseResult,
			cloudflareDeploymentId,
			cloudflareVersionId,
			executedCommands,
			finalLedgerRecord,
			outcome: "deployed",
		};
	} finally {
		releasePublicDocsPublishLock({
			lockFilePath: input.lockFilePath,
			lockId: acquired.lock.lockId,
		});
	}
}

export function buildPublishedReaderDeployCommands(input: {
	environment: PublicDocsPublishEnvironment;
	manifestFilePath?: string;
}): PublicDocsDeployPipelineCommandSpec[] {
	const env = buildCommandEnv({
		environment: input.environment,
		manifestFilePath: input.manifestFilePath,
	});
	const verifyScript =
		input.environment === "staging" ? "deploy:verify-config:staging" : "deploy:verify-config";
	const deployArgs =
		input.environment === "staging"
			? [
					"../../scripts/run-wrangler-command.mjs",
					"deploy",
					"--env",
					"staging",
					"--config",
					"wrangler.toml",
				]
			: ["../../scripts/run-wrangler-command.mjs", "deploy", "--config", "wrangler.toml"];
	return [
		{
			args: ["run", "build:published-reader-assets"],
			command: "pnpm",
			cwd: APP_ROOT,
			env,
			phase: "build",
		},
		{
			args: ["run", "smoke:published-reader-build"],
			command: "pnpm",
			cwd: APP_ROOT,
			env,
			phase: "smoke",
		},
		{
			args: ["run", verifyScript],
			command: "pnpm",
			cwd: APP_ROOT,
			env,
			phase: "verify",
		},
		{
			args: deployArgs,
			command: "node",
			cwd: APP_ROOT,
			env,
			phase: "deploy",
		},
	];
}

function buildCommandEnv(input: {
	environment: PublicDocsPublishEnvironment;
	manifestFilePath?: string;
}): Record<string, string> {
	const env: Record<string, string> = {};
	if (input.environment === "staging") {
		env.CLOUDFLARE_ENV = "staging";
	}
	if (input.manifestFilePath) {
		env.PUBLIC_DOCS_SYNC_MANIFEST_PATH = input.manifestFilePath;
	}
	return env;
}

function appendDeploymentLedgerRecord(input: {
	baseRecord: PublicDocsReleaseLedgerRecord;
	cloudflareDeploymentId?: string;
	cloudflareVersionId?: string;
	completedAt: string;
	failureReason?: string;
	ledgerFilePath: string;
	retryAttemptNumber?: number;
	retryOfRecordId?: string;
	status: "deployed" | "failed";
}): PublicDocsReleaseLedgerRecord {
	const record: PublicDocsReleaseLedgerRecord = {
		...input.baseRecord,
		cloudflareDeploymentId: input.cloudflareDeploymentId,
		cloudflareVersionId: input.cloudflareVersionId,
		completedAt: input.completedAt,
		failureReason: input.failureReason,
		id: `${input.baseRecord.id}:${input.status}`,
		attemptNumber: input.retryAttemptNumber,
		retryOfRecordId: input.retryOfRecordId,
		status: input.status,
	};
	appendPublicDocsReleaseLedgerRecord({
		ledgerFilePath: input.ledgerFilePath,
		record,
	});
	return record;
}

function resolveDeployPipelineScheduleKey(input: {
	force?: boolean;
	scheduleKey?: string;
	trigger?: PublicDocsDeployPipelineTrigger;
}): string | undefined {
	if (input.trigger === "hook") {
		return "hook";
	}
	if (input.force) {
		return "forced";
	}
	return input.scheduleKey;
}

function formatCommandFailure(
	command: PublicDocsDeployPipelineCommandSpec,
	result: PublicDocsDeployPipelineCommandResult,
): string {
	const output = `${result.stderr}\n${result.stdout}`.trim();
	if (output) {
		return output;
	}
	return `${command.phase} command exited with code ${result.exitCode}`;
}

function extractCloudflareDeploymentId(output: string): string | undefined {
	const patterns = [
		/\bDeployment ID:\s*(?<id>[0-9A-Za-z_-]+)/i,
		/\bdeployment[_ ]id["']?\s*[:=]\s*["']?(?<id>[0-9A-Za-z_-]+)/i,
	];
	for (const pattern of patterns) {
		const match = output.match(pattern);
		const id = match?.groups?.id;
		if (id) {
			return id;
		}
	}
	return;
}

function extractCloudflareVersionId(output: string): string | undefined {
	const patterns = [
		/\bVersion ID:\s*(?<id>[0-9A-Za-z_-]+)/i,
		/\bversion[_ ]id["']?\s*[:=]\s*["']?(?<id>[0-9A-Za-z_-]+)/i,
		/\bversions\/(?<id>[0-9A-Za-z_-]+)/i,
	];
	for (const pattern of patterns) {
		const match = output.match(pattern);
		const id = match?.groups?.id;
		if (id) {
			return id;
		}
	}
	return;
}

async function runCommand(
	command: PublicDocsDeployPipelineCommandSpec,
): Promise<PublicDocsDeployPipelineCommandResult> {
	return new Promise((resolveCommand, reject) => {
		const child = spawn(command.command, command.args, {
			cwd: command.cwd ?? APP_ROOT,
			env: { ...process.env, ...command.env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
		child.on("error", reject);
		child.on("close", (exitCode) => {
			resolveCommand({
				exitCode: exitCode ?? 1,
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
			});
		});
	});
}

export function parsePublishedReaderDeployPipelineArgs(argv: string[]): {
	dryRun: boolean;
	dueWindowMinutes: number;
	environment: PublicDocsPublishEnvironment;
	force: boolean;
	ledgerFilePath?: string;
	lockFilePath?: string;
	lockStaleMs: number;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	now?: string;
} {
	const args = [...argv];
	let dryRun = false;
	let dueWindowMinutes = DEFAULT_DUE_WINDOW_MINUTES;
	let environment: PublicDocsPublishEnvironment =
		process.env.CLOUDFLARE_ENV === "staging" ? "staging" : "prod";
	let force = false;
	let ledgerFilePath: string | undefined;
	let lockFilePath: string | undefined;
	let lockStaleMs = DEFAULT_LOCK_STALE_MS;
	let manifestFilePath: string | undefined = process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH;
	let manifestObjectKey: string | undefined = process.env.PUBLIC_DOCS_SYNC_MANIFEST_KEY;
	let now: string | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--dry-run") {
			dryRun = true;
		} else if (arg === "--due-window-minutes") {
			dueWindowMinutes = Number.parseInt(requireArgValue(args, index, arg), 10);
			index += 1;
		} else if (arg === "--env") {
			environment = parseEnvironment(requireArgValue(args, index, arg));
			index += 1;
		} else if (arg === "--force") {
			force = true;
		} else if (arg === "--ledger") {
			ledgerFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--lock-file") {
			lockFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--lock-stale-ms") {
			lockStaleMs = Number.parseInt(requireArgValue(args, index, arg), 10);
			index += 1;
		} else if (arg === "--manifest-path") {
			manifestFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--manifest-key") {
			manifestObjectKey = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--now") {
			now = requireArgValue(args, index, arg);
			index += 1;
		} else {
			throw new Error(`unsupported argument: ${arg}`);
		}
	}

	return {
		dryRun,
		dueWindowMinutes,
		environment,
		force,
		ledgerFilePath,
		lockFilePath,
		lockStaleMs,
		manifestFilePath,
		manifestObjectKey,
		now,
	};
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
	const args = parsePublishedReaderDeployPipelineArgs(process.argv.slice(2));
	const runtimeRoot = resolve(APP_ROOT, "../../.planning/runtime/public-docs-publish");
	const result = await runPublishedReaderDeployPipeline({
		client: createS3ObjectStore(),
		dryRun: args.dryRun,
		dueWindowMinutes: args.dueWindowMinutes,
		environment: args.environment,
		force: args.force,
		ledgerFilePath: args.ledgerFilePath ?? resolve(runtimeRoot, `${args.environment}-ledger.json`),
		lockFilePath: args.lockFilePath ?? resolve(runtimeRoot, `${args.environment}.lock.json`),
		lockStaleMs: args.lockStaleMs,
		manifestFilePath: args.manifestFilePath,
		manifestObjectKey: args.manifestObjectKey,
		now: args.now,
		runnerId: process.env.PUBLIC_DOCS_PUBLISH_RUNNER_ID,
	});
	console.log(JSON.stringify(result, null, 2));
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
