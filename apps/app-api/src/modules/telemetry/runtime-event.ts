const FORBIDDEN_FIELD_NAMES = new Set([
	"answer",
	"auth_header",
	"authorization",
	"canonical.body",
	"chunk.body",
	"cookie",
	"jwt",
	"memory",
	"memory_text",
	"ocr.raw_text",
	"operator_email",
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
	"error_code",
	"event_type",
	"occurred_at",
	"principal_type",
	"release",
	"request_id",
	"requested_tool",
	"selected_tool",
	"status",
	"surface",
	"trace_id",
] as const;

const RUNTIME_EVENT_ALLOWED_FIELDS_BY_EVENT_TYPE = new Map<string, ReadonlySet<string>>([
	[
		"request.accepted",
		new Set([
			...RUNTIME_EVENT_BASE_ALLOWED_FIELDS,
			"actor_id_hash",
			"conversation_id",
			"safety_identifier",
		]),
	],
	[
		"request.finalized",
		new Set([
			...RUNTIME_EVENT_BASE_ALLOWED_FIELDS,
			"conversation_id",
			"duration_ms",
			"resolved_targets_count",
			"resolved_targets_summary",
			"retryable",
			"safety_identifier",
			"source_doc_ids_count",
			"source_doc_ids_summary",
		]),
	],
	[
		"request.stage_timing",
		new Set([...RUNTIME_EVENT_BASE_ALLOWED_FIELDS, "budget_state", "duration_ms", "stage_field"]),
	],
	[
		"request.transport_error",
		new Set([
			...RUNTIME_EVENT_BASE_ALLOWED_FIELDS,
			"conversation_id",
			"retryable",
			"safety_identifier",
		]),
	],
	[
		"identity.endpoint",
		new Set([...RUNTIME_EVENT_BASE_ALLOWED_FIELDS, "correlation_id", "endpoint"]),
	],
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
		if (
			value === null ||
			typeof value === "boolean" ||
			typeof value === "number" ||
			typeof value === "string"
		) {
			sanitized[key] = value;
		}
	}
	return sanitized;
}
