import { resolve } from "node:path";
import {
	checkPublishedReaderManifest,
	type PublicDocsPublishEnvironment,
	readPublicDocsReleaseLedger,
} from "./check-published-reader-manifest";
import {
	type PublicDocsReleaseRetryDecision,
	resolvePublicDocsReleaseRetryDecision,
} from "./published-reader-release-retry-policy";
import {
	type PublicDocsDeployPipelineCommandRunner,
	type PublicDocsDeployPipelineCommandSpec,
	type PublicDocsDeployPipelineResult,
	runPublishedReaderDeployPipeline,
} from "./run-published-reader-deploy-pipeline";
import { APP_ROOT } from "./sync-real-docs/shared";
import { createS3ObjectStore, type ObjectStoreClient } from "./sync-real-docs/storage";

export type PublicDocsRetryReleaseOutcome =
	| PublicDocsDeployPipelineResult["outcome"]
	| "not_retryable";

export interface PublicDocsRetryReleaseResult {
	deployResult?: PublicDocsDeployPipelineResult;
	outcome: PublicDocsRetryReleaseOutcome;
	retryDecision: PublicDocsReleaseRetryDecision;
}

export async function retryPublishedReaderRelease(input: {
	client: ObjectStoreClient;
	commandRunner?: PublicDocsDeployPipelineCommandRunner;
	commands?: PublicDocsDeployPipelineCommandSpec[];
	environment: PublicDocsPublishEnvironment;
	ledgerFilePath: string;
	lockFilePath: string;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	now?: string;
	recordId?: string;
	runnerId?: string;
}): Promise<PublicDocsRetryReleaseResult> {
	const now = input.now ?? new Date().toISOString();
	const check = await checkPublishedReaderManifest({
		client: input.client,
		environment: input.environment,
		ledgerFilePath: input.ledgerFilePath,
		manifestFilePath: input.manifestFilePath,
		manifestObjectKey: input.manifestObjectKey,
		now,
		runnerId: input.runnerId,
	});
	const retryDecision = resolvePublicDocsReleaseRetryDecision({
		currentManifestDigest: check.candidateManifestDigest,
		environment: input.environment,
		ledger: readPublicDocsReleaseLedger(input.ledgerFilePath),
		recordId: input.recordId,
	});
	if (!retryDecision.retryable) {
		return { outcome: "not_retryable", retryDecision };
	}
	const deployResult = await runPublishedReaderDeployPipeline({
		client: input.client,
		commandRunner: input.commandRunner,
		commands: input.commands,
		environment: input.environment,
		force: true,
		ledgerFilePath: input.ledgerFilePath,
		lockFilePath: input.lockFilePath,
		manifestFilePath: input.manifestFilePath,
		manifestObjectKey: input.manifestObjectKey,
		now,
		retryAttemptNumber: retryDecision.attemptNumber,
		retryOfRecordId: retryDecision.baseRecord.retryOfRecordId ?? retryDecision.baseRecord.id,
		runnerId: input.runnerId,
	});
	return {
		deployResult,
		outcome: deployResult.outcome,
		retryDecision,
	};
}

export function parseRetryPublishedReaderReleaseArgs(argv: string[]): {
	environment: PublicDocsPublishEnvironment;
	ledgerFilePath?: string;
	lockFilePath?: string;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	recordId?: string;
} {
	const args = [...argv];
	let environment: PublicDocsPublishEnvironment =
		process.env.CLOUDFLARE_ENV === "staging" ? "staging" : "prod";
	let ledgerFilePath: string | undefined;
	let lockFilePath: string | undefined;
	let manifestFilePath: string | undefined = process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH;
	let manifestObjectKey: string | undefined = process.env.PUBLIC_DOCS_SYNC_MANIFEST_KEY;
	let recordId: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--env") {
			environment = parseEnvironment(requireArgValue(args, index, arg));
			index += 1;
		} else if (arg === "--ledger") {
			ledgerFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--lock-file") {
			lockFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--manifest-path") {
			manifestFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--manifest-key") {
			manifestObjectKey = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--record-id") {
			recordId = requireArgValue(args, index, arg);
			index += 1;
		} else {
			throw new Error(`unsupported argument: ${arg}`);
		}
	}
	return {
		environment,
		ledgerFilePath,
		lockFilePath,
		manifestFilePath,
		manifestObjectKey,
		recordId,
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
	const args = parseRetryPublishedReaderReleaseArgs(process.argv.slice(2));
	const runtimeRoot = resolve(APP_ROOT, "../../.planning/runtime/public-docs-publish");
	const result = await retryPublishedReaderRelease({
		client: createS3ObjectStore(),
		environment: args.environment,
		ledgerFilePath: args.ledgerFilePath ?? resolve(runtimeRoot, `${args.environment}-ledger.json`),
		lockFilePath: args.lockFilePath ?? resolve(runtimeRoot, `${args.environment}.lock.json`),
		manifestFilePath: args.manifestFilePath,
		manifestObjectKey: args.manifestObjectKey,
		recordId: args.recordId,
		runnerId: process.env.PUBLIC_DOCS_PUBLISH_RUNNER_ID,
	});
	console.log(JSON.stringify(result, null, 2));
	if (result.outcome === "not_retryable" || result.outcome === "failed") {
		process.exitCode = 1;
	}
	if (result.outcome === "lock_busy") {
		process.exitCode = 2;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
