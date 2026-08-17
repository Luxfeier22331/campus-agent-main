import { type JsonObject, mapping, optionalString, stringField } from "./json";
import { createLangfuseEvalClient, type LangfuseEvalClient } from "./langfuse-client";
import type { LangfuseSettings } from "./settings";

const REQUIRED_TRACE_IDENTITY_ATTRIBUTES = ["request_id", "run_id", "trace_id", "turn_id"];
const TRACE_FORBIDDEN_FIELDS = new Set([
	"access_token",
	"api_key",
	"authorization",
	"client_secret",
	"cookie",
	"cookies",
	"database_url",
	"jwt",
	"object_store_secret",
	"password",
	"refresh_token",
	"raw_answer",
	"raw_prompt",
	"provider_raw_response",
	"secret_key",
	"input_value",
	"output_value",
	"llm_input_messages",
	"llm_output_messages",
	"openinference_message_content",
	"tool_arguments",
	"tool_result",
]);

export async function verifyLangfuseOnlineTraceEvidence(input: {
	expectedRelease: string;
	expectedRequestId?: string | null;
	expectedRunId?: string | null;
	expectedSessionId: string;
	expectedTags: string[];
	expectedUserId: string;
	fetchImpl?: typeof fetch;
	settings: LangfuseSettings;
	traceId: string;
}): Promise<JsonObject> {
	const traceId = stringField(input.traceId, "trace_id");
	const langfuse: LangfuseEvalClient = createLangfuseEvalClient({
		...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
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
	});
	return {
		forbidden_check_passed: true,
		observation_count: observations.length,
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
		if (collected?.size !== 1) {
			throw new Error(`trace evidence must include exactly one ${key}`);
		}
		identity[key] = [...collected][0];
	}
	return identity;
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
	collectForbidden(trace, forbidden, TRACE_FORBIDDEN_FIELDS);
	for (const observation of observations) {
		collectForbidden(observation, forbidden, TRACE_FORBIDDEN_FIELDS);
	}
	if (forbidden.size > 0) {
		throw new Error(`forbidden Langfuse payload fields: ${[...forbidden].sort().join(", ")}`);
	}
}

function collectForbidden(value: unknown, result: Set<string>, forbiddenFields: Set<string>): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectForbidden(item, result, forbiddenFields);
		}
		return;
	}
	if (!value || typeof value !== "object") {
		return;
	}
	for (const [key, child] of Object.entries(mapping(value, "payload"))) {
		if (forbiddenFields.has(normalizedPayloadKey(key))) {
			result.add(key);
		}
		collectForbidden(child, result, forbiddenFields);
	}
}

function normalizedPayloadKey(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
		.replace(/[.\s-]+/gu, "_")
		.toLowerCase();
}
