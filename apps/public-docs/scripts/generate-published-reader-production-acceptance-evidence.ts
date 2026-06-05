import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	type PublicDocsPublishEnvironment,
	type PublicDocsReleaseLedger,
	readPublicDocsReleaseLedger,
} from "./check-published-reader-manifest";
import { nudgePublishedReaderDeployHook } from "./nudge-published-reader-deploy-hook";
import { rollbackPublishedReaderRelease } from "./rollback-published-reader-release";
import {
	type PublicDocsDeployPipelineCommandSpec,
	runPublishedReaderDeployPipeline,
} from "./run-published-reader-deploy-pipeline";
import { acquirePublicDocsPublishLock } from "./run-published-reader-scheduled-check";
import { REPO_ROOT } from "./sync-real-docs/shared";
import type { ObjectStoreClient } from "./sync-real-docs/storage";

export type PublishedReaderProductionAcceptanceScenarioName =
	| "blocked_manifest_blocks_deploy"
	| "changed_manifest_deploy"
	| "failed_command_records_failed_ledger"
	| "hook_cloudflare_dispatch"
	| "hook_local_pipeline_nudge"
	| "invalid_manifest_blocks_deploy"
	| "lock_busy_blocks_deploy"
	| "no_change_skip"
	| "prod_dry_run_changed_manifest"
	| "rollback_dry_run"
	| "staging_dry_run_changed_manifest";

export interface PublishedReaderProductionAcceptanceScenario {
	deployHookStatus?: number;
	environment: PublicDocsPublishEnvironment;
	ledgerFinalStatus?: string;
	name: PublishedReaderProductionAcceptanceScenarioName;
	outcome: string;
	passed: boolean;
	trigger?: string;
}

export interface PublishedReaderProductionAcceptanceEvidence {
	generatedAt: string;
	scenarios: PublishedReaderProductionAcceptanceScenario[];
	status: "failed" | "passed";
	summary: {
		failed: number;
		passed: number;
		total: number;
	};
	version: 1;
}

const ACCEPTANCE_COMMANDS: PublicDocsDeployPipelineCommandSpec[] = [
	{ args: ["build"], command: "pnpm", phase: "build" },
	{ args: ["smoke"], command: "pnpm", phase: "smoke" },
	{ args: ["verify"], command: "pnpm", phase: "verify" },
	{ args: ["deploy"], command: "pnpm", phase: "deploy" },
];

export async function generatePublishedReaderProductionAcceptanceEvidence(input: {
	now?: string;
	outputPath?: string;
}): Promise<PublishedReaderProductionAcceptanceEvidence> {
	const now = input.now ?? new Date().toISOString();
	const runtimeDirectory = mkdtempSync(join(tmpdir(), "public-docs-production-acceptance-"));
	try {
		const scenarios: PublishedReaderProductionAcceptanceScenario[] = [];
		scenarios.push(await prodDryRunChangedManifest({ now, runtimeDirectory }));
		scenarios.push(await stagingDryRunChangedManifest({ now, runtimeDirectory }));
		scenarios.push(await noChangeSkip({ now, runtimeDirectory }));
		scenarios.push(await changedManifestDeploy({ now, runtimeDirectory }));
		scenarios.push(await invalidManifestBlocksDeploy({ now, runtimeDirectory }));
		scenarios.push(await blockedManifestBlocksDeploy({ now, runtimeDirectory }));
		scenarios.push(await lockBusyBlocksDeploy({ now, runtimeDirectory }));
		scenarios.push(await failedCommandRecordsFailedLedger({ now, runtimeDirectory }));
		scenarios.push(await rollbackDryRun({ now, runtimeDirectory }));
		scenarios.push(await hookLocalPipelineNudge({ now, runtimeDirectory }));
		scenarios.push(await hookCloudflareDispatch({ now }));

		const passed = scenarios.filter((scenario) => scenario.passed).length;
		const evidence: PublishedReaderProductionAcceptanceEvidence = {
			generatedAt: now,
			scenarios,
			status: passed === scenarios.length ? "passed" : "failed",
			summary: {
				failed: scenarios.length - passed,
				passed,
				total: scenarios.length,
			},
			version: 1,
		};
		if (input.outputPath) {
			const outputPath = resolveRepoOutputPath(input.outputPath);
			mkdirSync(dirname(outputPath), { recursive: true });
			writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
		}
		return evidence;
	} finally {
		rmSync(runtimeDirectory, { force: true, recursive: true });
	}
}

