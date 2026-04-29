import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PublicDocsPublishEnvironment } from "./check-published-reader-manifest";
import {
	type PublicDocsDeployPipelineCommandRunner,
	type PublicDocsDeployPipelineCommandSpec,
	type PublicDocsDeployPipelineResult,
	runPublishedReaderDeployPipeline,
} from "./run-published-reader-deploy-pipeline";
import { APP_ROOT } from "./sync-real-docs/shared";
import { createS3ObjectStore, type ObjectStoreClient } from "./sync-real-docs/storage";

export interface PublishedReaderDeployHookPayload {
	branch?: unknown;
	environment?: unknown;
	eventId?: unknown;
	manifestDigest?: unknown;
	manifestObjectKey?: unknown;
	releaseId?: unknown;
	secret?: unknown;
	source?: unknown;
	surface?: unknown;
}

export interface TrustedPublishedReaderDeployHookPayload {
	environment: PublicDocsPublishEnvironment;
	eventId?: string;
	source?: unknown;
	surface: "public_docs";
}

export interface CloudflareDeployHookDispatchResult {
	body: string;
	ok: boolean;
	status: number;
}

export type PublishedReaderDeployHookNudgeResult =
	| {
			deployResult: PublicDocsDeployPipelineResult;
			mode: "local_pipeline";
			payload: TrustedPublishedReaderDeployHookPayload;
	  }
	| {
			dispatchResult: CloudflareDeployHookDispatchResult;
			mode: "cloudflare_deploy_hook";
			payload: TrustedPublishedReaderDeployHookPayload;
	  };

type DeployHookFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;

export function validatePublishedReaderDeployHookPayload(input: {
	environment: PublicDocsPublishEnvironment;
	expectedSecret?: string;
	payload: PublishedReaderDeployHookPayload | unknown;
	payloadSecret?: string;
}): TrustedPublishedReaderDeployHookPayload {
	const payload = normalizePayloadObject(input.payload);
	if (payload.surface !== "public_docs") {
		throw new Error("deploy hook payload must use surface=public_docs");
	}
	if (payload.environment !== undefined) {
		const payloadEnvironment = parseOptionalPayloadEnvironment(payload.environment);
		if (payloadEnvironment !== input.environment) {
			throw new Error(
				`payload environment ${payloadEnvironment} does not match runner environment ${input.environment}`,
			);
		}
	}
	if (input.expectedSecret !== undefined) {
		const actualSecret = input.payloadSecret ?? parseOptionalString(payload.secret);
		if (!(actualSecret && safeSecretEquals(actualSecret, input.expectedSecret))) {
			throw new Error("deploy hook secret mismatch");
		}
	}

	const eventId = parseOptionalString(payload.eventId);
	return {
		environment: input.environment,
		eventId,
		source: payload.source,
		surface: "public_docs",
	};
}

