import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { buildScoreReportFromProfileReport, loadLangfuseScoreReport } from "./score-report";
import { type JsonObject, loadJsonObject, writeJsonObject } from "./shared";
import { deriveLangfuseTraceId } from "./trace";

export const RELEASE_EVIDENCE_SCHEMA_VERSION = "langfuse_release_evidence.v1";

export interface ReleaseEvidenceValidation {
	errors: string[];
	passed: boolean;
}

export function buildLangfuseReleaseEvidencePayload(input: {
	environment: string;
	langfuseTraceId: string;
	productTraceId: string;
	publishCommand: string;
	publishExitCode: number;
	publishOutput: JsonObject;
	release: string;
	verifyCommand: string;
	verifyExitCode: number;
	verifyOutput: JsonObject;
}): JsonObject {
	return {
		environment: required(input.environment, "environment"),
		langfuse_trace_id: required(input.langfuseTraceId, "langfuse_trace_id"),
		product_trace_id: required(input.productTraceId, "product_trace_id"),
		publish_langfuse_score_report: {
			command: required(input.publishCommand, "publish_command"),
			exit_code: input.publishExitCode,
			output: input.publishOutput,
		},
		release: required(input.release, "release"),
		schema_version: RELEASE_EVIDENCE_SCHEMA_VERSION,
		verify_langfuse_trace: {
			command: required(input.verifyCommand, "verify_command"),
			exit_code: input.verifyExitCode,
			output: input.verifyOutput,
		},
	};
}

export function validateLangfuseReleaseEvidence(payload: JsonObject): ReleaseEvidenceValidation {
	const errors: string[] = [];
	if (payload.schema_version !== RELEASE_EVIDENCE_SCHEMA_VERSION) {
		errors.push(`schema_version must be ${RELEASE_EVIDENCE_SCHEMA_VERSION}`);
	}
	for (const field of ["environment", "release", "product_trace_id", "langfuse_trace_id"]) {
		if (!asString(payload[field])) {
			errors.push(`${field} is required`);
		}
	}
	const productTraceId = asString(payload.product_trace_id);
	const langfuseTraceId = asString(payload.langfuse_trace_id);
	if (
		productTraceId &&
		langfuseTraceId &&
		deriveLangfuseTraceId(productTraceId) !== langfuseTraceId
	) {
		errors.push("langfuse_trace_id must match product_trace_id derivation");
	}
	validateCommandBlock(
		payload.verify_langfuse_trace,
		"verify_langfuse_trace",
		["verify-trace", "--json"],
		errors,
	);
	validateCommandBlock(
		payload.publish_langfuse_score_report,
		"publish_langfuse_score_report",
		["publish-score-report", "--score-report", "--json"],
		errors,
	);
	const publish = record(payload.publish_langfuse_score_report);
	const publishOutput = record(publish?.output);
	if (numberField(publishOutput?.failed) !== 0) {
		errors.push("publish_langfuse_score_report.output.failed must be 0");
	}
	if (numberField(publishOutput?.omitted) !== 0) {
		errors.push("publish_langfuse_score_report.output.omitted must be 0");
	}
	if (
		numberField(publishOutput?.expected_publish_denominator) !==
		numberField(publishOutput?.published)
	) {
		errors.push("publish_langfuse_score_report published count must match expected denominator");
	}
	return { errors, passed: errors.length === 0 };
}

export function validateLangfuseReleaseEvidenceFile(path: string): ReleaseEvidenceValidation {
	return validateLangfuseReleaseEvidence(loadJsonObject(path));
}

