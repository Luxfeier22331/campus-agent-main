import { isRecord, loadYaml, relativePath, repoPath, sha256JsonRef } from "./common.ts";
import { materializeAlertFile } from "./materialize-observability-alerts.ts";

const toolExecutionOpenApiPath = repoPath("docs/contracts/schemas/tool-execution.openapi.yaml");

const rawCaptureFields = new Set([
	"rendered_messages",
	"provider_request_body",
	"provider_response_body",
	"provider_stream_deltas",
	"tool_calls",
	"tool_results",
	"selected_evidence_packet",
	"selected_memory_context",
	"output_schema",
]);

const forbiddenRawKeyFragments = new Set([
	"authorization",
	"auth_header",
	"api_key",
	"apikey",
	"cookie",
	"database_url",
	"db_url",
	"jwt",
	"object_store_secret",
	"password",
	"provider_key",
	"secret",
	"token",
]);

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
	if (entryId === "raw-capture-policy.v1") {
		validateRawCapturePolicyInvariants(path, instance);
		return;
	}
	if (entryId === "llm-replay-packet.v1") {
		validateLlmReplayPacketInvariants(path, instance);
		return;
	}
	if (entryId === "llm-replay-packet-index.v1") {
		validateLlmReplayPacketIndexInvariants(path, instance);
		return;
	}
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

function validateRawCapturePolicyInvariants(path: string, instance: unknown): void {
	validateObject(path, instance);
	const mode = instance.mode;
	const ttlDays = instance.ttl_days;
	const allowedSinks = instance.allowed_sinks;
	const allowedRawFields = instance.allowed_raw_fields;
	if (mode === "off") {
		if (ttlDays !== 0 || !isEmptyArray(allowedSinks) || !isEmptyArray(allowedRawFields)) {
			throw new Error(`${relativePath(path)} off raw capture policy must not admit capture`);
		}
		return;
	}
	if (!Number.isInteger(ttlDays) || Number(ttlDays) <= 0) {
		throw new Error(`${relativePath(path)} non-off raw capture policy requires ttl_days > 0`);
	}
	if (!Array.isArray(allowedSinks) || allowedSinks.length === 0) {
		throw new Error(`${relativePath(path)} non-off raw capture policy requires allowed_sinks`);
	}
	if (!Array.isArray(allowedRawFields) || allowedRawFields.length === 0) {
		throw new Error(`${relativePath(path)} non-off raw capture policy requires allowed_raw_fields`);
	}
	for (const rawField of allowedRawFields) {
		if (!rawCaptureFields.has(String(rawField))) {
			throw new Error(`${relativePath(path)} forbidden raw capture field: ${rawField}`);
		}
	}
	if (instance.audit_required !== true) {
		throw new Error(`${relativePath(path)} non-off raw capture policy requires audit`);
	}
	if (instance.dsar_delete_linkage_required !== true) {
		throw new Error(`${relativePath(path)} non-off raw capture policy requires deletion linkage`);
	}
	for (const field of ["request_id", "run_id", "trace_id"]) {
		if (typeof instance[field] !== "string" || instance[field].trim() === "") {
			throw new Error(`${relativePath(path)} non-off raw capture policy requires ${field}`);
		}
	}
}

function validateLlmReplayPacketInvariants(path: string, instance: unknown): void {
	validateObject(path, instance);
	const policy = instance.capture_policy;
	if (!isRecord(policy)) {
		throw new Error(`${relativePath(path)} capture_policy must be an object`);
	}
	validateRawCapturePolicyInvariants(path, policy);
	const allowedFields = policy.allowed_raw_fields;
	if (!Array.isArray(allowedFields)) {
		throw new Error(`${relativePath(path)} capture_policy.allowed_raw_fields must be a list`);
	}
	const allowed = new Set(allowedFields.map(String));
	for (const rawSection of rawCaptureFields) {
		if (rawSection in instance && !allowed.has(rawSection)) {
			throw new Error(`${relativePath(path)} raw section is not admitted by policy: ${rawSection}`);
		}
		if (rawSection in instance) {
			rejectForbiddenRawKeys(path, instance[rawSection], rawSection);
		}
	}
	for (const field of ["run_id", "request_id", "trace_id"]) {
		const fingerprint = instance.llm_io_fingerprint;
		if (isRecord(fingerprint) && instance[field] !== fingerprint[field]) {
			throw new Error(`${relativePath(path)} packet ${field} must match llm_io_fingerprint`);
		}
		if (policy.mode !== "off" && instance[field] !== policy[field]) {
			throw new Error(`${relativePath(path)} packet ${field} must match capture_policy`);
		}
	}
	if (isRecord(instance.llm_io_fingerprint)) {
		validateLlmIoFingerprintInvariants(path, instance.llm_io_fingerprint);
	}
	if (isRecord(instance.deletion_linkage)) {
		for (const field of ["request_id", "trace_id"]) {
			if (instance[field] !== instance.deletion_linkage[field]) {
				throw new Error(`${relativePath(path)} packet ${field} must match deletion_linkage`);
			}
		}
	}
}

