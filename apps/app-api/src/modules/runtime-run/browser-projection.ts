import type { ExecutionControlRunEvent, ExecutionControlRunStepTrajectory } from "../integration";
import type {
	RuntimeRunEventProjection,
	RuntimeRunProductEventName,
	RuntimeRunProductPhase,
} from "./types";

const STUDENT_FORBIDDEN_MEMORY_REF_KEYS = new Set([
	"bank_id",
	"bankId",
	"operation_id",
	"operationId",
	"operation_ref",
	"operationRef",
	"operation_status_ref",
	"operationStatusRef",
	"result_metadata_shape",
	"resultMetadataShape",
	"runtime_document_ref",
	"runtimeDocumentRef",
]);

const STUDENT_FORBIDDEN_MEMORY_REF_TOKENS = [
	"hindsight_bank_",
	"memory/documents",
	"memory/operations",
] as const;

function isHindsightMemoryDocumentID(value: string): boolean {
	return /^conversation:[a-f0-9]{32}$/i.test(value) || /^profile:[A-Za-z0-9_-]{3,128}$/.test(value);
}

export function sanitizeStudentRunStepTrajectory(
	trajectory: ExecutionControlRunStepTrajectory,
): ExecutionControlRunStepTrajectory {
	return sanitizeStudentRuntimeValue(trajectory) as ExecutionControlRunStepTrajectory;
}

function getStringPayloadField(payload: Record<string, unknown>, key: string): string | undefined {
	const value = payload[key];
	return typeof value === "string" ? value : undefined;
}

function getNumberPayloadField(payload: Record<string, unknown>, key: string): number | undefined {
	const value = payload[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getBooleanPayloadField(
	payload: Record<string, unknown>,
	key: string,
): boolean | undefined {
	const value = payload[key];
	return typeof value === "boolean" ? value : undefined;
}

function getRecordPayloadField(
	payload: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	const value = payload[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function pickStringPayloadFields(
	payload: Record<string, unknown>,
	keys: string[],
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const value = getStringPayloadField(payload, key);
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

function sanitizeBrowserRunEventPayload(event: ExecutionControlRunEvent): Record<string, unknown> {
	const payload = event.payload;
	switch (event.eventType) {
		case "execution.queued":
		case "execution.running":
		case "run.queued":
		case "run.started":
		case "run.running":
			return pickStringPayloadFields(payload, ["request_id", "status", "trace_id"]);
		case "run.answer_started":
			return pickStringPayloadFields(payload, ["request_id", "trace_id"]);
		case "run.progress":
			return pickStringPayloadFields(payload, ["phase", "request_id", "trace_id"]);
		case "run.answer_delta": {
			const result = pickStringPayloadFields(payload, [
				"delta",
				"message_id",
				"request_id",
				"trace_id",
			]);
			const chunkIndex = getNumberPayloadField(payload, "chunk_index");
			if (chunkIndex !== undefined) {
				result.chunk_index = chunkIndex;
			}
			return result;
		}
		case "run.answer_completed":
			return pickStringPayloadFields(payload, ["request_id", "trace_id"]);
		case "finalization.completed":
			return pickStringPayloadFields(payload, ["request_id", "trace_id"]);
		case "run.completed":
			return pickStringPayloadFields(payload, [
				"request_id",
				"status",
				"terminal_reason",
				"trace_id",
			]);
		case "run.canceled":
			return pickStringPayloadFields(payload, [
				"request_id",
				"status",
				"terminal_reason",
				"trace_id",
			]);
		case "run.failed":
		case "run.expired": {
			const result = pickStringPayloadFields(payload, [
				"failure_kind",
				"request_id",
				"status",
				"terminal_reason",
				"trace_id",
			]);
			const error = getRecordPayloadField(payload, "error");
			if (error) {
				const errorProjection = pickStringPayloadFields(error, ["code", "message"]);
				const retryable = getBooleanPayloadField(error, "retryable");
				if (retryable !== undefined) {
					errorProjection.retryable = retryable;
				}
				result.error = errorProjection;
			}
			return result;
		}
		default:
			return {};
	}
}

function sanitizeStudentRuntimeValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value
			.map((item) => sanitizeStudentRuntimeValue(item))
			.filter((item) => item !== undefined);
	}
	if (value && typeof value === "object") {
		const sanitized: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(value)) {
			if (STUDENT_FORBIDDEN_MEMORY_REF_KEYS.has(key)) {
				continue;
			}
			const nextValue = sanitizeStudentRuntimeValue(nested);
			if (nextValue !== undefined) {
				sanitized[key] = nextValue;
			}
		}
		return sanitized;
	}
	if (
		typeof value === "string" &&
		(STUDENT_FORBIDDEN_MEMORY_REF_TOKENS.some((token) => value.includes(token)) ||
			isHindsightMemoryDocumentID(value))
	) {
		return;
	}
	return value;
}

export function toBrowserRunEvent(
	event: ExecutionControlRunEvent,
): RuntimeRunEventProjection | null {
	if (event.visibility !== "browser") {
		return null;
	}
	const productEventType = toRuntimeRunProductEventType(event.eventType);
	if (!productEventType) {
		return null;
	}
	const payload = sanitizeBrowserRunEventPayload(event);
	if (productEventType === "execution.phase") {
		const phase =
			event.eventType === "run.progress"
				? payload.phase
				: event.eventType === "run.answer_completed"
					? "finalizing"
					: "generating";
		if (!isRuntimeRunProductPhase(phase)) {
			return null;
		}
		return {
			eventId: event.eventId,
			eventType: productEventType,
			occurredAt: event.occurredAt,
			payload: {
				phase,
				...pickStringPayloadFields(payload, ["request_id", "trace_id"]),
			},
			runId: event.runId,
			sequence: event.sequence,
			visibility: event.visibility,
		};
	}
	return {
		eventId: event.eventId,
		eventType: productEventType,
		occurredAt: event.occurredAt,
		payload,
		runId: event.runId,
		sequence: event.sequence,
		visibility: event.visibility,
	};
}

function toRuntimeRunProductEventType(eventType: string): RuntimeRunProductEventName | null {
	switch (eventType) {
		case "execution.queued":
		case "run.queued":
			return "execution.queued";
		case "execution.running":
		case "run.running":
		case "run.started":
			return "execution.running";
		case "run.progress":
		case "run.answer_started":
		case "run.answer_completed":
			return "execution.phase";
		case "run.answer_delta":
			return "answer.delta";
		case "finalization.completed":
			return "request.completed";
		case "run.canceled":
			return "request.cancelled";
		case "run.failed":
		case "run.expired":
			return "request.failed";
		default:
			return null;
	}
}

function isRuntimeRunProductPhase(value: unknown): value is RuntimeRunProductPhase {
	return (
		value === "finalizing" ||
		value === "generating" ||
		value === "preparing" ||
		value === "retrieving"
	);
}