export function runLangfuseReleaseEvidenceCloseout(input: {
	durableChatArtifactPath: string;
	environment: string;
	outputDir: string;
	profileReportPath: string;
	release: string;
	tags: string[];
}): JsonObject {
	if (!existsSync(input.profileReportPath)) {
		throw new Error(`profile report does not exist: ${input.profileReportPath}`);
	}
	if (!existsSync(input.durableChatArtifactPath)) {
		throw new Error(`durable chat artifact does not exist: ${input.durableChatArtifactPath}`);
	}
	const identity = productIdentityFromChatArtifact(input.durableChatArtifactPath);
	const scoreReportPath = resolve(input.outputDir, "langfuse-score-report.json");
	const scoreReport = buildScoreReportFromProfileReport({
		environment: input.environment,
		profileReportPath: input.profileReportPath,
		profileReportPayload: loadJsonObject(input.profileReportPath),
	});
	writeJsonObject(scoreReportPath, scoreReport);
	const verifyArgs = [
		"--dir",
		"packages/eval-langfuse",
		"langfuse",
		"verify-trace",
		"--product-trace-id",
		identity.productTraceId,
		"--session-id",
		identity.sessionId,
		"--user-id",
		identity.userId,
		"--release",
		input.release,
		"--request-id",
		identity.requestId,
		"--run-id",
		identity.runId,
		"--workflow-id",
		identity.workflowId,
		"--json",
		...input.tags.flatMap((tag) => ["--tag", tag]),
	];
	const verify = runJsonCommand("pnpm", verifyArgs);
	writeJsonObject(resolve(input.outputDir, "verify-trace.json"), verify.output);
	const publishArgs = [
		"--dir",
		"packages/eval-langfuse",
		"langfuse",
		"publish-score-report",
		"--score-report",
		scoreReportPath,
		"--json",
	];
	const publish = runJsonCommand("pnpm", publishArgs);
	writeJsonObject(resolve(input.outputDir, "publish-score-report.json"), publish.output);
	const payload = buildLangfuseReleaseEvidencePayload({
		environment: input.environment,
		langfuseTraceId: deriveLangfuseTraceId(identity.productTraceId),
		productTraceId: identity.productTraceId,
		publishCommand: `pnpm ${publishArgs.join(" ")}`,
		publishExitCode: publish.exitCode,
		publishOutput: publish.output,
		release: input.release,
		verifyCommand: `pnpm ${verifyArgs.join(" ")}`,
		verifyExitCode: verify.exitCode,
		verifyOutput: verify.output,
	});
	const artifactPath = resolve(input.outputDir, "langfuse-release-evidence.json");
	writeJsonObject(artifactPath, payload);
	const validation = validateLangfuseReleaseEvidence(payload);
	if (!validation.passed) {
		throw new Error(`Langfuse release evidence failed: ${validation.errors.join("; ")}`);
	}
	return { artifact_path: artifactPath, passed: true };
}

function productIdentityFromChatArtifact(path: string): Record<string, string> {
	const payload = loadJsonObject(path);
	const closeout = record(payload.langfuseCloseout);
	if (!closeout) {
		throw new Error("durable chat artifact must include langfuseCloseout object");
	}
	return {
		productTraceId: required(closeout.productTraceId, "langfuseCloseout.productTraceId"),
		requestId: required(closeout.requestId, "langfuseCloseout.requestId"),
		runId: required(closeout.runId, "langfuseCloseout.runId"),
		sessionId: required(closeout.sessionId, "langfuseCloseout.sessionId"),
		userId: required(closeout.userId, "langfuseCloseout.userId"),
		workflowId: required(closeout.workflowId, "langfuseCloseout.workflowId"),
	};
}

function runJsonCommand(command: string, args: string[]): { exitCode: number; output: JsonObject } {
	const result = spawnSync(command, args, { encoding: "utf-8" });
	const exitCode = result.status ?? 1;
	if (exitCode !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`);
	}
	const parsed = JSON.parse(result.stdout.trim()) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${command} ${args.join(" ")} must output a JSON object`);
	}
	return { exitCode, output: parsed as JsonObject };
}

function validateCommandBlock(
	value: unknown,
	field: string,
	requiredTokens: string[],
	errors: string[],
): void {
	const block = record(value);
	if (!block) {
		errors.push(`${field} must be an object`);
		return;
	}
	const command = asString(block.command);
	if (!command) {
		errors.push(`${field}.command is required`);
	}
	for (const token of requiredTokens) {
		if (command && !command.includes(token)) {
			errors.push(`${field}.command must include ${token}`);
		}
	}
	if (!Number.isInteger(block.exit_code)) {
		errors.push(`${field}.exit_code must be an integer`);
	}
	if (block.exit_code !== 0) {
		errors.push(`${field}.exit_code must be 0`);
	}
	if (!record(block.output)) {
		errors.push(`${field}.output must be an object`);
	}
}

function required(value: unknown, field: string): string {
	const normalized = asString(value);
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): JsonObject | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function numberField(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function loadScoreReportForEvidence(path: string): JsonObject {
	return loadLangfuseScoreReport(path);
}
