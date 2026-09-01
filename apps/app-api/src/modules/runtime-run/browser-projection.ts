import type { ExecutionControlRunEvent } from "../integration";
import type {
	RuntimeRunEventProjection,
	RuntimeRunProductEventName,
	RuntimeRunProductPhase,
} from "./types";

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
			return pickStringPayloadFields(payload, ["status"]);
		case "run.answer_started":
			return {};
		case "run.progress":
			return pickStringPayloadFields(payload, ["phase"]);
		case "run.answer_delta": {
			const result = pickStringPayloadFields(payload, ["delta", "message_id"]);
			const chunkIndex = getNumberPayloadField(payload, "chunk_index");
			if (chunkIndex !== undefined) {
				result.chunk_index = chunkIndex;
			}
			return result;
		}
		case "run.answer_completed":
			return {};
		case "finalization.completed":
			return {};
		case "run.completed":
			return pickStringPayloadFields(payload, ["status", "terminal_reason"]);
		case "run.canceled":
			return pickStringPayloadFields(payload, ["status", "terminal_reason"]);
		case "run.failed":
		case "run.expired": {
			const result = pickStringPayloadFields(payload, [
				"failure_kind",
				"status",
				"terminal_reason",
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
		const phase = event.eventType === "run.progress" ? payload.phase : "generating";
		if (!isRuntimeRunProductPhase(phase)) {
			return null;
		}
		return {
			eventType: productEventType,
			occurredAt: event.occurredAt,
			payload: { phase },
			requestId: event.requestId,
			sequence: event.sequence,
		};
	}
	return {
		eventType: productEventType,
		occurredAt: event.occurredAt,
		payload,
		requestId: event.requestId,
		sequence: event.sequence,
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
			return "execution.phase";
		case "run.answer_completed":
			return null;
		case "run.answer_delta":
			return "answer.delta";
		case "finalization.completed":
		case "run.completed":
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
	return value === "finalizing" || value === "generating" || value === "preparing";
}
