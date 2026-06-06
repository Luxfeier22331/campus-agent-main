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

class SupervisorLifecycleContractError extends Error {
	constructor(message: string) {
		super(`supervisor lifecycle contract violation: ${message}`);
		this.name = "SupervisorLifecycleContractError";
	}
}

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function getString(record: Record<string, unknown>, snakeKey: string): string | null {
	const value = record[snakeKey];
	return typeof value === "string" && value.trim() ? value : null;
}

function getError(value: unknown): { code: string; message: string; retryable: boolean } {
	const record = getRecord(value);
	if (!record) {
		throw new SupervisorLifecycleContractError("terminal error payload must be an object");
	}
	const code = getString(record, "code");
	if (!code) {
		throw new SupervisorLifecycleContractError("terminal error missing code");
	}
	const message = getString(record, "message");
	if (!message) {
		throw new SupervisorLifecycleContractError("terminal error missing message");
	}
	if (typeof record.retryable !== "boolean") {
		throw new SupervisorLifecycleContractError("terminal error missing retryable");
	}
	return {
		code,
		message,
		retryable: record.retryable,
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
		throw new SupervisorLifecycleContractError("SSE event data must be JSON");
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
	now: () => Date;
}): ChatCommandStreamEvent | null {
	if (input.event !== "execution.queued" && input.event !== "execution.running") {
		return null;
	}

	const record = getRecord(input.data);
	if (!record) {
		throw new SupervisorLifecycleContractError("lifecycle event payload must be an object");
	}
	const requestId = getString(record, "request_id");
	if (!requestId) {
		throw new SupervisorLifecycleContractError("lifecycle event missing request_id");
	}
	const traceId = getString(record, "trace_id");
	if (!traceId) {
		throw new SupervisorLifecycleContractError("lifecycle event missing trace_id");
	}
	const occurredAt = getString(record, "occurred_at");
	if (!occurredAt) {
		throw new SupervisorLifecycleContractError("lifecycle event missing occurred_at");
	}
	const status =
		input.event === "execution.queued" ? "queued" : (getString(record, "status") ?? "running");

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
	if (!record) {
		throw new SupervisorLifecycleContractError("terminal event payload must be an object");
	}
	const requestId = getString(record, "request_id");
	if (!requestId) {
		throw new SupervisorLifecycleContractError("terminal event missing request_id");
	}
	const traceId = getString(record, "trace_id");
	if (!traceId) {
		throw new SupervisorLifecycleContractError("terminal event missing trace_id");
	}
	const occurredAt = getString(record, "occurred_at");
	if (!occurredAt) {
		throw new SupervisorLifecycleContractError("terminal event missing occurred_at");
	}

	if (input.event === "execution.completed") {
		const responseRecord = getRecord(record?.response);
		if (!responseRecord) {
			return {
				occurredAt,
				requestId,
				response: supervisorStreamErrorResponse({
					code: "execution_gateway_invalid_response",
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
			response: parseSupervisorExecutionResponsePayload(responseRecord),
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
	retryable: boolean;
	status?: "error" | "cancelled";
	traceId: string;
}): SupervisorExecutionResponse {
	return {
		answerText: "",
		error: {
			code: input.code,
			message: input.message,
			retryable: input.retryable,
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
