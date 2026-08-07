import { isRecord, loadYaml, relativePath, repoPath } from "./common.ts";

const toolExecutionOpenApiPath = repoPath("docs/contracts/schemas/tool-execution.openapi.yaml");

const safeProjectionForbiddenFragments = new Set([
	"authorization",
	"auth_header",
	"cookie",
	"email",
	"jwt",
	"memory_raw",
	"memory_text",
	"password",
	"provider_request_body",
	"provider_response_body",
	"provider_stream_deltas",
	"raw_answer",
	"raw_",
	"raw_memory",
	"raw_prompt",
	"raw_response",
	"raw_text",
	"raw_transcript",
	"rendered_messages",
	"secret",
	"selected_evidence_packet",
	"selected_memory_context",
	"tool_calls",
	"tool_results",
	"user_id",
]);

const safeProjectionForbiddenExactKeys = new Set([
	"access_token",
	"auth_token",
	"id_token",
	"refresh_token",
	"session_token",
	"token",
]);

export function validateJsonArtifactInvariants(
	entryId: string,
	path: string,
	instance: unknown,
): void {
	if (entryId === "truncation-summary.v2") {
		validateObject(path, instance);
		rejectSafeProjectionRawKeys(path, instance, "truncation_summary");
		return;
	}
	if (entryId === "runtime-latency-budgets.v1") {
		validateLatencyBudgetInvariants(path, instance);
	}
}

function validateLatencyBudgetInvariants(path: string, instance: unknown): void {
	validateObject(path, instance);
	const canonicalStageFields = canonicalStageTimingFields();
	const rules = instance.rules;
	if (!Array.isArray(rules)) {
		throw new Error(`${relativePath(path)} rules must be a list`);
	}
	const enabledFields = new Set<string>();
	const reasons = new Set<string>();
	for (const [index, rule] of rules.entries()) {
		if (!isRecord(rule)) {
			throw new Error(`${relativePath(path)} rules[${index}] must be an object`);
		}
		const field = rule.field;
		const reason = rule.candidate_reason;
		if (typeof field !== "string" || typeof reason !== "string") {
			throw new Error(
				`${relativePath(path)} rules[${index}] must declare field and candidate_reason`,
			);
		}
		if (!canonicalStageFields.has(field)) {
			throw new Error(`${relativePath(path)} rules[${index}] field is not canonical: ${field}`);
		}
		if (!(Number.isInteger(rule.warn_ms) && Number.isInteger(rule.critical_ms))) {
			throw new Error(`${relativePath(path)} rules[${index}] thresholds must be integers`);
		}
		if (Number(rule.critical_ms) <= Number(rule.warn_ms)) {
			throw new Error(
				`${relativePath(path)} rules[${index}] critical_ms must be greater than warn_ms`,
			);
		}
		if (reasons.has(reason)) {
			throw new Error(`${relativePath(path)} duplicate candidate_reason: ${reason}`);
		}
		reasons.add(reason);
		if (rule.enabled === true) {
			if (enabledFields.has(field)) {
				throw new Error(`${relativePath(path)} duplicate enabled latency budget field: ${field}`);
			}
			enabledFields.add(field);
		}
	}
	assertSetEquals(
		path,
		enabledFields,
		canonicalStageFields,
		"enabled latency budget fields must exactly cover canonical stage_timing fields",
	);
}

function canonicalStageTimingFields(): Set<string> {
	const doc = loadYaml(toolExecutionOpenApiPath);
	if (!(isRecord(doc) && isRecord(doc.components) && isRecord(doc.components.schemas))) {
		throw new Error(`${relativePath(toolExecutionOpenApiPath)} must declare components.schemas`);
	}
	const stageTiming = doc.components.schemas.StageTiming;
	if (!(isRecord(stageTiming) && isRecord(stageTiming.properties))) {
		throw new Error(
			`${relativePath(toolExecutionOpenApiPath)} StageTiming must declare properties`,
		);
	}
	return new Set(Object.keys(stageTiming.properties));
}

function rejectSafeProjectionRawKeys(path: string, value: unknown, context: string): void {
	if (isRecord(value)) {
		for (const [key, nested] of Object.entries(value)) {
			const normalized = key.toLowerCase();
			if (
				safeProjectionForbiddenExactKeys.has(normalized) ||
				[...safeProjectionForbiddenFragments].some((fragment) => normalized.includes(fragment))
			) {
				throw new Error(`${relativePath(path)} forbidden safe projection key: ${context}.${key}`);
			}
			rejectSafeProjectionRawKeys(path, nested, `${context}.${key}`);
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((nested, index) => {
			rejectSafeProjectionRawKeys(path, nested, `${context}[${index}]`);
		});
	}
}

function validateObject(
	path: string,
	instance: unknown,
): asserts instance is Record<string, unknown> {
	if (!isRecord(instance)) {
		throw new Error(`${relativePath(path)} must contain an object`);
	}
}

function assertSetEquals(
	path: string,
	actual: Set<string>,
	expected: Set<string>,
	message: string,
): void {
	const missing = [...expected].filter((item) => !actual.has(item)).sort();
	const extra = [...actual].filter((item) => !expected.has(item)).sort();
	if (missing.length > 0 || extra.length > 0) {
		throw new Error(
			`${relativePath(path)} ${message}; missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`,
		);
	}
}
