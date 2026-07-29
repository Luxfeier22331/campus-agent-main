import { STAGE_TIMING_FIELDS } from "../integration/execution-finalization-contract";

const FORBIDDEN_FIELD_NAMES = new Set([
	"answer",
	"auth_header",
	"authorization",
	"canonical.body",
	"chunk.body",
	"cookie",
	"email",
	"jwt",
	"memory",
	"memory_text",
	"ocr.raw_text",
	"prompt",
	"provider_raw_response",
	"raw_answer",
	"raw_chat_transcript",
	"raw_jwt",
	"raw_prompt",
	"raw_query",
	"raw_retrieved_snippet",
	"retrieved_snippet",
	"source_body",
	"standalone_query",
	"transcript",
]);

const RUNTIME_EVENT_BASE_ALLOWED_FIELDS = [
	"environment",
	"campus.request_id",
	"campus.trace_id",
	"error_code",
	"event_type",
	"occurred_at",
	"principal_type",
	"release",
	"status",
	"surface",
] as const;

const MAX_RUNTIME_EVENT_STRING_LENGTH = 128;
const MAX_RUNTIME_EVENT_STRING_LENGTH_BY_FIELD = new Map<string, number>([
	["error_code", 64],
	["event_type", 64],
	["principal_type", 64],
	["status", 64],
	["surface", 64],
]);

const RUNTIME_EVENT_ALLOWED_FIELDS_BY_EVENT_TYPE = new Map<string, ReadonlySet<string>>([
	["request.accepted", new Set(RUNTIME_EVENT_BASE_ALLOWED_FIELDS)],
	[
		"request.finalized",
		new Set([
			...RUNTIME_EVENT_BASE_ALLOWED_FIELDS,
			"cached_input_tokens",
			"duration_ms",
			"input_tokens",
			"output_tokens",
			"retryable",
			"source_doc_ids_count",
			"stage_timing_budget_state",
			"total_tokens",
			...STAGE_TIMING_FIELDS,
		]),
	],
	["request.transport_error", new Set([...RUNTIME_EVENT_BASE_ALLOWED_FIELDS, "retryable"])],
]);

export const RUNTIME_EVENT_ALLOWED_EVENT_TYPES = Array.from(
	RUNTIME_EVENT_ALLOWED_FIELDS_BY_EVENT_TYPE.keys(),
);

export type RuntimeEventScalar = boolean | number | string | null;

export interface RuntimeEventSink {
	emit(payload: Record<string, unknown>): Promise<void>;
}

export function sanitizeRuntimeEventPayload(
	payload: Record<string, unknown>,
): Record<string, RuntimeEventScalar> | null {
	const eventType = typeof payload.event_type === "string" ? payload.event_type : "";
	const allowedFields = RUNTIME_EVENT_ALLOWED_FIELDS_BY_EVENT_TYPE.get(eventType);
	if (!allowedFields) {
		return null;
	}

	const sanitized: Record<string, RuntimeEventScalar> = {};
	for (const [key, value] of Object.entries(payload)) {
		if (!allowedFields.has(key) || FORBIDDEN_FIELD_NAMES.has(key) || value === undefined) {
			continue;
		}
		if (value === null || typeof value === "boolean") {
			sanitized[key] = value;
			continue;
		}
		if (typeof value === "number" && Number.isFinite(value)) {
			sanitized[key] = value;
			continue;
		}
		if (typeof value === "string") {
			sanitized[key] = value.slice(
				0,
				MAX_RUNTIME_EVENT_STRING_LENGTH_BY_FIELD.get(key) ?? MAX_RUNTIME_EVENT_STRING_LENGTH,
			);
		}
	}
	return sanitized;
}
