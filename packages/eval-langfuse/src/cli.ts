#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runAgentToolEval } from "./agent-tool-runner";
import { buildEvalDatasetManifest } from "./dataset-manifest";
import { syncLangfuseDatasets, syncLangfuseScoreConfigs } from "./platform";
import { withRagasRuntimeConfig } from "./provider-config";
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
	if (command === "agent-eval") {
		const projectionPath = stringArg(args, "provider-config-projection");
		return runAgentToolEval({
			appApiBaseUrl: stringArg(args, "app-api-base-url"),
			cookieHeader: stringArg(args, "cookie-header"),
			datasetName: stringArg(args, "dataset"),
			datasetVersion: optionalArg(args, "dataset-version"),
			dryRun: Boolean(args["dry-run"]),
			environment: stringArg(args, "environment"),
			limit: numberArg(args, "limit") ?? undefined,
			runPythonRagasAgentScoreBatch: (input) =>
				runPythonRagasAgentScoreBatch(input, projectionPath),
			runPythonRagasScoreBatch: (input) => runPythonRagasScoreBatch(input, projectionPath),
			settings: settingsFromArgs(args),
			validateOnly: Boolean(args["validate-only"]),
		});
	}
	if (command === "ragas-score-traces") {
		const projectionPath = stringArg(args, "provider-config-projection");
		return runRagasTraceScoring({
			environment: stringArg(args, "environment"),
			limit: numberArg(args, "limit") ?? undefined,
			release: optionalArg(args, "release"),
			runPythonRagasScoreBatch: (input) => runPythonRagasScoreBatch(input, projectionPath),
			settings: settingsFromArgs(args),
			tag: arrayArg(args, "tag"),
			traceName: optionalArg(args, "trace-name") ?? undefined,
			validateOnly: Boolean(args["validate-only"]),
		});
	}
	if (command === "ragas-score-dataset") {
		const projectionPath = stringArg(args, "provider-config-projection");
		return runRagasDatasetScoring({
			datasetName: stringArg(args, "dataset"),
			datasetVersion: optionalArg(args, "dataset-version"),
			environment: stringArg(args, "environment"),
			limit: numberArg(args, "limit") ?? undefined,
			runPythonRagasScoreBatch: (input) => runPythonRagasScoreBatch(input, projectionPath),
			settings: settingsFromArgs(args),
			validateOnly: Boolean(args["validate-only"]),
		});
	}
	if (command === "verify-trace") {
		const productTraceId = optionalArg(args, "product-trace-id");
		const traceId =
			optionalArg(args, "trace-id") ??
			(await deriveLangfuseTraceId(required(productTraceId, "product-trace-id")));
		return verifyLangfuseOnlineTraceEvidence({
			expectedRelease: stringArg(args, "release"),
			expectedRequestId: optionalArg(args, "request-id"),
			expectedRunId: optionalArg(args, "run-id"),
			expectedSessionId: stringArg(args, "session-id"),
			expectedTags: arrayArg(args, "tag"),
			expectedUserId: stringArg(args, "user-id"),
			settings: settingsFromArgs(args),
			traceId,
		});
	}
	if (command === "sync-score-configs") {
		return syncLangfuseScoreConfigs({
			dryRun: Boolean(args["dry-run"]),
			registryPath:
				optionalArg(args, "registry") ??
				resolve(import.meta.dirname, "../assets/registries/langfuse_score_registry.v1.json"),
			settings: settingsFromArgs(args),
		});
	}
	if (command === "sync-datasets") {
		return syncLangfuseDatasets({
			dryRun: Boolean(args["dry-run"]),
			manifestPath: stringArg(args, "dataset-manifest"),
			settings: settingsFromArgs(args),
		});
	}
	if (command === "build-dataset-manifest") {
		const outputPath = stringArg(args, "output");
		return buildEvalDatasetManifest({
			assetRoot: optionalArg(args, "asset-root") ?? resolve(import.meta.dirname, "../assets"),
			outputPath,
			sourceGitHead: optionalArg(args, "source-git-head") ?? currentGitHead(),
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
		if (key === "json" || key === "dry-run" || key === "validate-only") {
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

function runPythonRagasScoreBatch(
	input: { inputPath: string; outputPath: string },
	projectionPath: string,
): void {
	withRagasRuntimeConfig({ kind: "rag", projectionPath }, (runtimeConfigPath) => {
		const result = spawnSync(
			"uv",
			[
				"run",
				"--package",
				"campus-ragas-runner",
				"python",
				"-m",
				"campus_ragas_runner",
				"rag",
				"--input",
				input.inputPath,
				"--output",
				input.outputPath,
				"--runtime-config",
				runtimeConfigPath,
			],
			{ encoding: "utf-8", stdio: "pipe" },
		);
		if (result.status !== 0) {
			throw new Error(`RAGAS scoring failed: ${(result.stderr || result.stdout || "").trim()}`);
		}
	});
}

function runPythonRagasAgentScoreBatch(
	input: { inputPath: string; outputPath: string },
	projectionPath: string,
): void {
	withRagasRuntimeConfig({ kind: "agent", projectionPath }, (runtimeConfigPath) => {
		const result = spawnSync(
			"uv",
			[
				"run",
				"--package",
				"campus-ragas-runner",
				"python",
				"-m",
				"campus_ragas_runner",
				"agent",
				"--input",
				input.inputPath,
				"--output",
				input.outputPath,
				"--runtime-config",
				runtimeConfigPath,
			],
			{ encoding: "utf-8", stdio: "pipe" },
		);
		if (result.status !== 0) {
			throw new Error(
				`RAGAS agent scoring failed: ${(result.stderr || result.stdout || "").trim()}`,
			);
		}
	});
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

function required(value: string | null, field: string): string {
	if (!value) {
		throw new Error(`${field} is required`);
	}
	return value;
}

function settingsFromArgs(args: ParsedArgs) {
	return settingsFromEnv({
		timeoutSeconds: numberArg(args, "timeout-seconds") ?? 10,
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = await main(process.argv.slice(2));
}
