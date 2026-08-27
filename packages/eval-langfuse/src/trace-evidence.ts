import { LangfuseClient } from "@langfuse/client";

import { isRecord, type JsonObject, optionalString, stringField } from "./json";
import type { LangfuseSettings } from "./settings";

export async function verifyLangfuseOnlineTraceEvidence(input: {
	expectedRequestId: string;
	client?: LangfuseClient;
	settings: LangfuseSettings;
	traceId: string;
}): Promise<JsonObject> {
	const traceId = stringField(input.traceId, "trace_id");
	const expectedRequestId = stringField(input.expectedRequestId, "request_id");
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
	if (String(trace.id ?? "") !== traceId) {
		throw new Error(`trace.id must be ${traceId}`);
	}
	const observations = Array.isArray(trace.observations) ? trace.observations : [];
	const requestIds = new Set(
		[trace, ...observations]
			.map(requestIdFromMetadata)
			.filter((value): value is string => value !== null),
	);
	if (requestIds.size !== 1 || !requestIds.has(expectedRequestId)) {
		throw new Error("trace metadata request_id does not match the expected request");
	}
	return {
		observation_count: observations.length,
		request_id: expectedRequestId,
		trace_id: traceId,
	};
}

function requestIdFromMetadata(value: unknown): string | null {
	if (!isRecord(value)) {
		return null;
	}
	const metadata = isRecord(value.metadata) ? value.metadata : {};
	const metadataAttributes = isRecord(metadata.attributes) ? metadata.attributes : {};
	return optionalString(metadata.request_id) ?? optionalString(metadataAttributes.request_id);
}
