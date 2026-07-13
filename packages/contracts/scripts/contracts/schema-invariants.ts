import { isRecord, loadYaml, relativePath, repoPath } from "./common.ts";
import { materializeAlertFile } from "./materialize-observability-alerts.ts";

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
	if (entryId === "llm-io-fingerprint.v1") {
		validateObject(path, instance);
		validateLlmIoFingerprintInvariants(path, instance);
		return;
	}
	if (entryId === "answer-eval-fingerprint.v1") {
		validateObject(path, instance);
		rejectSafeProjectionRawKeys(path, instance, "answer_eval_fingerprint");
		return;
	}
	if (entryId === "truncation-summary.v1") {
		validateObject(path, instance);
		rejectSafeProjectionRawKeys(path, instance, "truncation_summary");
		return;
	}
	if (entryId === "sink-identity-projection.v1") {
		validateObject(path, instance);
		rejectSinkIdentityDirectIdentifiers(path, instance, "sink_identity_projection");
		return;
	}
	if (entryId === "runtime-observability-alerts.v1") {
		validateObservabilityAlertInvariants(path, instance);
		return;
	}
	if (entryId === "runtime-latency-budgets.v1") {
		validateLatencyBudgetInvariants(path, instance);
	}
}

function validateLlmIoFingerprintInvariants(
	path: string,
	fingerprint: Record<string, unknown>,
): void {
	const toolRuntime = fingerprint.tool_runtime_fingerprint;
	if (!isRecord(toolRuntime)) {
		throw new Error(
			`${relativePath(path)} llm_io_fingerprint.tool_runtime_fingerprint must be an object`,
		);
	}
	for (const [flatField, nestedField] of [
		["tool_catalog_sha256", "tools_sha256"],
		["tool_schema_sha256", "function_schema_sha256"],
		["workflow_artifact_sha256", "workflow_artifact_sha256"],
	]) {
		if (fingerprint[flatField] !== toolRuntime[nestedField]) {
			throw new Error(
				`${relativePath(path)} llm_io_fingerprint.${flatField} must match tool_runtime_fingerprint.${nestedField}`,
			);
		}
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

function validateObservabilityAlertInvariants(path: string, instance: unknown): void {
	validateObject(path, instance);
	const canonicalStageFields = canonicalStageTimingFields();
	const rules = instance.rules;
	if (!Array.isArray(rules)) {
		throw new Error(`${relativePath(path)} rules must be a list`);
	}
	const ruleIds = new Set<string>();
	const enabledKeys = new Set<string>();
	const expectedUnits: Record<string, string> = {
		stage_latency_p95: "ms",
		request_error_rate: "ratio",
		telemetry_export_failure: "count",
		missing_trace_rate: "ratio",
	};
	for (const [index, rule] of rules.entries()) {
		if (!isRecord(rule)) {
			throw new Error(`${relativePath(path)} rules[${index}] must be an object`);
		}
		const ruleId = rule.id;
		const signal = rule.signal;
		const stageField = rule.stage_field;
		const threshold = rule.threshold;
		if (typeof ruleId !== "string" || ruleId === "") {
			throw new Error(`${relativePath(path)} rules[${index}] must declare id`);
		}
		if (ruleIds.has(ruleId)) {
			throw new Error(`${relativePath(path)} duplicate alert rule id: ${ruleId}`);
		}
		ruleIds.add(ruleId);
		if (typeof signal !== "string" || !(signal in expectedUnits)) {
			throw new Error(`${relativePath(path)} rules[${index}] has unsupported signal`);
		}
		if (typeof rule.window !== "string") {
			throw new Error(`${relativePath(path)} rules[${index}] must declare window`);
		}
		if (!isRecord(threshold)) {
			throw new Error(`${relativePath(path)} rules[${index}] must declare threshold`);
		}
		if (signal === "stage_latency_p95") {
			if (typeof stageField !== "string" || !canonicalStageFields.has(stageField)) {
				throw new Error(`${relativePath(path)} rules[${index}] stage_field must be canonical`);
			}
		} else if (stageField !== undefined && stageField !== null) {
			throw new Error(
				`${relativePath(path)} rules[${index}] stage_field is only valid for stage_latency_p95`,
			);
		}
		if (threshold.unit !== expectedUnits[signal]) {
			throw new Error(
				`${relativePath(path)} rules[${index}] threshold unit must be ${expectedUnits[signal]} for ${signal}`,
			);
		}
		if (rule.enabled === true) {
			const key = `${signal}\0${typeof stageField === "string" ? stageField : ""}\0${rule.window}`;
			if (enabledKeys.has(key)) {
				throw new Error(`${relativePath(path)} duplicate enabled alert signal/window: ${key}`);
			}
			enabledKeys.add(key);
		}
	}
	const materialized = materializeAlertFile(path);
	if (materialized.monitors.length !== enabledKeys.size) {
		throw new Error(`${relativePath(path)} must materialize one monitor per enabled alert rule`);
	}
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

function rejectSinkIdentityDirectIdentifiers(path: string, value: unknown, context: string): void {
	rejectKeyFragments(
		path,
		value,
		["authorization", "cookie", "email", "jwt", "principal_id", "session", "token", "user_id"],
		"direct identity key is forbidden",
		context,
	);
}

function rejectKeyFragments(
	path: string,
	value: unknown,
	fragments: string[],
	message: string,
	context: string,
): void {
	if (isRecord(value)) {
		for (const [key, nested] of Object.entries(value)) {
			const nestedContext = context ? `${context}.${key}` : key;
			if (fragments.some((fragment) => key.toLowerCase().includes(fragment))) {
				throw new Error(`${relativePath(path)} ${message}: ${nestedContext}`);
			}
			rejectKeyFragments(path, nested, fragments, message, nestedContext);
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((nested, index) => {
			rejectKeyFragments(path, nested, fragments, message, `${context}[${index}]`);
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
