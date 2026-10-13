import type {
	ExecutionControlOwnerDeletion,
	ExecutionControlRun,
	ExecutionControlRunCreateInput,
	ExecutionControlRunEventPage,
	ExecutionControlRunEventQuery,
	JsonRecord,
} from "./execution-control-runtime-types";
import { ExecutionControlTransportError } from "./execution-control-transport";

export function durableRunEventsPath(query: ExecutionControlRunEventQuery): string {
	const path = `/internal/execution/requests/${query.requestId}/events`;
	const params = new URLSearchParams();
	if (query.afterSequence !== undefined) {
		if (
			!(Number.isInteger(query.afterSequence) && Number.isFinite(query.afterSequence)) ||
			query.afterSequence < 0
		) {
			throw new ExecutionControlTransportError({
				code: "invalid_request",
				message: "afterSequence must be a non-negative integer.",
				retryable: false,
				status: 400,
			});
		}
		params.set("after_sequence", String(query.afterSequence));
	}
	if (query.afterAnswerIndex !== undefined) {
		if (!Number.isSafeInteger(query.afterAnswerIndex) || query.afterAnswerIndex < 0) {
			throw new ExecutionControlTransportError({
				code: "invalid_request",
				message: "afterAnswerIndex must be a non-negative integer.",
				retryable: false,
				status: 400,
			});
		}
		params.set("after_answer_index", String(query.afterAnswerIndex));
	}
	if (query.waitMs !== undefined) {
		if (!(Number.isInteger(query.waitMs) && Number.isFinite(query.waitMs)) || query.waitMs < 0) {
			throw new ExecutionControlTransportError({
				code: "invalid_request",
				message: "waitMs must be a non-negative integer.",
				retryable: false,
				status: 400,
			});
		}
		params.set("wait_ms", String(query.waitMs));
	}
	if (params.size === 0) {
		return path;
	}
	return `${path}?${params.toString()}`;
}

export function toDurableRunCreateBody(input: ExecutionControlRunCreateInput): JsonRecord {
	return {
		conversation_id: input.conversationId,
		metadata: input.metadata,
		owner_user_id: input.ownerUserId,
		personal_memory_recall_allowed: input.personalMemoryRecallAllowed,
		request_id: input.requestId,
		runtime_versions: input.runtimeVersions ?? {},
		surface: input.surface,
	};
}

export function parseDurableRun(payload: JsonRecord): ExecutionControlRun {
	return {
		admittedAt: readRequiredString(payload, "admitted_at"),
		completedAt: readRequiredString(payload, "completed_at"),
		conversationId: readRequiredString(payload, "conversation_id"),
		createdAt: readRequiredString(payload, "created_at"),
		failCloseReason: readRequiredString(payload, "fail_close_reason"),
		finalResponseRef: readRequiredString(payload, "final_response_ref"),
		ownerUserId: readRequiredString(payload, "owner_user_id"),
		queuedAt: readRequiredString(payload, "queued_at"),
		requestId: readRequiredString(payload, "request_id"),
		startedAt: readRequiredString(payload, "started_at"),
		status: readRequiredString(payload, "status"),
		streamingStartedAt: readRequiredString(payload, "streaming_started_at"),
		surface: readRequiredString(payload, "surface"),
		taskQueue: readRequiredString(payload, "task_queue"),
		terminalReason: readRequiredString(payload, "terminal_reason"),
		updatedAt: readRequiredString(payload, "updated_at"),
	};
}

export function parseOwnerDeletion(payload: JsonRecord): ExecutionControlOwnerDeletion {
	const state = readRequiredString(payload, "state");
	const activeRunCount = payload.active_run_count;
	if (
		(state !== "draining" && state !== "deleted") ||
		typeof activeRunCount !== "number" ||
		!Number.isInteger(activeRunCount) ||
		activeRunCount < 0
	) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Execution control returned an invalid owner deletion response.",
			retryable: true,
			status: 502,
		});
	}
	return {
		activeRunCount,
		ownerUserId: readRequiredString(payload, "owner_user_id"),
		state,
	};
}

export function parseDurableRunEvents(payload: JsonRecord): ExecutionControlRunEventPage {
	const events = payload.events;
	if (!Array.isArray(events)) {
		throw invalidDurableResponse("events must be an array.");
	}
	const nextSequence = readRequiredNumber(payload, "next_sequence");
	if (!Number.isInteger(nextSequence) || nextSequence < 0) {
		throw invalidDurableResponse("next_sequence must be a non-negative integer.");
	}
	return {
		...(payload.answer_deltas === undefined
			? {}
			: { answerDeltas: parseAnswerDeltas(payload.answer_deltas) }),
		events: events.map((event, index) => {
			if (!event || typeof event !== "object" || Array.isArray(event)) {
				throw invalidDurableResponse(`events[${index}] must be an object.`);
			}
			const record = event as JsonRecord;
			return {
				conversationId: readRequiredString(record, "conversation_id"),
				eventId: readRequiredString(record, "event_id"),
				eventType: readRequiredString(record, "event_type"),
				occurredAt: readRequiredString(record, "occurred_at"),
				payload: readRequiredRecord(record, "payload"),
				payloadSchemaVersion: readRequiredString(record, "payload_schema_version"),
				requestId: readRequiredString(record, "request_id"),
				sequence: readRequiredNumber(record, "sequence"),
				visibility: readRequiredString(record, "visibility"),
			};
		}),
		nextSequence,
	};
}

function readRequiredString(payload: JsonRecord, key: string): string {
	const value = payload[key];
	if (typeof value !== "string") {
		throw invalidDurableResponse(`${key} must be a string.`);
	}
	return value;
}

function readRequiredNumber(payload: JsonRecord, key: string): number {
	const value = payload[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw invalidDurableResponse(`${key} must be a finite number.`);
	}
	return value;
}

function readRequiredRecord(payload: JsonRecord, key: string): JsonRecord {
	const value = payload[key];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalidDurableResponse(`${key} must be an object.`);
	}
	return value as JsonRecord;
}

function invalidDurableResponse(detail: string): ExecutionControlTransportError {
	return new ExecutionControlTransportError({
		code: "execution_control_invalid_response",
		message: `Execution control runtime response violates the contract: ${detail}`,
		retryable: true,
		status: 502,
	});
}

function parseAnswerDeltas(value: unknown) {
	if (!Array.isArray(value)) {
		throw invalidDurableResponse("answer_deltas must be an array.");
	}
	let previous = 0;
	return value.map((item: unknown) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw invalidDurableResponse("Invalid answer delta.");
		}
		const record = item as JsonRecord;
		const index = readRequiredNumber(record, "index");
		if (!Number.isSafeInteger(index) || index <= previous) {
			throw invalidDurableResponse("Answer indices must increase.");
		}
		previous = index;
		const delta = readRequiredString(record, "delta");
		if (!delta) {
			throw invalidDurableResponse("Answer delta must not be empty.");
		}
		return {
			index,
			delta,
			requestId: readRequiredString(record, "request_id"),
			messageId: readRequiredString(record, "message_id"),
			occurredAt: readRequiredString(record, "occurred_at"),
		};
	});
}
