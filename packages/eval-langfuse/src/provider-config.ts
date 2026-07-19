import {
	closeSync,
	constants,
	fstatSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isRecord, type JsonObject } from "./shared";

const PROJECTION_SCHEMA_VERSION = "provider_config_projection.v1";
const RUNNER_CONFIG_SCHEMA_VERSION = "ragas_runner_config.v1";
const MAX_PROJECTION_BYTES = 64 * 1024;

type EvalProviderRole = "eval_judge_llm" | "eval_ragas_embedding" | "eval_ragas_llm";
export type RagasRuntimeKind = "agent" | "rag";

interface EvalProviderProfile {
	apiKey: string;
	baseUrl: string;
	dimensions?: number;
	model: string;
	provider: string;
	timeoutMs: number;
	transport: string;
}

interface EvalProviderProjection {
	profiles: Record<EvalProviderRole, EvalProviderProfile>;
}

export function withRagasRuntimeConfig<T>(
	input: { kind: RagasRuntimeKind; projectionPath: string },
	callback: (runtimeConfigPath: string) => T,
): T {
	const projection = loadEvalProviderProjection(input.projectionPath);
	const workDir = mkdtempSync(join(tmpdir(), "campus-ragas-config-"));
	const runtimeConfigPath = join(workDir, "ragas-runner-config.json");
	try {
		writeFileSync(
			runtimeConfigPath,
			`${JSON.stringify(buildRagasRuntimeConfig(projection, input.kind), null, 2)}\n`,
			{ encoding: "utf-8", flag: "wx", mode: 0o600 },
		);
		if ((statSync(runtimeConfigPath).mode & 0o777) !== 0o600) {
			throw new Error("generated Ragas runtime config mode must be exactly 0600");
		}
		return callback(runtimeConfigPath);
	} finally {
		rmSync(workDir, { force: true, recursive: true });
	}
}