async function prodDryRunChangedManifest(input: {
	now: string;
	runtimeDirectory: string;
}): Promise<PublishedReaderProductionAcceptanceScenario> {
	const paths = scenarioPaths(input.runtimeDirectory, "prod-dry-run");
	const result = await runPublishedReaderDeployPipeline({
		client: objectStoreForManifest(validManifest("release-prod-dry-run")),
		commands: ACCEPTANCE_COMMANDS,
		dryRun: true,
		environment: "prod",
		force: true,
		ledgerFilePath: paths.ledger,
		lockFilePath: paths.lock,
		manifestObjectKey: "manifest.json",
		now: input.now,
	});
	return scenario("prod_dry_run_changed_manifest", "prod", result.outcome, {
		ledgerFinalStatus: lastLedgerStatus(paths.ledger),
		passed: result.outcome === "dry_run" && result.executedCommands.length === 0,
		trigger: lastLedgerTrigger(paths.ledger),
	});
}

async function stagingDryRunChangedManifest(input: {
	now: string;
	runtimeDirectory: string;
}): Promise<PublishedReaderProductionAcceptanceScenario> {
	const paths = scenarioPaths(input.runtimeDirectory, "staging-dry-run");
	const result = await runPublishedReaderDeployPipeline({
		client: objectStoreForManifest(validManifest("release-staging-dry-run")),
		commands: ACCEPTANCE_COMMANDS,
		dryRun: true,
		environment: "staging",
		force: true,
		ledgerFilePath: paths.ledger,
		lockFilePath: paths.lock,
		manifestObjectKey: "manifest.json",
		now: input.now,
	});
	return scenario("staging_dry_run_changed_manifest", "staging", result.outcome, {
		ledgerFinalStatus: lastLedgerStatus(paths.ledger),
		passed: result.outcome === "dry_run" && result.executedCommands.length === 0,
		trigger: lastLedgerTrigger(paths.ledger),
	});
}

async function noChangeSkip(input: {
	now: string;
	runtimeDirectory: string;
}): Promise<PublishedReaderProductionAcceptanceScenario> {
	const paths = scenarioPaths(input.runtimeDirectory, "no-change");
	const manifest = validManifest("release-current");
	writeLedger(paths.ledger, [
		{
			candidateManifestDigest: sha256Hex(manifest),
			candidateReleaseId: "release-current",
			completedAt: input.now,
			environment: "prod",
			id: "deployed-current",
			startedAt: input.now,
			status: "deployed",
			surface: "public_docs",
			validation: { errors: [], ok: true, warnings: [] },
		},
	]);
	const result = await runPublishedReaderDeployPipeline({
		client: objectStoreForManifest(manifest),
		commands: ACCEPTANCE_COMMANDS,
		environment: "prod",
		force: true,
		ledgerFilePath: paths.ledger,
		lockFilePath: paths.lock,
		manifestObjectKey: "manifest.json",
		now: input.now,
	});
	return scenario("no_change_skip", "prod", result.outcome, {
		ledgerFinalStatus: lastLedgerStatus(paths.ledger),
		passed: result.outcome === "not_changed" && result.executedCommands.length === 0,
		trigger: lastLedgerTrigger(paths.ledger),
	});
}

async function changedManifestDeploy(input: {
	now: string;
	runtimeDirectory: string;
}): Promise<PublishedReaderProductionAcceptanceScenario> {
	const paths = scenarioPaths(input.runtimeDirectory, "changed-deploy");
	const result = await runPublishedReaderDeployPipeline({
		client: objectStoreForManifest(validManifest("release-changed")),
		commandRunner: async (command) => ({
			exitCode: 0,
			stderr: "",
			stdout:
				command.phase === "deploy"
					? "Deployment ID: cf-deploy-acceptance\nVersion ID: cf-version-acceptance\n"
					: "",
		}),
		commands: ACCEPTANCE_COMMANDS,
		environment: "prod",
		force: true,
		ledgerFilePath: paths.ledger,
		lockFilePath: paths.lock,
		manifestObjectKey: "manifest.json",
		now: input.now,
	});
	return scenario("changed_manifest_deploy", "prod", result.outcome, {
		ledgerFinalStatus: lastLedgerStatus(paths.ledger),
		passed:
			result.outcome === "deployed" &&
			result.cloudflareVersionId === "cf-version-acceptance" &&
			result.executedCommands.length === ACCEPTANCE_COMMANDS.length,
		trigger: lastLedgerTrigger(paths.ledger),
	});
}

