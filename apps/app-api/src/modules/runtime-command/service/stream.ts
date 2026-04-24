import {
	parseSupervisorExecutionResponsePayload,
	type SupervisorExecutionResponse,
} from "../../integration";
import type {
	ChatCommandResponse,
	ChatCommandStreamEvent,
	ChatCommandStreamEventName,
} from "./types";

interface ParsedSseEvent {
	data: unknown;
	event: string;
}

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function getString(
	record: Record<string, unknown>,
	snakeKey: string,
	camelKey: string,
): string | null {
	const value = snakeKey in record ? record[snakeKey] : record[camelKey];
	return typeof value === "string" && value.trim() ? value : null;
}

function getError(value: unknown): { code: string; message: string; retryable?: boolean } {
	const record = getRecord(value);
	return {
		code:
			typeof record?.code === "string" && record.code.trim()
				? record.code
				: "supervisor_invalid_response",
		message:
			typeof record?.message === "string" && record.message.trim()
				? record.message
				: "Supervisor stream returned an invalid terminal error.",
		retryable: typeof record?.retryable === "boolean" ? record.retryable : true,
	};
}

function parseSseBlock(block: string): ParsedSseEvent | null {
	let event = "message";
	const dataLines: string[] = [];

	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
			continue;
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}

	if (dataLines.length === 0) {
		return null;
	}

	const rawData = dataLines.join("\n");
	let data: unknown;
	try {
		data = JSON.parse(rawData);
	} catch {
		data = rawData;
	}

	return { data, event };
}

export async function* parseSupervisorSse(response: Response): AsyncIterable<ParsedSseEvent> {
	if (!response.body) {
		return;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) {
				break;
			}
			buffer += decoder.decode(chunk.value, { stream: true });

			let boundary = buffer.search(/\r?\n\r?\n/);
			while (boundary >= 0) {
				const block = buffer.slice(0, boundary);
				const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
				buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
				const parsed = parseSseBlock(block);
				if (parsed) {
					yield parsed;
				}
				boundary = buffer.search(/\r?\n\r?\n/);
			}
		}

		buffer += decoder.decode();
		const parsed = parseSseBlock(buffer.trim());
		if (parsed) {
			yield parsed;
		}
	} finally {
		reader.releaseLock();
	}
}

export function mapSupervisorLifecycleEvent(input: {
	data: unknown;
	event: string;
	fallbackRequestId: string;
	fallbackTraceId: string;
	now: () => Date;
}): ChatCommandStreamEvent | null {
	if (input.event !== "execution.queued" && input.event !== "execution.running") {
		return null;
	}

	const record = getRecord(input.data);
	const requestId = record
		? (getString(record, "request_id", "requestId") ?? input.fallbackRequestId)
		: input.fallbackRequestId;
	const traceId = record
		? (getString(record, "trace_id", "traceId") ?? input.fallbackTraceId)
		: input.fallbackTraceId;
	const occurredAt = record
		? (getString(record, "occurred_at", "occurredAt") ?? input.now().toISOString())
		: input.now().toISOString();
	const status =
		input.event === "execution.queued"
			? "queued"
			: record
				? (getString(record, "status", "status") ?? "running")
				: "running";

	return {
		data: {
			occurredAt,
			requestId,
			status,
			traceId,
		},
		event: input.event,
	};
}

export function parseSupervisorTerminalResponse(input: {
	data: unknown;
	event: string;
	fallbackRequestId: string;
	fallbackTraceId: string;
	now: () => Date;
}): {
	occurredAt: string;
	requestId: string;
	response: SupervisorExecutionResponse;
	sourceEvent: string;
	traceId: string;
} | null {
	if (
		input.event !== "execution.completed" &&
		input.event !== "execution.failed" &&
		input.event !== "execution.cancelled"
	) {
		return null;
	}

	const record = getRecord(input.data);
	const requestId = record
		? (getString(record, "request_id", "requestId") ?? input.fallbackRequestId)
		: input.fallbackRequestId;
	const traceId = record
		? (getString(record, "trace_id", "traceId") ?? input.fallbackTraceId)
		: input.fallbackTraceId;
	const occurredAt = record
		? (getString(record, "occurred_at", "occurredAt") ?? input.now().toISOString())
		: input.now().toISOString();

	if (input.event === "execution.completed") {
		const responseRecord = getRecord(record?.response);
		if (!responseRecord) {
			return {
				occurredAt,
				requestId,
				response: supervisorStreamErrorResponse({
					code: "supervisor_invalid_response",
					message: "Supervisor stream completed without a response payload.",
					retryable: true,
					status: "error",
					traceId,
				}),
				sourceEvent: "execution.failed",
				traceId,
			};
		}

		return {
			occurredAt,
			requestId,
			response: parseSupervisorExecutionResponsePayload(responseRecord, traceId),
			sourceEvent: input.event,
			traceId,
		};
	}

	const error = getError(record?.error);
	return {
		occurredAt,
		requestId,
		response: supervisorStreamErrorResponse({
			...error,
			status: input.event === "execution.cancelled" ? "cancelled" : "error",
			traceId,
		}),
		sourceEvent: input.event,
		traceId,
	};
}

export function supervisorStreamErrorResponse(input: {
	code: string;
	message: string;
	retryable?: boolean;
	status?: "error" | "cancelled";
	traceId: string;
}): SupervisorExecutionResponse {
	return {
		answerText: "",
		error: {
			code: input.code,
			message: input.message,
			retryable: input.retryable ?? true,
		},
		followUpQuestion: "",
		result: null,
		selectedTarget: null,
		status: input.status ?? "error",
		traceId: input.traceId,
	};
}

export function toTerminalChatStreamEvent(input: {
	occurredAt: string;
	response: ChatCommandResponse;
	sourceEvent?: string;
}): ChatCommandStreamEvent {
	const status = input.response.supervisor?.status ?? input.response.answer.result.kind;
	let event: ChatCommandStreamEventName = "request.failed";
	if (input.sourceEvent === "execution.cancelled" || status === "cancelled") {
		event = "request.cancelled";
	} else if (status === "completed" || status === "needs_clarification" || status === "no_answer") {
		event = "request.completed";
	}

	return {
		data: {
			answer: input.response.answer,
			error:
				input.response.answer.result.kind === "error"
					? {
							code: input.response.answer.result.errorCode,
							message: input.response.answer.result.message,
							retryable: input.response.answer.result.retryable,
						}
					: undefined,
			occurredAt: input.occurredAt,
			requestId: input.response.requestId,
			status,
			traceId: input.response.traceId,
		},
		event,
	};
}