export function loadEvalProviderProjection(path: string): EvalProviderProjection {
	const normalizedPath = path.trim();
	if (!normalizedPath) {
		throw new Error("EVAL_PROVIDER_CONFIG_PROJECTION_PATH is required");
	}
	let descriptor: number;
	try {
		descriptor = openSync(normalizedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch (error) {
		throw new Error(`open eval provider projection: ${errorMessage(error)}`);
	}
	try {
		const status = fstatSync(descriptor);
		if (!status.isFile()) {
			throw new Error("eval provider projection must be a regular file");
		}
		if ((status.mode & 0o777) !== 0o600) {
			throw new Error("eval provider projection mode must be exactly 0600");
		}
		const currentUid = process.getuid?.();
		if (currentUid !== undefined && status.uid !== currentUid) {
			throw new Error("eval provider projection must be owned by the current user");
		}
		if (status.size > MAX_PROJECTION_BYTES) {
			throw new Error(`eval provider projection must not exceed ${MAX_PROJECTION_BYTES} bytes`);
		}
		return parseEvalProviderProjection(readFileSync(descriptor, "utf-8"));
	} finally {
		closeSync(descriptor);
	}
}

function parseEvalProviderProjection(raw: string): EvalProviderProjection {
	let payload: unknown;
	try {
		payload = JSON.parse(raw);
	} catch (error) {
		throw new Error(`parse eval provider projection: ${errorMessage(error)}`);
	}
	if (!isRecord(payload)) {
		throw new Error("eval provider projection must be a JSON object");
	}
	assertOnlyKeys(payload, ["profiles", "schema_version"], "provider projection");
	if (payload.schema_version !== PROJECTION_SCHEMA_VERSION) {
		throw new Error(`eval provider projection schema_version must be ${PROJECTION_SCHEMA_VERSION}`);
	}
	if (!isRecord(payload.profiles)) {
		throw new Error("eval provider projection profiles must be an object");
	}
	const roles: EvalProviderRole[] = ["eval_judge_llm", "eval_ragas_embedding", "eval_ragas_llm"];
	assertOnlyKeys(payload.profiles, roles, "provider projection profiles");
	return {
		profiles: {
			eval_judge_llm: parseProfile(payload.profiles.eval_judge_llm, "eval_judge_llm"),
			eval_ragas_embedding: parseProfile(
				payload.profiles.eval_ragas_embedding,
				"eval_ragas_embedding",
			),
			eval_ragas_llm: parseProfile(payload.profiles.eval_ragas_llm, "eval_ragas_llm"),
		},
	};
}

function parseProfile(value: unknown, role: EvalProviderRole): EvalProviderProfile {
	if (!isRecord(value)) {
		throw new Error(`eval provider projection ${role} must be an object`);
	}
	assertOnlyKeys(
		value,
		["api_key", "base_url", "dimensions", "model", "provider", "timeout_ms", "transport"],
		`provider projection ${role}`,
	);
	const profile: EvalProviderProfile = {
		apiKey: requiredString(value.api_key, `${role}.api_key`),
		baseUrl: httpUrl(value.base_url, `${role}.base_url`),
		model: requiredString(value.model, `${role}.model`),
		provider: requiredString(value.provider, `${role}.provider`),
		timeoutMs: positiveInteger(value.timeout_ms, `${role}.timeout_ms`),
		transport: requiredString(value.transport, `${role}.transport`),
	};
	if (value.dimensions !== undefined) {
		profile.dimensions = positiveInteger(value.dimensions, `${role}.dimensions`);
	}
	if (profile.provider !== "openai") {
		throw new Error(`${role}.provider must be openai for the current Ragas runner`);
	}
	const allowedTransports =
		role === "eval_ragas_embedding"
			? new Set(["openai_embeddings"])
			: new Set(["openai_chat_completions", "openai_responses", "responses"]);
	if (!allowedTransports.has(profile.transport)) {
		throw new Error(`${role}.transport is not supported by the current Ragas runner`);
	}
	return profile;
}

function buildRagasRuntimeConfig(
	projection: EvalProviderProjection,
	kind: RagasRuntimeKind,
): JsonObject {
	const llm =
		kind === "agent" ? projection.profiles.eval_judge_llm : projection.profiles.eval_ragas_llm;
	const config: JsonObject = {
		llm_api_key: llm.apiKey,
		llm_base_url: llm.baseUrl,
		llm_model: llm.model,
		schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
		timeout_seconds: Math.ceil(llm.timeoutMs / 1000),
	};
	if (kind === "rag") {
		const embedding = projection.profiles.eval_ragas_embedding;
		config.embedding_api_key = embedding.apiKey;
		config.embedding_base_url = embedding.baseUrl;
		config.embedding_model = embedding.model;
		config.timeout_seconds = Math.ceil(Math.max(llm.timeoutMs, embedding.timeoutMs) / 1000);
	}
	return config;
}

function assertOnlyKeys(value: JsonObject, allowed: readonly string[], field: string): void {
	const allowedKeys = new Set(allowed);
	const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
	if (unknown.length > 0) {
		throw new Error(`${field} contains unsupported fields: ${unknown.sort().join(", ")}`);
	}
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${field} is required`);
	}
	return value.trim();
}

function httpUrl(value: unknown, field: string): string {
	const normalized = requiredString(value, field).replace(/\/+$/u, "");
	let url: URL;
	try {
		url = new URL(normalized);
	} catch {
		throw new Error(`${field} must be an HTTP(S) URL`);
	}
	if (!(url.protocol === "http:" || url.protocol === "https:")) {
		throw new Error(`${field} must be an HTTP(S) URL`);
	}
	return normalized;
}

function positiveInteger(value: unknown, field: string): number {
	if (!Number.isInteger(value) || Number(value) <= 0) {
		throw new Error(`${field} must be a positive integer`);
	}
	return Number(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