async function invalidManifestBlocksDeploy(input: {
	now: string;
	runtimeDirectory: string;
}): Promise<PublishedReaderProductionAcceptanceScenario> {
	const paths = scenarioPaths(input.runtimeDirectory, "invalid-manifest");
	const result = await runPublishedReaderDeployPipeline({
		client: objectStoreForManifest('{"entries":'),
		commands: ACCEPTANCE_COMMANDS,
		environment: "prod",
		force: true,
		ledgerFilePath: paths.ledger,
		lockFilePath: paths.lock,
		manifestObjectKey: "manifest.json",
		now: input.now,
	});
	return scenario("invalid_manifest_blocks_deploy", "prod", result.outcome, {
		ledgerFinalStatus: lastLedgerStatus(paths.ledger),
		passed: result.outcome === "not_deployable" && result.executedCommands.length === 0,
		trigger: lastLedgerTrigger(paths.ledger),
	});
}

async function blockedManifestBlocksDeploy(input: {
	now: string;
	runtimeDirectory: string;
}): Promise<PublishedReaderProductionAcceptanceScenario> {
	const paths = scenarioPaths(input.runtimeDirectory, "blocked-manifest");
	const result = await runPublishedReaderDeployPipeline({
		client: objectStoreForManifest(blockedManifest()),
		commands: ACCEPTANCE_COMMANDS,
		environment: "prod",
		force: true,
		ledgerFilePath: paths.ledger,
		lockFilePath: paths.lock,
		manifestObjectKey: "manifest.json",
		now: input.now,
	});
	return scenario("blocked_manifest_blocks_deploy", "prod", result.outcome, {
		ledgerFinalStatus: lastLedgerStatus(paths.ledger),
		passed: result.outcome === "not_deployable" && result.executedCommands.length === 0,
		trigger: lastLedgerTrigger(paths.ledger),
	});
}

async function lockBusyBlocksDeploy(input: {
	now: string;
	runtimeDirectory: string;
}): Promise<PublishedReaderProductionAcceptanceScenario> {
	const paths = scenarioPaths(input.runtimeDirectory, "lock-busy");
	acquirePublicDocsPublishLock({
		environment: "prod",
		lockFilePath: paths.lock,
		lockStaleMs: 30 * 60 * 1000,
		now: input.now,
		ownerId: "existing-runner",
	});
	const result = await runPublishedReaderDeployPipeline({
		client: objectStoreForManifest(validManifest("release-lock-busy")),
		commands: ACCEPTANCE_COMMANDS,
		environment: "prod",
		force: true,
		ledgerFilePath: paths.ledger,
		lockFilePath: paths.lock,
		manifestObjectKey: "manifest.json",
		now: input.now,
	});
	return scenario("lock_busy_blocks_deploy", "prod", result.outcome, {
		passed: result.outcome === "lock_busy" && result.executedCommands.length === 0,
	});
}

async function failedCommandRecordsFailedLedger(input: {
	now: string;
	runtimeDirectory: string;
}): Promise<PublishedReaderProductionAcceptanceScenario> {
	const paths = scenarioPaths(input.runtimeDirectory, "failed-command");
	const result = await runPublishedReaderDeployPipeline({
		client: objectStoreForManifest(validManifest("release-failed-command")),
		commandRunner: async (command) => ({
			exitCode: command.phase === "smoke" ? 1 : 0,
			stderr: command.phase === "smoke" ? "smoke failed" : "",
			stdout: "",
		}),
		commands: ACCEPTANCE_COMMANDS,
		environment: "prod",
		force: true,
		ledgerFilePath: paths.ledger,
		lockFilePath: paths.lock,
		manifestObjectKey: "manifest.json",
		now: input.now,
	});
	return scenario("failed_command_records_failed_ledger", "prod", result.outcome, {
		ledgerFinalStatus: lastLedgerStatus(paths.ledger),
		passed: result.outcome === "failed" && lastLedgerStatus(paths.ledger) === "failed",
		trigger: lastLedgerTrigger(paths.ledger),
	});
}

