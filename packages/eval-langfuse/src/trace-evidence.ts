import { createLangfuseEvalClient, type LangfuseEvalClient } from "./langfuse-client";
import {
	type JsonObject,
	type LangfuseSettings,
	mapping,
	optionalString,
	stringField,
} from "./shared";

const REQUIRED_TRACE_IDENTITY_ATTRIBUTES = ["request_id", "run_id", "workflow_id", "trace_id"];
const REQUIRED_OBSERVATION_ATTRIBUTES = [
	"activity_attempt",
	"activity_type",
	"duration_ms",
	"fail_close_reason",
	"projection_ref",
	"schedule_to_start_ms",
	"selected_tool",
	"status",
	"step_id",
	"step_kind",
	"task_queue",
];
const FORBIDDEN_PAYLOAD_FIELDS = new Set([
	"api_key",
	"authorization",
	"cookie",
	"cookies",
	"database_url",
	"jwt",
	"object_store_secret",
	"provider_raw_response",
	"raw_answer",
	"raw_prompt",
	"raw_retrieved_snippet",
	"raw_transcript",
	"retrieved_snippet",
	"source_body_text",
]);

export async function verifyLangfuseOnlineTraceEvidence(input: {
	expectedRelease: string;
	expectedRequestId?: string | null;
	expectedRunId?: string | null;
	expectedSessionId: string;
	expectedTags: string[];
	expectedUserId: string;
	expectedWorkflowId?: string | null;
	fetchImpl?: typeof fetch;
	settings: LangfuseSettings;
	traceId: string;
}): Promise<JsonObject> {
	const traceId = stringField(input.traceId, "trace_id");
	const langfuse: LangfuseEvalClient = createLangfuseEvalClient({
		fetchImpl: input.fetchImpl,
		settings: input.settings,
	});
	const trace = await langfuse.getTrace(traceId, { fields: "core,observations" });
	assertTraceField(trace, "id", traceId);
	assertTraceField(trace, "name", "online-answer");
	assertTraceField(trace, "sessionId", input.expectedSessionId);
	assertTraceField(trace, "userId", input.expectedUserId);
	assertTraceField(trace, "release", input.expectedRelease);
	const tags = Array.isArray(trace.tags) ? trace.tags.map(String) : [];
	const missingTags = input.expectedTags.filter((tag) => !tags.includes(tag));
	if (missingTags.length > 0) {
		throw new Error(`trace evidence missing tags: ${missingTags.join(", ")}`);
	}
	const observations = Array.isArray(trace.observations) ? trace.observations : [];
	if (observations.length === 0) {
		throw new Error("trace evidence missing observations");
	}
	assertForbiddenPayloadFieldsAbsent(trace, observations);
	const traceIdentity = assertTraceIdentityContract(trace, observations);
	assertExpectedTraceIdentity(traceIdentity, {
		request_id: input.expectedRequestId,
		run_id: input.expectedRunId,
		workflow_id: input.expectedWorkflowId,
	});
	const repoOwnedObservations = assertObservationAttributeContract(observations);
	return {
		contract_checked_observation_count: repoOwnedObservations.length,
		non_repo_observation_count: observations.length - repoOwnedObservations.length,
		observation_count: observations.length,
		repo_owned_observation_count: repoOwnedObservations.length,
		release: input.expectedRelease,
		session_id: input.expectedSessionId,
		tags,
		trace_id: traceId,
		trace_identity: traceIdentity,
		user_id: input.expectedUserId,
	};
}

function assertTraceField(trace: JsonObject, field: string, expected: string): void {
	if (String(trace[field] ?? "") !== expected) {
		throw new Error(`trace.${field} must be ${expected}`);
	}
}

function assertTraceIdentityContract(trace: JsonObject, observations: unknown[]): JsonObject {
	const values: Record<string, Set<string>> = Object.fromEntries(
		REQUIRED_TRACE_IDENTITY_ATTRIBUTES.map((key) => [key, new Set<string>()]),
	);
	for (const source of [trace, ...observations]) {
		const attributes = observationAttributes(source);
		for (const key of REQUIRED_TRACE_IDENTITY_ATTRIBUTES) {
			const value = optionalString(attributes[key]);
			if (value) {
				values[key]?.add(value);
			}
		}
	}
	const identity: JsonObject = {};
	for (const key of REQUIRED_TRACE_IDENTITY_ATTRIBUTES) {
		const collected = values[key];
		if (!collected || collected.size !== 1) {
			throw new Error(`trace evidence must include exactly one ${key}`);
		}
		identity[key] = [...collected][0];
	}
	return identity;
}

function assertObservationAttributeContract(observations: unknown[]): unknown[] {
	const repoOwned = observations.filter((observation) => isRepoOwnedObservation(observation));
	if (repoOwned.length === 0) {
		throw new Error("trace evidence missing repo-owned observations");
	}
	for (const observation of repoOwned) {
		const attributes = observationAttributes(observation);
		const missing = REQUIRED_OBSERVATION_ATTRIBUTES.filter(
			(key) => !(key in attributes) || attributes[key] === null || attributes[key] === undefined,
		);
		if (missing.length > 0) {
			throw new Error(`repo-owned observation missing attributes: ${missing.join(", ")}`);
		}
	}
	return repoOwned;
}

function isRepoOwnedObservation(observation: unknown): boolean {
	const attributes = observationAttributes(observation);
	return Boolean(attributes.step_id || attributes.activity_type || attributes.task_queue);
}

function observationAttributes(value: unknown): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	const record = value as JsonObject;
	return {
		...nestedAttributes(record),
		...(record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
			? nestedAttributes(record.metadata as JsonObject)
			: {}),
	};
}

function nestedAttributes(value: JsonObject): JsonObject {
	const attributes = value.attributes;
	if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
		return { ...value, ...(attributes as JsonObject) };
	}
	return value;
}

function assertExpectedTraceIdentity(
	identity: JsonObject,
	expected: Record<string, unknown>,
): void {
	for (const [key, value] of Object.entries(expected)) {
		const normalized = optionalString(value);
		if (normalized && identity[key] !== normalized) {
			throw new Error(`trace evidence ${key} mismatch`);
		}
	}
}

function assertForbiddenPayloadFieldsAbsent(trace: JsonObject, observations: unknown[]): void {
	const forbidden = new Set<string>();
	collectForbidden(trace, forbidden);
	for (const observation of observations) {
		collectForbidden(observation, forbidden);
	}
	if (forbidden.size > 0) {
		throw new Error(`forbidden Langfuse payload fields: ${[...forbidden].sort().join(", ")}`);
	}
}

function collectForbidden(value: unknown, result: Set<string>): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectForbidden(item, result);
		}
		return;
	}
	if (!value || typeof value !== "object") {
		return;
	}
	for (const [key, child] of Object.entries(mapping(value, "payload"))) {
		if (FORBIDDEN_PAYLOAD_FIELDS.has(key.toLowerCase())) {
			result.add(key);
		}
		collectForbidden(child, result);
	}
}