export async function triggerCloudflareDeployHook(input: {
	deployHookUrl: string;
	fetchImpl?: DeployHookFetch;
	payload: TrustedPublishedReaderDeployHookPayload;
}): Promise<CloudflareDeployHookDispatchResult> {
	const fetchImpl = input.fetchImpl ?? globalThis.fetch;
	if (!fetchImpl) {
		throw new Error("fetch is not available for Cloudflare deploy hook dispatch");
	}
	const response = await fetchImpl(input.deployHookUrl, {
		body: JSON.stringify(input.payload),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
	return {
		body: await response.text(),
		ok: response.ok,
		status: response.status,
	};
}

export async function nudgePublishedReaderDeployHook(input: {
	client?: ObjectStoreClient;
	commandRunner?: PublicDocsDeployPipelineCommandRunner;
	commands?: PublicDocsDeployPipelineCommandSpec[];
	deployHookUrl?: string;
	dryRun?: boolean;
	environment: PublicDocsPublishEnvironment;
	expectedSecret?: string;
	fetchImpl?: DeployHookFetch;
	ledgerFilePath?: string;
	lockFilePath?: string;
	lockStaleMs?: number;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	now?: string;
	payload: PublishedReaderDeployHookPayload | unknown;
	payloadSecret?: string;
	runnerId?: string;
}): Promise<PublishedReaderDeployHookNudgeResult> {
	const payload = validatePublishedReaderDeployHookPayload({
		environment: input.environment,
		expectedSecret: input.expectedSecret,
		payload: input.payload,
		payloadSecret: input.payloadSecret,
	});
	if (input.deployHookUrl) {
		return {
			dispatchResult: await triggerCloudflareDeployHook({
				deployHookUrl: input.deployHookUrl,
				fetchImpl: input.fetchImpl,
				payload,
			}),
			mode: "cloudflare_deploy_hook",
			payload,
		};
	}

	const runtimeRoot = resolve(APP_ROOT, "../../.planning/runtime/public-docs-publish");
	const deployResult = await runPublishedReaderDeployPipeline({
		client: input.client ?? createS3ObjectStore(),
		commandRunner: input.commandRunner,
		commands: input.commands,
		dryRun: input.dryRun,
		environment: input.environment,
		force: true,
		ledgerFilePath:
			input.ledgerFilePath ?? resolve(runtimeRoot, `${input.environment}-ledger.json`),
		lockFilePath: input.lockFilePath ?? resolve(runtimeRoot, `${input.environment}.lock.json`),
		lockStaleMs: input.lockStaleMs ?? DEFAULT_LOCK_STALE_MS,
		manifestFilePath: input.manifestFilePath,
		manifestObjectKey: input.manifestObjectKey,
		now: input.now,
		runnerId: input.runnerId,
		trigger: "hook",
	});
	return {
		deployResult,
		mode: "local_pipeline",
		payload,
	};
}

export function parsePublishedReaderDeployHookArgs(argv: string[]): {
	deployHookUrl?: string;
	dryRun: boolean;
	environment: PublicDocsPublishEnvironment;
	expectedSecret?: string;
	ledgerFilePath?: string;
	lockFilePath?: string;
	lockStaleMs: number;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	now?: string;
	payloadFilePath?: string;
	payloadJson?: string;
	payloadSecret?: string;
} {
	const args = [...argv];
	let deployHookUrl: string | undefined = process.env.PUBLIC_DOCS_DEPLOY_HOOK_URL;
	let dryRun = false;
	let environment: PublicDocsPublishEnvironment =
		process.env.CLOUDFLARE_ENV === "staging" ? "staging" : "prod";
	let expectedSecret: string | undefined = process.env.PUBLIC_DOCS_DEPLOY_HOOK_SECRET;
	let ledgerFilePath: string | undefined;
	let lockFilePath: string | undefined;
	let lockStaleMs = DEFAULT_LOCK_STALE_MS;
	let manifestFilePath: string | undefined = process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH;
	let manifestObjectKey: string | undefined = process.env.PUBLIC_DOCS_SYNC_MANIFEST_KEY;
	let now: string | undefined;
	let payloadFilePath: string | undefined;
	let payloadJson: string | undefined;
	let payloadSecret: string | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--deploy-hook-url") {
			deployHookUrl = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--dry-run") {
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
		} else if (arg === "--payload-json") {
			payloadJson = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--payload-path") {
			payloadFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--payload-secret") {
			payloadSecret = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--secret") {
			expectedSecret = requireArgValue(args, index, arg);
			index += 1;
		} else {
			throw new Error(`unsupported argument: ${arg}`);
		}
	}

	return {
		deployHookUrl,
		dryRun,
		environment,
		expectedSecret,
		ledgerFilePath,
		lockFilePath,
		lockStaleMs,
		manifestFilePath,
		manifestObjectKey,
		now,
		payloadFilePath,
		payloadJson,
		payloadSecret,
	};
}

function normalizePayloadObject(payload: unknown): PublishedReaderDeployHookPayload {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new Error("deploy hook payload must be an object");
	}
	return payload as PublishedReaderDeployHookPayload;
}

function parseOptionalPayloadEnvironment(value: unknown): PublicDocsPublishEnvironment {
	if (value === "prod" || value === "staging") {
		return value;
	}
	throw new Error("deploy hook payload environment must be prod or staging");
}

function parseOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function safeSecretEquals(actual: string, expected: string): boolean {
	const actualBuffer = Buffer.from(actual);
	const expectedBuffer = Buffer.from(expected);
	return (
		actualBuffer.byteLength === expectedBuffer.byteLength &&
		timingSafeEqual(actualBuffer, expectedBuffer)
	);
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

function readPayloadFromArgs(input: {
	payloadFilePath?: string;
	payloadJson?: string;
}): PublishedReaderDeployHookPayload {
	if (input.payloadJson) {
		return JSON.parse(input.payloadJson) as PublishedReaderDeployHookPayload;
	}
	if (input.payloadFilePath) {
		return JSON.parse(
			readFileSync(input.payloadFilePath, "utf8"),
		) as PublishedReaderDeployHookPayload;
	}
	return { surface: "public_docs" };
}

async function main(): Promise<void> {
	const args = parsePublishedReaderDeployHookArgs(process.argv.slice(2));
	const result = await nudgePublishedReaderDeployHook({
		deployHookUrl: args.deployHookUrl,
		dryRun: args.dryRun,
		environment: args.environment,
		expectedSecret: args.expectedSecret,
		ledgerFilePath: args.ledgerFilePath,
		lockFilePath: args.lockFilePath,
		lockStaleMs: args.lockStaleMs,
		manifestFilePath: args.manifestFilePath,
		manifestObjectKey: args.manifestObjectKey,
		now: args.now,
		payload: readPayloadFromArgs(args),
		payloadSecret: args.payloadSecret,
		runnerId: process.env.PUBLIC_DOCS_PUBLISH_RUNNER_ID,
	});
	console.log(JSON.stringify(result, null, 2));
	if (result.mode === "cloudflare_deploy_hook" && !result.dispatchResult.ok) {
		process.exitCode = 1;
	}
	if (result.mode === "local_pipeline") {
		if (result.deployResult.outcome === "lock_busy") {
			process.exitCode = 2;
		}
		if (
			result.deployResult.outcome === "failed" ||
			result.deployResult.outcome === "not_deployable"
		) {
			process.exitCode = 1;
		}
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
