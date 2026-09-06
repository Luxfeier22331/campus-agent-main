import {
	EXECUTION_CONTROL_FAILURE_MESSAGE,
	type ExecutionControlRunEvent,
	ExecutionControlTransportError,
	isSafeExecutionControlErrorCode,
	parseExecutionFinalizationResponsePayload,
	type ToolExecutionResponse,
} from "../../integration";
import { executionFinalizationErrorResponse, toTerminalChatStreamEvent } from "./stream";
import type { ChatCommandResponse, ChatCommandStreamEvent } from "./types";

export interface DurableRunEventContext {
	acceptedAt: string;
	requestId: string;
}

export type DurableTerminalSourceEvent =
	| "execution.cancelled"
	| "execution.completed"
	| "execution.failed";

export interface DurableTerminalRunOutcome {
	response: ToolExecutionResponse;
	sourceEvent: DurableTerminalSourceEvent;
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function firstAssistantMessage(input: ChatCommandResponse): {
	id: string;
	text: string;
} | null {
	const messages = input.answer.conversation.messages;
	const message = [...messages].reverse().find((item) => item.role === "assistant");
	if (!message || message.text.trim() === "") {
		return null;
	}
	return { id: message.id, text: message.text };
}

export function answerDeltaEvent(input: {
	context: DurableRunEventContext;
	finalized: ChatCommandResponse;
	occurredAt: string;
	sequence?: number;
}): ChatCommandStreamEvent | null {
	if (input.finalized.answer.result.kind !== "answer") {
		return null;
	}
	const assistantMessage = firstAssistantMessage(input.finalized);
	if (!assistantMessage) {
		return null;
	}
	return {
		data: {
			delta: assistantMessage.text,
			messageId: assistantMessage.id,
			occurredAt: input.occurredAt,
			requestId: input.context.requestId,
			...(input.sequence === undefined ? {} : { sequence: input.sequence }),
			status: "streaming",
		},
		event: "answer.delta",
	};
}

export function chatStreamEventsForFinalized(input: {
	context: DurableRunEventContext;
	finalized: ChatCommandResponse;
	hasStreamedAnswerDelta?: boolean;
	occurredAt: string;
	sourceEvent?: DurableTerminalSourceEvent;
	sequence?: number;
}): ChatCommandStreamEvent[] {
	const terminal = toTerminalChatStreamEvent({
		occurredAt: input.occurredAt,
		response: input.finalized,
		...(input.sequence === undefined ? {} : { sequence: input.sequence }),
		...(input.sourceEvent ? { sourceEvent: input.sourceEvent } : {}),
	});
	if (input.hasStreamedAnswerDelta) {
		return [terminal];
	}
	const delta = answerDeltaEvent({
		context: input.context,
		finalized: input.finalized,
		occurredAt: input.occurredAt,
		...(input.sequence === undefined ? {} : { sequence: input.sequence }),
	});
	return delta ? [delta, terminal] : [terminal];
}

export function answerDeltaEventFromDurableRunEvent(
	context: DurableRunEventContext,
	event: ExecutionControlRunEvent,
): ChatCommandStreamEvent | null {
	if (event.eventType !== "run.answer_delta") {
		return null;
	}
	assertDurableEventRunMatches(
		context,
		event,
		"Durable answer delta event request_id does not match the accepted request.",
	);
	const requestId =
		typeof event.payload.request_id === "string" && event.payload.request_id.trim()
			? event.payload.request_id.trim()
			: context.requestId;
	if (requestId !== context.requestId) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Durable answer delta event request_id does not match the accepted request.",
			retryable: true,
			status: 502,
		});
	}
	const messageId = getRequiredString(
		event.payload,
		"message_id",
		"Durable answer delta event message_id is required.",
	);
	const delta = event.payload.delta;
	if (typeof delta !== "string" || delta.length === 0) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Durable answer delta event delta is required.",
			retryable: true,
			status: 502,
		});
	}
	return {
		data: {
			delta,
			messageId,
			occurredAt: event.occurredAt,
			requestId: context.requestId,
			sequence: event.sequence,
			status: "streaming",
		},
		event: "answer.delta",
	};
}

function getRequiredString(record: Record<string, unknown>, key: string, message: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.trim() === "") {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message,
			retryable: true,
			status: 502,
		});
	}
	return value;
}

function getRequiredBoolean(
	record: Record<string, unknown>,
	key: string,
	message: string,
): boolean {
	const value = record[key];
	if (typeof value !== "boolean") {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message,
			retryable: true,
			status: 502,
		});
	}
	return value;
}

