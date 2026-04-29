import { parseArgs } from "node:util";

import {
	type CaptureFeedWeHistoryResult,
	captureFeedWeHistory,
	createWeChatOfficialAccountArtifactStoreFromEnv,
	createWeChatOfficialAccountControlPlaneClient,
	normalizeWeChatAccountSlug,
	type WeChatOfficialAccountArtifactStore,
	type WeChatOfficialAccountControlPlaneClient,
	type WeChatOfficialAccountObjectStoreEnvironment,
} from "./index.ts";

interface CaptureCliEnvironment extends WeChatOfficialAccountObjectStoreEnvironment {
	FEEDWE_BASE_URL?: string;
	FEEDWE_EMAIL?: string;
	FEEDWE_PASSWORD?: string;
	WECHAT_OFFICIAL_ACCOUNT_APP_API_BASE_URL?: string;
	WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN?: string;
	WECHAT_OFFICIAL_ACCOUNT_TRACE_ID?: string;
	WECHAT_OFFICIAL_ACCOUNT_TRIGGER_TYPE?: string;
}

interface CaptureCliDependencies {
	capture?: typeof captureFeedWeHistory;
	createArtifactStore?: (
		env: CaptureCliEnvironment,
	) => WeChatOfficialAccountArtifactStore | undefined;
	createControlPlaneClient?: (env: {
		appApiBaseUrl?: string | null;
		serviceToken?: string | null;
	}) => WeChatOfficialAccountControlPlaneClient;
	now?: () => Date;
	writeOutput?: (value: string) => void;
}

const COLLECTOR_VERSION = "wechat-official-account-collector@0.1.0";

