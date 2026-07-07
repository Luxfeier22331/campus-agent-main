#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { checkCollectorConfig, deriveCollectorEnv } from "./collector";
import { syncLangfuseDatasets, syncLangfuseScoreConfigs } from "./platform";
import { runPublicWebSearchAgentEval } from "./public-web-search-agent-runner";
import { loadPublicWebSearchEvalAsset } from "./public-web-search-eval";
import { buildRagDatasetManifest } from "./rag-dataset-manifest";
import { runRagasDatasetScoring, runRagasTraceScoring } from "./ragas-langfuse";
import { type JsonObject, settingsFromEnv } from "./shared";
import { deriveLangfuseTraceId } from "./trace";
import { verifyLangfuseOnlineTraceEvidence } from "./trace-evidence";

type ParsedArgs = Record<string, string | string[] | boolean>;

export async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;
	const args = parseArgs(rest);
	const json = Boolean(args.json);
	try {
		const result = await handleCommand(command ?? "", args);
		if (json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			console.log(JSON.stringify(result));
		}
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

async function handleCommand(command: string, args: ParsedArgs): Promise<JsonObject> {
	if (command === "ragas-score-traces") {
		return runRagasTraceScoring({
			environment: environmentFromEnv(),
			limit: numberArg(args, "limit") ?? undefined,
			release: optionalArg(args, "release"),
			runPythonRagasScoreBatch,
			runtimeConfigPath: optionalArg(args, "runtime-config") ?? undefined,
			settings: settingsFromEnv(),
			tag: arrayArg(args, "tag"),
			traceName: optionalArg(args, "trace-name") ?? undefined,
			validateOnly: Boolean(args["validate-only"]),
		});
	}
	if (command === "ragas-score-dataset") {
		return runRagasDatasetScoring({
			datasetName: stringArg(args, "dataset"),
			datasetVersion: optionalArg(args, "dataset-version"),
			environment: environmentFromEnv(),
			limit: numberArg(args, "limit") ?? undefined,
			runPythonRagasScoreBatch,
			runtimeConfigPath: optionalArg(args, "runtime-config") ?? undefined,
			settings: settingsFromEnv(),
			validateOnly: Boolean(args["validate-only"]),
		});
	}
	if (command === "verify-trace") {
		const productTraceId = optionalArg(args, "product-trace-id");
		const traceId =
			optionalArg(args, "trace-id") ??
			deriveLangfuseTraceId(required(productTraceId, "product-trace-id"));
		return verifyLangfuseOnlineTraceEvidence({
			expectedRelease: stringArg(args, "release"),
			expectedRequestId: optionalArg(args, "request-id"),
			expectedRunId: optionalArg(args, "run-id"),
			expectedSessionId: stringArg(args, "session-id"),
			expectedTags: arrayArg(args, "tag"),
			expectedUserId: stringArg(args, "user-id"),
			expectedWorkflowId: optionalArg(args, "workflow-id"),
			settings: settingsFromEnv(),
			traceId,
		});
	}
	if (command === "sync-score-configs") {
		return syncLangfuseScoreConfigs({
			dryRun: Boolean(args["dry-run"]),
			registryPath:
				optionalArg(args, "registry") ??
				resolve(import.meta.dirname, "../assets/registries/langfuse_score_registry.v1.json"),
			settings: settingsFromEnv(),
		});
	}
	if (command === "sync-datasets") {
		return syncLangfuseDatasets({
			dryRun: Boolean(args["dry-run"]),
			manifestPath: stringArg(args, "dataset-manifest"),
			settings: settingsFromEnv(),
		});
	}
	if (command === "build-rag-dataset-manifest") {
		const outputPath = stringArg(args, "output");
		return buildRagDatasetManifest({
			assetRoot: optionalArg(args, "asset-root") ?? resolve(import.meta.dirname, "../assets"),
			outputPath,
			sourceGitHead: optionalArg(args, "source-git-head") ?? currentGitHead(),
		});
	}
	if (command === "validate-public-web-search-eval") {
		return loadPublicWebSearchEvalAsset(
			optionalArg(args, "asset") ??
				resolve(
					import.meta.dirname,
					"../assets/datasets/agent/public_web_search/agent_cases.v1.json",
				),
		);
	}
	if (command === "run-public-web-search-agent-eval") {
		const publishScores = Boolean(args["publish-scores"]);
		return runPublicWebSearchAgentEval({
			assetPath:
				optionalArg(args, "asset") ??
				resolve(
					import.meta.dirname,
					"../assets/datasets/agent/public_web_search/agent_cases.v1.json",
				),
			baseUrl: stringArg(args, "app-api-base-url"),
			cookieHeader: optionalArg(args, "cookie-header"),
			dryRun: !publishScores,
			environment: environmentFromEnv(),
			limit: numberArg(args, "limit") ?? undefined,
			model: optionalArg(args, "provider-model"),
			provider: publicWebSearchProviderArg(args),
			providerProfileId: optionalArg(args, "provider-profile-id"),
			settings: settingsForOptionalPublish(publishScores),
			stagingSmokeAuthSecret: optionalArg(args, "staging-smoke-auth-secret"),
			stagingSmokeEmail: optionalArg(args, "staging-smoke-email"),
			validateOnly: Boolean(args["validate-only"]),
		});
	}
	if (command === "check-collector-config") {
		const validation = checkCollectorConfig(process.env);
		if (!validation.passed) {
			throw new Error(validation.errors.join("; "));
		}
		return validation as unknown as JsonObject;
	}
	if (command === "derive-collector-env") {
		return deriveCollectorEnv({
			baseUrl: stringArg(args, "base-url"),
			publicKey: stringArg(args, "public-key"),
			secretKey: stringArg(args, "secret-key"),
		});
	}
	throw new Error(`Unknown command: ${command}`);
}

function parseArgs(argv: string[]): ParsedArgs {
	const parsed: ParsedArgs = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token) {
			throw new Error("Unexpected empty argument");
		}
		if (!token.startsWith("--")) {
			throw new Error(`Unexpected argument: ${token}`);
		}
		const key = token.slice(2);
		if (
			key === "json" ||
			key === "dry-run" ||
			key === "validate-only" ||
			key === "publish-scores"
		) {
			parsed[key] = true;
			continue;
		}
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`${token} requires a value`);
		}
		if (key === "tag") {
			parsed[key] = [...arrayArg(parsed, key), value];
		} else {
			parsed[key] = value;
		}
		index += 1;
	}
	return parsed;
}

