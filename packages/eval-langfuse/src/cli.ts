#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
	buildAgentEvalCaseResults,
	loadAgentEvalCaseSet,
	loadAgentEvalObservations,
	runAgentEvalStaging,
} from "./agent-eval";
import { checkCollectorConfig, deriveCollectorEnv } from "./collector";
import {
	exportLangfuseReviewResults,
	runLangfuseExperiment,
	syncLangfuseAnnotationQueue,
	syncLangfuseDatasets,
	syncLangfuseScoreConfigs,
} from "./platform";
import {
	buildLangfuseReleaseEvidencePayload,
	runLangfuseReleaseEvidenceCloseout,
	validateLangfuseReleaseEvidenceFile,
} from "./release-evidence";
import {
	buildScoreReportFromAgentEvalCaseResults,
	buildScoreReportFromContextFollowupScoreBatch,
	buildScoreReportFromProfileReport,
	buildScoreReportFromRagasScoreBatch,
	loadLangfuseScoreReport,
	publishLangfuseScoreReport,
} from "./score-report";
import { type JsonObject, loadJsonObject, settingsFromEnv, writeJsonObject } from "./shared";
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
	if (command === "build-score-report-from-profile") {
		const profileReportPath = stringArg(args, "profile-report");
		const outputPath = stringArg(args, "output");
		const report = buildScoreReportFromProfileReport({
			environment: environmentFromEnv(),
			profileReportPath,
			profileReportPayload: loadJsonObject(profileReportPath),
		});
		writeJsonObject(outputPath, report);
		return {
			eval_run_id: report.eval_run_id,
			expected_publish_denominator: report.expected_publish_denominator,
			output_path: outputPath,
			source_result_denominator: report.source_result_denominator,
		};
	}
	if (command === "publish-score-report") {
		const scoreReportPath = stringArg(args, "score-report");
		return publishLangfuseScoreReport({
			dryRun: Boolean(args["dry-run"]),
			scoreReportPath,
			scoreReportPayload: loadLangfuseScoreReport(scoreReportPath),
			settings: settingsFromEnv(),
			validateOnly: Boolean(args["validate-only"]),
		});
	}
	if (command === "run-ragas-batch") {
		const inputPath = optionalArg(args, "sample-batch") ?? stringArg(args, "input");
		const ragasOutputPath = stringArg(args, "ragas-output");
		const scoreReportPath = stringArg(args, "score-report");
		runPythonRagasScoreBatch({ inputPath, outputPath: ragasOutputPath });
		const report = buildScoreReportFromRagasScoreBatch({
			environment: environmentFromEnv(),
			ragasScoreBatchPath: ragasOutputPath,
			ragasScoreBatchPayload: loadJsonObject(ragasOutputPath),
		});
		writeJsonObject(scoreReportPath, report);
		return {
			eval_run_id: report.eval_run_id,
			expected_publish_denominator: report.expected_publish_denominator,
			ragas_output_path: ragasOutputPath,
			score_report_path: scoreReportPath,
			source_result_denominator: report.source_result_denominator,
		};
	}
	if (command === "run-context-followup-batch") {
		const inputPath = stringArg(args, "input");
		const contextOutputPath = stringArg(args, "context-output");
		const scoreReportPath = stringArg(args, "score-report");
		runPythonContextFollowupScoreBatch({ inputPath, outputPath: contextOutputPath });
		const report = buildScoreReportFromContextFollowupScoreBatch({
			contextFollowupScoreBatchPath: contextOutputPath,
			contextFollowupScoreBatchPayload: loadJsonObject(contextOutputPath),
			environment: environmentFromEnv(),
		});
		writeJsonObject(scoreReportPath, report);
		return {
			context_output_path: contextOutputPath,
			eval_run_id: report.eval_run_id,
			expected_publish_denominator: report.expected_publish_denominator,
			score_report_path: scoreReportPath,
			source_result_denominator: report.source_result_denominator,
		};
	}
	if (command === "build-score-report-from-agent-eval") {
		const inputPath = stringArg(args, "input");
		const scoreReportPath = stringArg(args, "score-report");
		const report = buildScoreReportFromAgentEvalCaseResults({
			agentEvalCaseResultsPath: inputPath,
			agentEvalCaseResultsPayload: loadJsonObject(inputPath),
			environment: environmentFromEnv(),
		});
		writeJsonObject(scoreReportPath, report);
		return {
			eval_run_id: report.eval_run_id,
			expected_publish_denominator: report.expected_publish_denominator,
			score_report_path: scoreReportPath,
			source_result_denominator: report.source_result_denominator,
		};
	}
	if (command === "build-agent-eval-case-results") {
		const casesPath = stringArg(args, "cases");
		const observationsPath = stringArg(args, "observations");
		const outputPath = stringArg(args, "output");
		const payload = buildAgentEvalCaseResults({
			caseSet: loadAgentEvalCaseSet(casesPath),
			observations: loadAgentEvalObservations(observationsPath),
			sourceGitHead: optionalArg(args, "source-git-head") ?? "unknown",
			variantId: optionalArg(args, "variant-id") ?? "baseline-agent-policy-v1",
		});
		writeJsonObject(outputPath, payload);
		return {
			eval_run_id: payload.eval_run_id,
			output_path: outputPath,
			source_result_denominator: Array.isArray(payload.items) ? payload.items.length : 0,
		};
	}
	if (command === "agent-eval-run-staging") {
		return runAgentEvalStaging({
			casesPath: stringArg(args, "cases"),
			environment: environmentFromEnv(),
			outputObservationsPath: stringArg(args, "output-observations"),
			outputResultsPath: stringArg(args, "output-results"),
			outputScoreReportPath: stringArg(args, "output-score-report"),
			sourceGitHead: optionalArg(args, "source-git-head") ?? "unknown",
			split: optionalArg(args, "split") ?? undefined,
			variantId: optionalArg(args, "variant-id") ?? "baseline-agent-policy-v1",
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
				resolve(import.meta.dirname, "../../evals/fixtures/ops/langfuse_score_registry.v1.json"),
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
	if (command === "run-experiment") {
		return runLangfuseExperiment({
			manifestPath: stringArg(args, "experiment-manifest"),
			settings: settingsFromEnv(),
		});
	}
	if (command === "sync-annotation-queue") {
		return syncLangfuseAnnotationQueue({
			dryRun: Boolean(args["dry-run"]),
			manifestPath: stringArg(args, "review-manifest"),
			settings: settingsFromEnv(),
		});
	}
	if (command === "export-review-results") {
		return exportLangfuseReviewResults({
			manifestPath: stringArg(args, "review-manifest"),
			outputPath: stringArg(args, "output"),
			settings: settingsFromEnv(),
		});
	}
	if (command === "build-release-evidence") {
		const payload = buildLangfuseReleaseEvidencePayload({
			environment: stringArg(args, "environment"),
			langfuseTraceId: stringArg(args, "langfuse-trace-id"),
			productTraceId: stringArg(args, "product-trace-id"),
			publishCommand: stringArg(args, "publish-command"),
			publishExitCode: Number(stringArg(args, "publish-exit-code")),
			publishOutput: loadJsonObject(stringArg(args, "publish-output")),
			release: stringArg(args, "release"),
			verifyCommand: stringArg(args, "verify-command"),
			verifyExitCode: Number(stringArg(args, "verify-exit-code")),
			verifyOutput: loadJsonObject(stringArg(args, "verify-output")),
		});
		writeJsonObject(stringArg(args, "output"), payload);
		return payload;
	}
	if (command === "check-release-evidence") {
		const validation = validateLangfuseReleaseEvidenceFile(stringArg(args, "evidence"));
		if (!validation.passed) {
			throw new Error(validation.errors.join("; "));
		}
		return validation as unknown as JsonObject;
	}
	if (command === "closeout-staging") {
		return runLangfuseReleaseEvidenceCloseout({
			durableChatArtifactPath: stringArg(args, "durable-chat-artifact"),
			environment: stringArg(args, "environment"),
			outputDir: stringArg(args, "output-dir"),
			profileReportPath: stringArg(args, "profile-report"),
			release: stringArg(args, "release"),
			tags: arrayArg(args, "tag"),
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

function runPythonRagasScoreBatch(input: { inputPath: string; outputPath: string }): void {
	const result = spawnSync(
		"uv",
		[
			"run",
			"--all-packages",
			"python",
			"-m",
			"campus_evals.ragas_score_batch",
			"--input",
			input.inputPath,
			"--output",
			input.outputPath,
		],
		{ encoding: "utf-8", stdio: "pipe" },
	);
	if (result.status !== 0) {
		throw new Error(`RAGAS score batch failed: ${(result.stderr || result.stdout || "").trim()}`);
	}
}

function runPythonContextFollowupScoreBatch(input: {
	inputPath: string;
	outputPath: string;
}): void {
	const result = spawnSync(
		"uv",
		[
			"run",
			"--all-packages",
			"python",
			"-m",
			"campus_evals.context_followup_score_batch",
			"--input",
			input.inputPath,
			"--output",
			input.outputPath,
		],
		{ encoding: "utf-8", stdio: "pipe" },
	);
	if (result.status !== 0) {
		throw new Error(
			`context follow-up score batch failed: ${(result.stderr || result.stdout || "").trim()}`,
		);
	}
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