export function assertDurableEventRunMatches(
	context: DurableRunEventContext,
	event: ExecutionControlRunEvent,
	message: string,
) {
	if (event.requestId !== context.requestId) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message,
			retryable: true,
			status: 502,
		});
	}
}

export function lifecycleEventFromDurableRunEvent(
	context: DurableRunEventContext,
	event: ExecutionControlRunEvent,
): ChatCommandStreamEvent | null {
	assertDurableEventRunMatches(
		context,
		event,
		"Durable request event request_id does not match the accepted request.",
	);
	const baseData = {
		occurredAt: event.occurredAt,
		requestId: context.requestId,
		sequence: event.sequence,
	};
	if (event.eventType === "run.queued") {
		return {
			data: {
				...baseData,
				status: "queued",
			},
			event: "execution.queued",
		};
	}
	if (event.eventType === "run.started") {
		return {
			data: {
				...baseData,
				status: "running",
			},
			event: "execution.running",
		};
	}
	if (event.eventType === "run.progress") {
		const phase = event.payload.phase;
		if (phase !== "generating" && phase !== "finalizing") {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Durable run progress event phase is invalid.",
				retryable: true,
				status: 502,
			});
		}
		return {
			data: {
				...baseData,
				phase,
				status: "running",
			},
			event: "execution.phase",
		};
	}
	if (event.eventType === "run.answer_started") {
		return {
			data: {
				...baseData,
				phase: "generating",
				status: "running",
			},
			event: "execution.phase",
		};
	}
	return null;
}

export function finalizationResponseFromDurableRunEvent(
	context: DurableRunEventContext,
	event: ExecutionControlRunEvent,
): ToolExecutionResponse | null {
	const terminalOutcome = durableTerminalOutcomeFromDurableRunEvent(context, event);
	return terminalOutcome?.response ?? null;
}

export function durableTerminalOutcomeFromDurableRunEvent(
	context: DurableRunEventContext,
	event: ExecutionControlRunEvent,
): DurableTerminalRunOutcome | null {
	if (event.eventType === "run.canceled") {
		assertDurableEventRunMatches(
			context,
			event,
			"Durable request canceled event request_id does not match the accepted request.",
		);
		return {
			response: executionFinalizationErrorResponse({
				code: "execution_cancelled",
				message: "The request was cancelled.",
				retryable: false,
				status: "cancelled",
			}),
			sourceEvent: "execution.cancelled",
		};
	}
	if (event.eventType === "run.failed") {
		assertDurableEventRunMatches(
			context,
			event,
			"Durable request failed event request_id does not match the accepted request.",
		);
		if (event.payload.request_id !== context.requestId) {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Durable run failed event request_id does not match the accepted request.",
				retryable: true,
				status: 502,
			});
		}
		const error = asJsonRecord(event.payload.error);
		if (!error) {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Durable run failed event error must be an object.",
				retryable: true,
				status: 502,
			});
		}
		const code = getRequiredString(
			error,
			"code",
			"Durable run failed event error.code is required.",
		).trim();
		if (!isSafeExecutionControlErrorCode(code)) {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Durable run failed event error.code is invalid.",
				retryable: true,
				status: 502,
			});
		}
		getRequiredString(error, "message", "Durable run failed event error.message is required.");
		const retryable = getRequiredBoolean(
			error,
			"retryable",
			"Durable run failed event error.retryable is required.",
		);
		return {
			response: executionFinalizationErrorResponse({
				code,
				message: EXECUTION_CONTROL_FAILURE_MESSAGE,
				retryable,
			}),
			sourceEvent: "execution.failed",
		};
	}
	if (event.eventType !== "finalization.completed") {
		return null;
	}
	assertDurableEventRunMatches(
		context,
		event,
		"Durable finalization event request_id does not match the accepted request.",
	);
	if (event.visibility !== "internal") {
		return null;
	}
	if (event.payload.request_id !== context.requestId) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Durable finalization event request_id does not match the accepted request.",
			retryable: true,
			status: 502,
		});
	}
	const response = asJsonRecord(event.payload.response);
	if (!response) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Durable finalization event response must be an object.",
			retryable: true,
			status: 502,
		});
	}
	return {
		response: parseExecutionFinalizationResponsePayload(response),
		sourceEvent: "execution.completed",
	};
}

export function finalizationResponseFromDurableRunEvents(
	context: DurableRunEventContext,
	runEvents: ExecutionControlRunEvent[],
): ToolExecutionResponse | null {
	for (const runEvent of runEvents) {
		const finalizationResponse = finalizationResponseFromDurableRunEvent(context, runEvent);
		if (finalizationResponse) {
			return finalizationResponse;
		}
	}
	return null;
}
