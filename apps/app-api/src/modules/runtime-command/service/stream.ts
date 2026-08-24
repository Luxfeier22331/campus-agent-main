import {
	parseExecutionFinalizationResponsePayload,
	type ToolExecutionResponse,
} from "../../integration";
import type { RuntimeRunProductPhase } from "../../runtime-run";
import type {
	ChatCommandResponse,
	ChatCommandStreamEvent,
	ChatCommandStreamEventName,
} from "./types";
import { publicExecutionFailure } from "./writes";

interface ParsedSseEvent {
	data: unknown;
	event: string;
}

class ExecutionLifecycleContractError extends Error {
	constructor(message: string) {
		super(`execution lifecycle contract violation: ${message}`);
		this.name = "ExecutionLifecycleContractError";
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

function getError(value: unknown): { code: string; retryable: boolean } {
	const record = getRecord(value);
	if (!record) {
		throw new ExecutionLifecycleContractError("terminal error payload must be an object");
	}
	const code = getString(record, "code");
	if (!code) {
		throw new ExecutionLifecycleContractError("terminal error missing code");
	}
	if (!getString(record, "message")) {
		throw new ExecutionLifecycleContractError("terminal error missing message");
	}
	if (typeof record.retryable !== "boolean") {
		throw new ExecutionLifecycleContractError("terminal error missing retryable");
	}
	return {
		code,
		retryable: record.retryable,
	};
}

function isRuntimeRunProductPhase(value: unknown): value is RuntimeRunProductPhase {
	return value === "finalizing" || value === "generating" || value === "preparing";
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
		throw new ExecutionLifecycleContractError("SSE event data must be JSON");
	}

	return { data, event };
}

export async function* parseExecutionControlSse(response: Response): AsyncIterable<ParsedSseEvent> {
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

export function mapExecutionLifecycleEvent(input: {
	data: unknown;
	event: string;
	now: () => Date;
}): ChatCommandStreamEvent | null {
	if (
		input.event !== "execution.queued" &&
		input.event !== "execution.running" &&
		input.event !== "execution.phase"
	) {
		return null;
	}

	const record = getRecord(input.data);
	if (!record) {
		throw new ExecutionLifecycleContractError("lifecycle event payload must be an object");
	}
	const requestId = getString(record, "request_id");
	if (!requestId) {
		throw new ExecutionLifecycleContractError("lifecycle event missing request_id");
	}
	const traceId = getString(record, "trace_id");
	if (!traceId) {
		throw new ExecutionLifecycleContractError("lifecycle event missing trace_id");
	}
	const occurredAt = getString(record, "occurred_at");
	if (!occurredAt) {
		throw new ExecutionLifecycleContractError("lifecycle event missing occurred_at");
	}
	const status =
		input.event === "execution.queued" ? "queued" : (getString(record, "status") ?? "running");
	const phase = record.phase;
	if (input.event === "execution.phase" && !isRuntimeRunProductPhase(phase)) {
		throw new ExecutionLifecycleContractError("phase event missing a supported phase");
	}
	const phaseData: { phase: RuntimeRunProductPhase } | undefined =
		input.event === "execution.phase" && isRuntimeRunProductPhase(phase) ? { phase } : undefined;

	return {
		data: {
			occurredAt,
			requestId,
			...(phaseData ?? {}),
			...(getString(record, "run_id") ? { runId: getString(record, "run_id") } : {}),
			...(typeof record.sequence === "number" ? { sequence: record.sequence } : {}),
			status,
			traceId,
		},
		event: input.event,
	};
}

export function parseExecutionTerminalResponse(input: {
	data: unknown;
	event: string;
	now: () => Date;
}): {
	occurredAt: string;
	requestId: string;
	response: ToolExecutionResponse;
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
		throw new ExecutionLifecycleContractError("terminal event payload must be an object");
	}
	const requestId = getString(record, "request_id");
	if (!requestId) {
		throw new ExecutionLifecycleContractError("terminal event missing request_id");
	}
	const traceId = getString(record, "trace_id");
	if (!traceId) {
		throw new ExecutionLifecycleContractError("terminal event missing trace_id");
	}
	const occurredAt = getString(record, "occurred_at");
	if (!occurredAt) {
		throw new ExecutionLifecycleContractError("terminal event missing occurred_at");
	}

	if (input.event === "execution.completed") {
		const responseRecord = getRecord(record?.response);
		if (!responseRecord) {
			return {
				occurredAt,
				requestId,
				response: executionFinalizationErrorResponse({
					code: "execution_control_invalid_response",
					message: "Execution stream completed without a response payload.",
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
			response: parseExecutionFinalizationResponsePayload(responseRecord),
			sourceEvent: input.event,
			traceId,
		};
	}

	const error = getError(record?.error);
	const failure = publicExecutionFailure({
		errorCode: error.code,
		status: input.event === "execution.cancelled" ? "cancelled" : "error",
	});
	return {
		occurredAt,
		requestId,
		response: executionFinalizationErrorResponse({
			code: failure.errorCode,
			message: failure.message,
			retryable: error.retryable,
			status: input.event === "execution.cancelled" ? "cancelled" : "error",
			traceId,
		}),
		sourceEvent: input.event,
		traceId,
	};
}

export function executionFinalizationErrorResponse(input: {
	code: string;
	message: string;
	retryable: boolean;
	status?: "error" | "cancelled";
	traceId: string;
}): ToolExecutionResponse {
	return {
		answerText: "",
		error: {
			code: input.code,
			message: input.message,
			retryable: input.retryable,
		},
		modelUsage: { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
		result: null,
		status: input.status ?? "error",
		traceId: input.traceId,
	};
}

export function toTerminalChatStreamEvent(input: {
	occurredAt: string;
	response: ChatCommandResponse;
	runId?: string | null;
	sequence?: number;
	sourceEvent?: string;
}): ChatCommandStreamEvent {
	const status = input.response.execution?.status ?? input.response.answer.result.kind;
	let event: ChatCommandStreamEventName = "request.failed";
	if (input.sourceEvent === "execution.cancelled" || status === "cancelled") {
		event = "request.cancelled";
	} else if (status === "completed") {
		event = "request.completed";
	}

	return {
		data: {
			answer: input.response.answer,
			...(input.response.answer.result.kind === "error"
				? {
						error: {
							code: input.response.answer.result.errorCode,
							message: input.response.answer.result.message,
							retryable: input.response.answer.result.retryable,
						},
					}
				: {}),
			occurredAt: input.occurredAt,
			requestId: input.response.requestId,
			runId: input.runId ?? null,
			...(input.sequence === undefined ? {} : { sequence: input.sequence }),
			status,
			traceId: input.response.traceId,
		},
		event,
	};
}
