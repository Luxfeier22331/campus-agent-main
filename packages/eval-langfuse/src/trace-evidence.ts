import { LangfuseClient } from "@langfuse/client";

import { type JsonObject, optionalString, stringField } from "./json";
import type { LangfuseSettings } from "./settings";

const REQUIRED_TRACE_IDENTITY_ATTRIBUTES = ["request_id", "run_id", "trace_id", "turn_id"];
export async function verifyLangfuseOnlineTraceEvidence(input: {
	expectedRelease: string;
	expectedRequestId?: string | null;
	expectedRunId?: string | null;
	expectedSessionId: string;
	expectedTags: string[];
	expectedUserId: string;
	client?: LangfuseClient;
	settings: LangfuseSettings;
	traceId: string;
}): Promise<JsonObject> {
	const traceId = stringField(input.traceId, "trace_id");
	const client =
		input.client ??
		new LangfuseClient({
			baseUrl: input.settings.baseUrl,
			publicKey: input.settings.publicKey,
			secretKey: input.settings.secretKey,
			...(input.settings.timeoutSeconds === undefined
				? {}
				: { timeout: input.settings.timeoutSeconds }),
		});
	const trace = (await client.api.trace.get(traceId, {
		fields: "core,observations",
	})) as unknown as JsonObject;
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
	const traceIdentity = assertTraceIdentityContract(trace, observations);
	assertExpectedTraceIdentity(traceIdentity, {
		request_id: input.expectedRequestId,
		run_id: input.expectedRunId,
	});
	return {
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