export async function runCaptureCli(
	argv: string[] = process.argv.slice(2),
	env: CaptureCliEnvironment = process.env,
	dependencies: CaptureCliDependencies = {},
): Promise<void> {
	const capture = dependencies.capture ?? captureFeedWeHistory;
	const createArtifactStore =
		dependencies.createArtifactStore ?? createWeChatOfficialAccountArtifactStoreFromEnv;
	const createControlPlaneClient =
		dependencies.createControlPlaneClient ?? createWeChatOfficialAccountControlPlaneClient;
	const now = dependencies.now ?? (() => new Date());
	const writeOutput = dependencies.writeOutput ?? console.log;
	const { values } = parseArgs({
		allowPositionals: false,
		args: argv[0] === "--" ? argv.slice(1) : argv,
		options: {
			account: { type: "string" },
			"app-api-base-url": { type: "string" },
			begin: { type: "string" },
			"max-articles": { type: "string" },
			"max-pages": { type: "string" },
			"require-control-plane": { type: "boolean" },
			"service-token": { type: "string" },
			size: { type: "string" },
			"trace-id": { type: "string" },
			"trigger-type": { type: "string" },
		},
	});
	const accountName = required(values.account, "--account");
	const email = required(env.FEEDWE_EMAIL, "FEEDWE_EMAIL");
	const password = required(env.FEEDWE_PASSWORD, "FEEDWE_PASSWORD");
	const baseUrl = env.FEEDWE_BASE_URL?.trim() || "https://www.feedwe.top";
	const maxArticles = parsePositiveInt(values["max-articles"], 100);
	const maxPages = parsePositiveInt(values["max-pages"], 10);
	const size = parsePositiveInt(values.size, 20);
	const artifactStore = createArtifactStore(env);
	if (!artifactStore) {
		throw new Error("OBJECT_STORE_* source-bucket configuration is required.");
	}

	const startedAt = now().toISOString();
	const accountSlug = normalizeWeChatAccountSlug(accountName);
	const requestSummary = {
		begin: values.begin ?? "0",
		maxArticles,
		maxPages,
		pageSize: size,
	};
	const controlPlane =
		values["app-api-base-url"] ||
		env.WECHAT_OFFICIAL_ACCOUNT_APP_API_BASE_URL ||
		values["service-token"] ||
		env.WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN
			? createControlPlaneClient({
					appApiBaseUrl: values["app-api-base-url"] ?? env.WECHAT_OFFICIAL_ACCOUNT_APP_API_BASE_URL,
					serviceToken: values["service-token"] ?? env.WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN,
				})
			: null;
	if (values["require-control-plane"] && !controlPlane) {
		throw new Error(
			"wechat collector control plane is required; configure app-api base url and service token.",
		);
	}
	const traceId =
		typeof values["trace-id"] === "string"
			? values["trace-id"]
			: env.WECHAT_OFFICIAL_ACCOUNT_TRACE_ID;
	const triggerType =
		typeof values["trigger-type"] === "string"
			? values["trigger-type"]
			: env.WECHAT_OFFICIAL_ACCOUNT_TRIGGER_TYPE || "manual";
	const schedulerRunKey = `${triggerType}-${accountSlug}-${startedAt}`;

	const run = controlPlane
		? await controlPlane.startRun({
				accountName,
				accountSlug,
				collectorVersion: COLLECTOR_VERSION,
				providerBaseUrl: baseUrl,
				requestSummary,
				schedulerRunKey,
				startedAt,
				traceId,
				triggerType,
			})
		: null;
	let result: CaptureFeedWeHistoryResult | null = null;
	try {
		result = await capture({
			accountName,
			accountSlug,
			artifactStore,
			begin: values.begin,
			maxArticles,
			maxPages,
			provider: { baseUrl, email, password },
			size,
		});

		if (controlPlane && run) {
			await controlPlane.finalizeRun({
				artifacts: result.artifacts,
				finishedAt: now().toISOString(),
				runId: run.run.runId,
				summary: result.summary,
				terminalStatus: result.summary.failures > 0 ? "completed_with_errors" : "completed",
				traceId,
			});
		}

		writeOutput(
			JSON.stringify(
				{
					accountSlug: result.accountSlug,
					artifacts: result.artifacts,
					captureRunId: run?.run.runId ?? null,
					planningOutcome: result.planningOutcome,
					summary: result.summary,
				},
				null,
				2,
			),
		);
	} catch (error) {
		const terminalError = redactTerminalError(error, [
			email,
			password,
			values["service-token"],
			env.WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN,
		]);
		if (controlPlane && run) {
			await controlPlane.finalizeRun({
				artifacts: result?.artifacts ?? [],
				error: terminalError,
				finishedAt: now().toISOString(),
				runId: run.run.runId,
				summary: result?.summary ?? {
					artifactUploads: 0,
					articlesSeen: 0,
					failures: 1,
					pagesFetched: 0,
				},
				terminalStatus: "failed",
				traceId,
			});
		}
		throw buildRedactedError(terminalError);
	}
}

function required(value: unknown, field: string): string {
	const normalized = typeof value === "string" ? value.trim() : "";
	if (!normalized) {
		throw new Error(`${field} is required.`);
	}
	return normalized;
}

function parsePositiveInt(value: unknown, fallback: number): number {
	if (typeof value !== "string" || !value.trim()) {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function redactTerminalError(
	error: unknown,
	secretCandidates: unknown[],
): { code: string; message: string } {
	const code =
		error && typeof error === "object" && "code" in error && typeof error.code === "string"
			? error.code
			: "capture_failed";
	let message = error instanceof Error ? error.message : String(error);
	for (const secret of secretCandidates) {
		if (typeof secret !== "string" || !secret.trim()) {
			continue;
		}
		message = message.split(secret).join("[REDACTED]");
	}
	return {
		code,
		message: message.slice(0, 1000),
	};
}

function buildRedactedError(input: { code: string; message: string }): Error {
	const error = new Error(input.message);
	Object.defineProperty(error, "code", {
		configurable: true,
		enumerable: true,
		value: input.code,
	});
	return error;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runCaptureCli().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