async function rollbackDryRun(input: {
	now: string;
	runtimeDirectory: string;
}): Promise<PublishedReaderProductionAcceptanceScenario> {
	const paths = scenarioPaths(input.runtimeDirectory, "rollback");
	writeLedger(paths.ledger, [
		deployedLedgerRecord("release-a", "digest-a", "version-a", input.now),
		deployedLedgerRecord("release-b", "digest-b", "version-b", input.now),
	]);
	const result = await rollbackPublishedReaderRelease({
		dryRun: true,
		environment: "prod",
		ledgerFilePath: paths.ledger,
		lockFilePath: paths.lock,
		now: input.now,
		reason: "production acceptance drill",
	});
	return scenario("rollback_dry_run", "prod", result.outcome, {
		passed:
			result.outcome === "dry_run" &&
			result.target.versionId === "version-a" &&
			readLedger(paths.ledger).records.length === 2,
	});
}

async function hookLocalPipelineNudge(input: {
	now: string;
	runtimeDirectory: string;
}): Promise<PublishedReaderProductionAcceptanceScenario> {
	const paths = scenarioPaths(input.runtimeDirectory, "hook-local");
	const result = await nudgePublishedReaderDeployHook({
		client: objectStoreForManifest(validManifest("release-hook")),
		commands: ACCEPTANCE_COMMANDS,
		dryRun: true,
		environment: "prod",
		expectedSecret: "expected-secret",
		ledgerFilePath: paths.ledger,
		lockFilePath: paths.lock,
		manifestObjectKey: "manifest.json",
		now: input.now,
		payload: {
			branch: "ignored-branch",
			environment: "prod",
			eventId: "evt-acceptance",
			manifestDigest: "ignored-digest",
			releaseId: "ignored-release",
			secret: "expected-secret",
			surface: "public_docs",
		},
	});
	const outcome = result.mode === "local_pipeline" ? result.deployResult.outcome : result.mode;
	return scenario("hook_local_pipeline_nudge", "prod", outcome, {
		ledgerFinalStatus: lastLedgerStatus(paths.ledger),
		passed: result.mode === "local_pipeline" && result.deployResult.outcome === "dry_run",
		trigger: lastLedgerTrigger(paths.ledger),
	});
}

async function hookCloudflareDispatch(input: {
	now: string;
}): Promise<PublishedReaderProductionAcceptanceScenario> {
	let called = false;
	const result = await nudgePublishedReaderDeployHook({
		deployHookUrl: "https://example.invalid/cloudflare/deploy-hook",
		environment: "prod",
		fetchImpl: async () => {
			called = true;
			return new Response("queued", { status: 202 });
		},
		now: input.now,
		payload: {
			environment: "prod",
			eventId: "evt-dispatch",
			surface: "public_docs",
		},
	});
	const status =
		result.mode === "cloudflare_deploy_hook" ? result.dispatchResult.status : undefined;
	return scenario("hook_cloudflare_dispatch", "prod", "dispatched", {
		deployHookStatus: status,
		passed: called && status === 202,
	});
}

function scenario(
	name: PublishedReaderProductionAcceptanceScenarioName,
	environment: PublicDocsPublishEnvironment,
	outcome: string,
	optional: Partial<PublishedReaderProductionAcceptanceScenario> & { passed: boolean },
): PublishedReaderProductionAcceptanceScenario {
	return {
		environment,
		name,
		outcome,
		passed: optional.passed,
		deployHookStatus: optional.deployHookStatus,
		ledgerFinalStatus: optional.ledgerFinalStatus,
		trigger: optional.trigger,
	};
}