function settingsForOptionalPublish(publishScores: boolean) {
	if (publishScores) {
		return settingsFromEnv();
	}
	return {
		baseUrl: "",
		environment: environmentFromEnv(),
		publicKey: "",
		secretKey: "",
	};
}

function runPythonRagasScoreBatch(input: {
	inputPath: string;
	outputPath: string;
	runtimeConfigPath?: string;
}): void {
	const args = [
		"run",
		"--package",
		"campus-ragas-runner",
		"python",
		"-m",
		"campus_ragas_runner",
		"--input",
		input.inputPath,
		"--output",
		input.outputPath,
	];
	if (input.runtimeConfigPath) {
		args.push("--runtime-config", input.runtimeConfigPath);
	}
	const result = spawnSync("uv", args, { encoding: "utf-8", stdio: "pipe" });
	if (result.status !== 0) {
		throw new Error(`RAGAS scoring failed: ${(result.stderr || result.stdout || "").trim()}`);
	}
}

function currentGitHead(): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf-8",
		stdio: "pipe",
	});
	if (result.status !== 0) {
		throw new Error(`git rev-parse HEAD failed: ${(result.stderr || result.stdout || "").trim()}`);
	}
	return result.stdout.trim();
}

function stringArg(args: ParsedArgs, key: string): string {
	const value = optionalArg(args, key);
	return required(value, key);
}

function optionalArg(args: ParsedArgs, key: string): string | null {
	const value = args[key];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayArg(args: ParsedArgs, key: string): string[] {
	const value = args[key];
	if (Array.isArray(value)) {
		return value;
	}
	if (typeof value === "string") {
		return [value];
	}
	return [];
}

function numberArg(args: ParsedArgs, key: string): number | null {
	const value = optionalArg(args, key);
	if (!value) {
		return null;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${key} must be a positive integer`);
	}
	return parsed;
}

function publicWebSearchProviderArg(
	args: ParsedArgs,
): "gemini" | "linux_do" | "openai" | "perplexity" | "perplexity_compatible" | null {
	const value = optionalArg(args, "provider");
	if (!value) {
		return null;
	}
	if (
		value === "gemini" ||
		value === "linux_do" ||
		value === "openai" ||
		value === "perplexity" ||
		value === "perplexity_compatible"
	) {
		return value;
	}
	throw new Error(
		"provider must be gemini, linux_do, openai, perplexity, or perplexity_compatible",
	);
}

function required(value: string | null, field: string): string {
	if (!value) {
		throw new Error(`${field} is required`);
	}
	return value;
}

function environmentFromEnv(env: NodeJS.ProcessEnv = process.env): string {
	return (
		env.LANGFUSE_ENVIRONMENT?.trim() ||
		env.CAMPUS_EVAL_ENVIRONMENT?.trim() ||
		env.NODE_ENV?.trim() ||
		"local"
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = await main(process.argv.slice(2));
}
