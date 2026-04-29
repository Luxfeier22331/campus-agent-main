import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
	appendPublicDocsReleaseLedgerRecord,
	type PublicDocsPublishEnvironment,
	type PublicDocsReleaseLedger,
	type PublicDocsReleaseLedgerRecord,
	readPublicDocsReleaseLedger,
} from "./check-published-reader-manifest";
import {
	acquirePublicDocsPublishLock,
	releasePublicDocsPublishLock,
} from "./run-published-reader-scheduled-check";
import { APP_ROOT } from "./sync-real-docs/shared";

export interface PublicDocsRollbackCommandSpec {
	args: string[];
	command: string;
	cwd?: string;
	env?: Record<string, string>;
}

export interface PublicDocsRollbackCommandResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}

export type PublicDocsRollbackCommandRunner = (
	command: PublicDocsRollbackCommandSpec,
) => Promise<PublicDocsRollbackCommandResult>;

export interface PublicDocsRollbackTarget {
	recordId?: string;
	releaseId?: string;
	versionId: string;
}

export type PublicDocsRollbackOutcome = "dry_run" | "failed" | "lock_busy" | "rolled_back";

export interface PublicDocsRollbackResult {
	finalLedgerRecord?: PublicDocsReleaseLedgerRecord;
	outcome: PublicDocsRollbackOutcome;
	plannedCommand: PublicDocsRollbackCommandSpec;
	target: PublicDocsRollbackTarget;
}

const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;

export function resolvePublicDocsRollbackTarget(input: {
	environment: PublicDocsPublishEnvironment;
	ledger: PublicDocsReleaseLedger;
	targetReleaseId?: string;
	targetVersionId?: string;
}): PublicDocsRollbackTarget {
	if (input.targetVersionId) {
		const record = input.ledger.records.find(
			(item) =>
				item.environment === input.environment &&
				item.cloudflareVersionId === input.targetVersionId,
		);
		return {
			recordId: record?.id,
			releaseId: record?.candidateReleaseId,
			versionId: input.targetVersionId,
		};
	}

	const deployedRecords = input.ledger.records.filter(
		(record) =>
			record.surface === "public_docs" &&
			record.environment === input.environment &&
			record.status === "deployed",
	);
	const targetRecord = input.targetReleaseId
		? deployedRecords.find((record) => record.candidateReleaseId === input.targetReleaseId)
		: (deployedRecords.at(-2) ?? deployedRecords.at(-1));
	if (!targetRecord) {
		throw new Error("rollback target deployed record was not found");
	}
	if (!targetRecord.cloudflareVersionId) {
		throw new Error("rollback target requires cloudflareVersionId");
	}
	return {
		recordId: targetRecord.id,
		releaseId: targetRecord.candidateReleaseId,
		versionId: targetRecord.cloudflareVersionId,
	};
}

export async function rollbackPublishedReaderRelease(input: {
	commandRunner?: PublicDocsRollbackCommandRunner;
	dryRun?: boolean;
	environment: PublicDocsPublishEnvironment;
	ledgerFilePath: string;
	lockFilePath: string;
	lockStaleMs?: number;
	now?: string;
	reason?: string;
	runnerId?: string;
	targetReleaseId?: string;
	targetVersionId?: string;
}): Promise<PublicDocsRollbackResult> {
	const now = input.now ?? new Date().toISOString();
	const ledger = readPublicDocsReleaseLedger(input.ledgerFilePath);
	const target = resolvePublicDocsRollbackTarget({
		environment: input.environment,
		ledger,
		targetReleaseId: input.targetReleaseId,
		targetVersionId: input.targetVersionId,
	});
	const plannedCommand = buildRollbackCommand({
		environment: input.environment,
		reason: input.reason,
		versionId: target.versionId,
	});
	const acquired = acquirePublicDocsPublishLock({
		environment: input.environment,
		lockFilePath: input.lockFilePath,
		lockStaleMs: input.lockStaleMs ?? DEFAULT_LOCK_STALE_MS,
		now,
		ownerId: input.runnerId ?? "public-docs-rollback",
	});
	if (!acquired.acquired) {
		return { outcome: "lock_busy", plannedCommand, target };
	}

	try {
		if (input.dryRun) {
			return { outcome: "dry_run", plannedCommand, target };
		}
		const commandRunner = input.commandRunner ?? runCommand;
		let commandResult: PublicDocsRollbackCommandResult;
		try {
			commandResult = await commandRunner(plannedCommand);
		} catch (error) {
			return {
				finalLedgerRecord: appendRollbackLedgerRecord({
					command: plannedCommand,
					environment: input.environment,
					failureReason: error instanceof Error ? error.message : String(error),
					ledgerFilePath: input.ledgerFilePath,
					now,
					reason: input.reason,
					status: "failed",
					target,
				}),
				outcome: "failed",
				plannedCommand,
				target,
			};
		}
		if (commandResult.exitCode !== 0) {
			return {
				finalLedgerRecord: appendRollbackLedgerRecord({
					command: plannedCommand,
					environment: input.environment,
					failureReason: `${commandResult.stderr}\n${commandResult.stdout}`.trim(),
					ledgerFilePath: input.ledgerFilePath,
					now,
					reason: input.reason,
					status: "failed",
					target,
				}),
				outcome: "failed",
				plannedCommand,
				target,
			};
		}
		return {
			finalLedgerRecord: appendRollbackLedgerRecord({
				command: plannedCommand,
				environment: input.environment,
				ledgerFilePath: input.ledgerFilePath,
				now,
				reason: input.reason,
				status: "rolled_back",
				target,
			}),
			outcome: "rolled_back",
			plannedCommand,
			target,
		};
	} finally {
		releasePublicDocsPublishLock({
			lockFilePath: input.lockFilePath,
			lockId: acquired.lock.lockId,
		});
	}
}