function scenarioPaths(runtimeDirectory: string, name: string): { ledger: string; lock: string } {
	return {
		ledger: join(runtimeDirectory, `${name}-ledger.json`),
		lock: join(runtimeDirectory, `${name}.lock.json`),
	};
}

function validManifest(generatedAt: string): string {
	return JSON.stringify({
		entries: [],
		generatedAt,
		surface: "public_docs",
	});
}

function blockedManifest(): string {
	return JSON.stringify({
		entries: [
			{
				deliveryMode: "gated_asset",
				docId: "restricted:secret",
				sourceObjects: {
					manifest: "reader-assets/secret/asset-manifest.json",
					reader: "reader-assets/secret/reader.json",
				},
				targetObjects: {
					"asset-manifest": "_docs/restricted/secret/current/asset-manifest.json",
					reader: "_docs/restricted/secret/current/reader.json",
				},
			},
		],
		generatedAt: "release-blocked",
		surface: "public_docs",
	});
}

function objectStoreForManifest(manifest: string): ObjectStoreClient {
	const objects = new Map<string, string | Uint8Array>([
		["manifest.json", manifest],
		["reader-assets/secret/reader.json", '{"sections":[]}'],
		[
			"reader-assets/secret/asset-manifest.json",
			JSON.stringify({
				files: {
					"reader.json": {
						sha256: sha256Hex('{"sections":[]}'),
						sizeBytes: new TextEncoder().encode('{"sections":[]}').byteLength,
					},
				},
			}),
		],
	]);
	return {
		async listObjectKeys({ prefix }) {
			return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
		},
		async readOptionalBytesObject({ key }) {
			const value = objects.get(key);
			if (value === undefined) {
				return;
			}
			return typeof value === "string" ? new TextEncoder().encode(value) : value;
		},
		async readTextObject({ key }) {
			const value = objects.get(key);
			if (value === undefined) {
				throw new Error(`missing object: ${key}`);
			}
			return typeof value === "string" ? value : new TextDecoder().decode(value);
		},
	};
}

function writeLedger(path: string, records: PublicDocsReleaseLedger["records"]): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ records, version: 1 }, null, 2)}\n`);
}

function readLedger(path: string): PublicDocsReleaseLedger {
	return readPublicDocsReleaseLedger(path);
}

function lastLedgerStatus(path: string): string | undefined {
	return readLedger(path).records.at(-1)?.status;
}

function lastLedgerTrigger(path: string): string | undefined {
	return readLedger(path).records.at(-1)?.trigger;
}

function deployedLedgerRecord(
	releaseId: string,
	digest: string,
	versionId: string,
	now: string,
): PublicDocsReleaseLedger["records"][number] {
	return {
		candidateManifestDigest: digest,
		candidateReleaseId: releaseId,
		cloudflareVersionId: versionId,
		completedAt: now,
		environment: "prod",
		id: `deployed-${releaseId}`,
		startedAt: now,
		status: "deployed",
		surface: "public_docs",
		validation: { errors: [], ok: true, warnings: [] },
	};
}

function sha256Hex(content: string | Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

function resolveRepoOutputPath(outputPath: string): string {
	return isAbsolute(outputPath) ? outputPath : resolve(REPO_ROOT, outputPath);
}

export function parsePublishedReaderProductionAcceptanceArgs(argv: string[]): {
	now?: string;
	outputPath?: string;
} {
	const args = [...argv];
	let now: string | undefined;
	let outputPath: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--now") {
			now = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--output") {
			outputPath = requireArgValue(args, index, arg);
			index += 1;
		} else {
			throw new Error(`unsupported argument: ${arg}`);
		}
	}
	return { now, outputPath };
}

function requireArgValue(args: string[], index: number, name: string): string {
	const value = args[index + 1]?.trim();
	if (!value) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

async function main(): Promise<void> {
	const args = parsePublishedReaderProductionAcceptanceArgs(process.argv.slice(2));
	const evidence = await generatePublishedReaderProductionAcceptanceEvidence({
		now: args.now,
		outputPath:
			args.outputPath ??
			resolve(REPO_ROOT, "var/public-docs/published-reader-production-acceptance/acceptance.json"),
	});
	console.log(JSON.stringify(evidence, null, 2));
	if (evidence.status !== "passed") {
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
