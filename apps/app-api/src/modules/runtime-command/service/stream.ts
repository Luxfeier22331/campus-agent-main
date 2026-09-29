import {
	parseExecutionFinalizationResponsePayload,
	type ToolExecutionResponse,
} from "../../integration";
import { publicExecutionFailure } from "./errors";
import type {
	ChatCommandResponse,
	ChatCommandStreamEvent,
	ChatCommandStreamEventName,
} from "./types";

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

export function parseExecutionTerminalResponse(input: {
	data: unknown;
	event: string;
	now: () => Date;
}): {
	occurredAt: string;
	requestId: string;
	response: ToolExecutionResponse;
	sourceEvent: string;
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
				}),
				sourceEvent: "execution.failed",
			};
		}

		return {
			occurredAt,
			requestId,
			response: parseExecutionFinalizationResponsePayload(responseRecord),
			sourceEvent: input.event,
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
		}),
		sourceEvent: input.event,
	};
}

export function executionFinalizationErrorResponse(input: {
	code: string;
	message: string;
	retryable: boolean;
	status?: "error" | "cancelled";
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
	};
}

export function toTerminalChatStreamEvent(input: {
	occurredAt: string;
	response: ChatCommandResponse;
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
			...(input.sequence === undefined ? {} : { sequence: input.sequence }),
			status,
		},
		event,
	};
}