function buildRollbackCommand(input: {
	environment: PublicDocsPublishEnvironment;
	reason?: string;
	versionId: string;
}): PublicDocsRollbackCommandSpec {
	const args = ["../../scripts/run-wrangler-command.mjs", "rollback", input.versionId];
	if (input.reason?.trim()) {
		args.push("--message", input.reason.trim());
	}
	if (input.environment === "staging") {
		args.push("--env", "staging");
	}
	args.push("--config", "wrangler.toml");
	return {
		args,
		command: "node",
		cwd: APP_ROOT,
		env: input.environment === "staging" ? { CLOUDFLARE_ENV: "staging" } : {},
	};
}

function appendRollbackLedgerRecord(input: {
	command: PublicDocsRollbackCommandSpec;
	environment: PublicDocsPublishEnvironment;
	failureReason?: string;
	ledgerFilePath: string;
	now: string;
	reason?: string;
	status: "failed" | "rolled_back";
	target: PublicDocsRollbackTarget;
}): PublicDocsReleaseLedgerRecord {
	const record: PublicDocsReleaseLedgerRecord = {
		candidateManifestDigest: `rollback:${input.target.versionId}`,
		candidateReleaseId: input.target.releaseId ?? input.target.versionId,
		completedAt: input.now,
		environment: input.environment,
		failureReason: input.failureReason,
		id: [
			"public_docs",
			input.environment,
			input.now.replace(/[^0-9A-Za-z]/g, ""),
			input.status,
			input.target.versionId,
		].join(":"),
		rollbackCommand: `${input.command.command} ${input.command.args.join(" ")}`,
		rollbackReason: input.reason,
		rollbackTargetRecordId: input.target.recordId ?? `version:${input.target.versionId}`,
		rollbackTargetReleaseId: input.target.releaseId ?? input.target.versionId,
		rollbackTargetVersionId: input.target.versionId,
		startedAt: input.now,
		status: input.status,
		surface: "public_docs",
		trigger: "manual",
		validation: { errors: [], ok: true, warnings: [] },
	};
	appendPublicDocsReleaseLedgerRecord({
		ledgerFilePath: input.ledgerFilePath,
		record,
	});
	return record;
}

async function runCommand(
	command: PublicDocsRollbackCommandSpec,
): Promise<PublicDocsRollbackCommandResult> {
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

export function parseRollbackPublishedReaderReleaseArgs(argv: string[]): {
	dryRun: boolean;
	environment: PublicDocsPublishEnvironment;
	ledgerFilePath?: string;
	lockFilePath?: string;
	reason?: string;
	targetReleaseId?: string;
	targetVersionId?: string;
} {
	const args = [...argv];
	let dryRun = false;
	let environment: PublicDocsPublishEnvironment =
		process.env.CLOUDFLARE_ENV === "staging" ? "staging" : "prod";
	let ledgerFilePath: string | undefined;
	let lockFilePath: string | undefined;
	let reason: string | undefined;
	let targetReleaseId: string | undefined;
	let targetVersionId: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--dry-run") {
			dryRun = true;
		} else if (arg === "--env") {
			environment = parseEnvironment(requireArgValue(args, index, arg));
			index += 1;
		} else if (arg === "--ledger") {
			ledgerFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--lock-file") {
			lockFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--reason") {
			reason = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--target-release-id") {
			targetReleaseId = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--target-version-id") {
			targetVersionId = requireArgValue(args, index, arg);
			index += 1;
		} else {
			throw new Error(`unsupported argument: ${arg}`);
		}
	}
	return {
		dryRun,
		environment,
		ledgerFilePath,
		lockFilePath,
		reason,
		targetReleaseId,
		targetVersionId,
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
	const args = parseRollbackPublishedReaderReleaseArgs(process.argv.slice(2));
	const runtimeRoot = resolve(APP_ROOT, "../../.planning/runtime/public-docs-publish");
	const environment = args.environment;
	const result = await rollbackPublishedReaderRelease({
		dryRun: args.dryRun,
		environment,
		ledgerFilePath: args.ledgerFilePath ?? resolve(runtimeRoot, `${environment}-ledger.json`),
		lockFilePath: args.lockFilePath ?? resolve(runtimeRoot, `${environment}.lock.json`),
		reason: args.reason,
		runnerId: process.env.PUBLIC_DOCS_PUBLISH_RUNNER_ID,
		targetReleaseId: args.targetReleaseId,
		targetVersionId: args.targetVersionId,
	});
	console.log(JSON.stringify(result, null, 2));
	if (result.outcome === "lock_busy") {
		process.exitCode = 2;
	}
	if (result.outcome === "failed") {
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