function validateLlmReplayPacketIndexInvariants(path: string, instance: unknown): void {
	validateObject(path, instance);
	const policy = instance.capture_policy;
	if (!isRecord(policy)) {
		throw new Error(`${relativePath(path)} capture_policy must be an object`);
	}
	validateRawCapturePolicyInvariants(path, policy);
	const fingerprint = instance.llm_io_fingerprint;
	if (!isRecord(fingerprint)) {
		throw new Error(`${relativePath(path)} llm_io_fingerprint must be an object`);
	}
	for (const field of ["run_id", "request_id", "trace_id"]) {
		if (instance[field] !== fingerprint[field]) {
			throw new Error(`${relativePath(path)} index ${field} must match llm_io_fingerprint`);
		}
		if (policy.mode !== "off" && instance[field] !== policy[field]) {
			throw new Error(`${relativePath(path)} index ${field} must match capture_policy`);
		}
	}
	validateLlmIoFingerprintInvariants(path, fingerprint);
	if (isRecord(instance.answer_eval_fingerprint)) {
		validateAnswerEvalFingerprintInvariants(path, instance.answer_eval_fingerprint, fingerprint);
		if (isRecord(instance.evidence_replay_index)) {
			const expected = sha256JsonRef(instance.evidence_replay_index);
			if (instance.answer_eval_fingerprint.evidence_replay_index_sha256 !== expected) {
				throw new Error(
					`${relativePath(path)} answer_eval_fingerprint.evidence_replay_index_sha256 must match evidence_replay_index`,
				);
			}
		}
	}
	if (!isRecord(instance.deletion_linkage)) {
		throw new Error(`${relativePath(path)} deletion_linkage must be an object`);
	}
	for (const field of ["request_id", "trace_id"]) {
		if (instance[field] !== instance.deletion_linkage[field]) {
			throw new Error(`${relativePath(path)} index ${field} must match deletion_linkage`);
		}
	}
	rejectRawReplayIndexKeys(path, instance);
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

function validateAnswerEvalFingerprintInvariants(
	path: string,
	answerEval: Record<string, unknown>,
	fingerprint: Record<string, unknown>,
): void {
	rejectSafeProjectionRawKeys(path, answerEval, "answer_eval_fingerprint");
	for (const [answerField, fingerprintField] of [
		["run_id", "run_id"],
		["request_id", "request_id"],
		["trace_id", "trace_id"],
		["runtime_release", "runtime_release"],
		["llm_call_site", "llm_call_site"],
		["provider_profile_revision", "provider_profile_revision"],
		["output_schema_id", "output_schema_id"],
	]) {
		if (answerEval[answerField] !== fingerprint[fingerprintField]) {
			throw new Error(
				`${relativePath(path)} answer_eval_fingerprint.${answerField} must match llm_io_fingerprint.${fingerprintField}`,
			);
		}
	}
	const toolRuntime = fingerprint.tool_runtime_fingerprint;
	if (!isRecord(toolRuntime)) {
		throw new Error(
			`${relativePath(path)} llm_io_fingerprint.tool_runtime_fingerprint must be an object`,
		);
	}
	if (answerEval.tool_runtime_combined_sha256 !== toolRuntime.combined_sha256) {
		throw new Error(
			`${relativePath(path)} answer_eval_fingerprint.tool_runtime_combined_sha256 must match llm_io_fingerprint.tool_runtime_fingerprint.combined_sha256`,
		);
	}
	const branchIdentity = answerEval.branch_identity;
	if (!isRecord(branchIdentity)) {
		throw new Error(
			`${relativePath(path)} answer_eval_fingerprint.branch_identity must be an object`,
		);
	}
	if (branchIdentity.prompt_id !== fingerprint.prompt_id) {
		throw new Error(
			`${relativePath(path)} answer_eval_fingerprint.branch_identity.prompt_id must match llm_io_fingerprint.prompt_id`,
		);
	}
	if (answerEval.llm_io_fingerprint_sha256 !== sha256JsonRef(fingerprint)) {
		throw new Error(
			`${relativePath(path)} answer_eval_fingerprint.llm_io_fingerprint_sha256 must match llm_io_fingerprint`,
		);
	}
	const expectedHash = sha256JsonRef(
		Object.fromEntries(
			Object.entries(answerEval).filter(([key]) => key !== "answer_fingerprint_sha256"),
		),
	);
	if (answerEval.answer_fingerprint_sha256 !== expectedHash) {
		throw new Error(
			`${relativePath(path)} answer_eval_fingerprint.answer_fingerprint_sha256 must match answer_eval_fingerprint body`,
		);
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
		projection_outbox_stale: "count",
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

function rejectRawReplayIndexKeys(path: string, value: unknown, context = ""): void {
	const forbidden = [
		"raw_answer",
		"raw_prompt",
		"rendered_messages",
		"provider_request_body",
		"provider_response_body",
		"provider_stream_deltas",
		"selected_evidence_packet",
		"selected_memory_context",
		"tool_calls",
		"tool_results",
	];
	rejectKeyFragments(path, value, forbidden, "forbidden replay index key", context);
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

function rejectForbiddenRawKeys(path: string, value: unknown, context: string): void {
	rejectKeyFragments(
		path,
		value,
		[...forbiddenRawKeyFragments],
		"forbidden raw replay key in",
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

function isEmptyArray(value: unknown): boolean {
	return Array.isArray(value) && value.length === 0;
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
