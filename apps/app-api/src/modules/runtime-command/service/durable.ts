import {
	EXECUTION_CONTROL_FAILURE_MESSAGE,
	type ExecutionControlRunEvent,
	type ExecutionControlRunEventPage,
	ExecutionControlTransportError,
	isSafeExecutionControlErrorCode,
	parseExecutionFinalizationResponsePayload,
	type ToolExecutionResponse,
} from "../../integration";
import { createDurableCloseoutQueue } from "./durable-closeout-queue";
import { toHandledErrorTransportOutcome } from "./errors";
import { executionFinalizationErrorResponse, toTerminalChatStreamEvent } from "./stream";
import type {
	ChatCommandResponse,
	ChatCommandStreamEvent,
	DurableEventPollingPolicy,
} from "./types";

export const DEFAULT_DURABLE_EVENT_POLLING_POLICY = {
	maxAttempts: 4,
	waitMs: 25_000,
} as const;

interface DurableRunEventContext {
	acceptedAt: string;
	requestId: string;
	runId: string | null;
	traceId: string;
}

type DurableTerminalSourceEvent =
	| "execution.cancelled"
	| "execution.completed"
	| "execution.failed";

interface DurableTerminalRunOutcome {
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

function answerDeltaEvent(input: {
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
			runId: input.context.runId,
			...(input.sequence === undefined ? {} : { sequence: input.sequence }),
			status: "streaming",
			traceId: input.context.traceId,
		},
		event: "answer.delta",
	};
}

function chatStreamEventsForFinalized(input: {
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
		runId: input.context.runId,
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

function answerDeltaEventFromDurableRunEvent(
	context: DurableRunEventContext,
	event: ExecutionControlRunEvent,
): ChatCommandStreamEvent | null {
	if (event.eventType !== "run.answer_delta") {
		return null;
	}
	assertDurableEventRunMatches(
		context,
		event,
		"Durable answer delta event run_id does not match the accepted run.",
	);
	const requestId =
		typeof event.payload.request_id === "string" && event.payload.request_id.trim()
			? event.payload.request_id.trim()
			: context.requestId;
	const traceId =
		typeof event.payload.trace_id === "string" && event.payload.trace_id.trim()
			? event.payload.trace_id.trim()
			: context.traceId;
	if (requestId !== context.requestId) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Durable answer delta event request_id does not match the accepted request.",
			retryable: true,
			status: 502,
		});
	}
	if (traceId !== context.traceId) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Durable answer delta event trace_id does not match the accepted request.",
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
			runId: context.runId,
			sequence: event.sequence,
			status: "streaming",
			traceId: context.traceId,
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

function assertDurableEventRunMatches(
	context: DurableRunEventContext,
	event: ExecutionControlRunEvent,
	message: string,
) {
	if (event.runId !== context.runId) {
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
		"Durable run event run_id does not match the accepted run.",
	);
	const baseData = {
		occurredAt: event.occurredAt,
		requestId: context.requestId,
		runId: context.runId,
		sequence: event.sequence,
		traceId: context.traceId,
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
	if (event.eventType === "run.answer_completed") {
		return {
			data: {
				...baseData,
				phase: "finalizing",
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
			"Durable run canceled event run_id does not match the accepted run.",
		);
		return {
			response: executionFinalizationErrorResponse({
				code: "execution_cancelled",
				message: "The request was cancelled.",
				retryable: false,
				status: "cancelled",
				traceId: context.traceId,
			}),
			sourceEvent: "execution.cancelled",
		};
	}
	if (event.eventType === "run.failed") {
		assertDurableEventRunMatches(
			context,
			event,
			"Durable run failed event run_id does not match the accepted run.",
		);
		if (event.payload.request_id !== context.requestId) {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Durable run failed event request_id does not match the accepted request.",
				retryable: true,
				status: 502,
			});
		}
		if (event.payload.trace_id !== context.traceId) {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Durable run failed event trace_id does not match the accepted request.",
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
				traceId: context.traceId,
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
		"Durable finalization event run_id does not match the accepted run.",
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
	if (event.payload.trace_id !== context.traceId) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Durable finalization event trace_id does not match the accepted request.",
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

function validatePollingPolicy(
	policy?: DurableEventPollingPolicy,
): Required<DurableEventPollingPolicy> {
	const maxAttempts = policy?.maxAttempts ?? DEFAULT_DURABLE_EVENT_POLLING_POLICY.maxAttempts;
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
		throw new ExecutionControlTransportError({
			code: "runtime_invariant_failed",
			message: "Durable event polling maxAttempts must be a positive integer.",
			retryable: false,
			status: 500,
		});
	}
	const waitMs = policy?.waitMs ?? DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs;
	if (!Number.isInteger(waitMs) || waitMs < 0) {
		throw new ExecutionControlTransportError({
			code: "runtime_invariant_failed",
			message: "Durable event polling waitMs must be a non-negative integer.",
			retryable: false,
			status: 500,
		});
	}
	return {
		maxAttempts,
		waitMs,
	};
}

function updateLastSequence(
	context: DurableRunEventContext,
	lastSequence: number,
	runEvent: ExecutionControlRunEvent,
): number {
	assertDurableEventRunMatches(
		context,
		runEvent,
		"Durable run event run_id does not match the accepted run.",
	);
	if (!Number.isInteger(runEvent.sequence) || runEvent.sequence <= lastSequence) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Durable run event sequence must be strictly increasing.",
			retryable: true,
			status: 502,
		});
	}
	return runEvent.sequence;
}

function nextSequenceFromPage(lastSequence: number, page: ExecutionControlRunEventPage): number {
	if (!Number.isInteger(page.nextSequence) || page.nextSequence < lastSequence) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Durable run event page returned a stale next_sequence.",
			retryable: true,
			status: 502,
		});
	}
	return page.nextSequence;
}

function durableEventWaitTimeoutResponse(context: DurableRunEventContext): ToolExecutionResponse {
	return executionFinalizationErrorResponse({
		code: "execution_timeout",
		message: "Durable run event polling budget expired before terminal finalization.",
		retryable: true,
		traceId: context.traceId,
	});
}

function durationMsBetween(startedAt: string, completedAt: string): number | null {
	const started = new Date(startedAt).valueOf();
	const completed = new Date(completedAt).valueOf();
	if (!(Number.isFinite(started) && Number.isFinite(completed)) || completed <= started) {
		return null;
	}
	return completed - started;
}

export async function waitForDurableFinalizationResponse<
	Context extends DurableRunEventContext,
>(input: {
	context: Context;
	listRunEvents(afterSequence: number, waitMs?: number): Promise<ExecutionControlRunEventPage>;
	polling?: DurableEventPollingPolicy;
}): Promise<{
	response: ToolExecutionResponse;
	terminalObserved: boolean;
}> {
	const polling = validatePollingPolicy(input.polling);
	let lastSequence = 0;
	let emptyPollAttempts = 0;

	while (emptyPollAttempts < polling.maxAttempts) {
		const page = await input.listRunEvents(lastSequence, polling.waitMs);
		if (page.events.length === 0) {
			emptyPollAttempts += 1;
		} else {
			emptyPollAttempts = 0;
		}
		for (const runEvent of page.events) {
			lastSequence = updateLastSequence(input.context, lastSequence, runEvent);
			const terminalOutcome = durableTerminalOutcomeFromDurableRunEvent(input.context, runEvent);
			if (terminalOutcome) {
				return {
					response: terminalOutcome.response,
					terminalObserved: true,
				};
			}
		}
		lastSequence = nextSequenceFromPage(lastSequence, page);
	}

	return {
		response: durableEventWaitTimeoutResponse(input.context),
		terminalObserved: false,
	};
}

export async function* streamDurableRunEventsUntilTerminal<
	Context extends DurableRunEventContext,
>(input: {
	context: Context;
	finalizeAcceptedCommand(finalizeInput: {
		context: Context;
		executionResponse: ToolExecutionResponse;
		executionFinalizationReceivedAt?: string | null;
		streamAppApiTtftMs?: number | null;
	}): Promise<ChatCommandResponse>;
	listRunEvents(afterSequence: number, waitMs?: number): Promise<ExecutionControlRunEventPage>;
	now: () => Date;
	polling?: DurableEventPollingPolicy;
}): AsyncIterable<ChatCommandStreamEvent> {
	const { context, now } = input;
	const polling = validatePollingPolicy(input.polling);
	let lastSequence = 0;
	let emptyPollAttempts = 0;
	let hasStreamedAnswerDelta = false;
	let streamAppApiTtftMs: number | null = null;
	try {
		while (emptyPollAttempts < polling.maxAttempts) {
			const page = await input.listRunEvents(lastSequence, polling.waitMs);
			if (page.events.length === 0) {
				emptyPollAttempts += 1;
			} else {
				emptyPollAttempts = 0;
			}
			for (const runEvent of page.events) {
				lastSequence = updateLastSequence(context, lastSequence, runEvent);
				const lifecycleEvent = lifecycleEventFromDurableRunEvent(context, runEvent);
				if (lifecycleEvent) {
					yield lifecycleEvent;
					continue;
				}
				const answerDelta = answerDeltaEventFromDurableRunEvent(context, runEvent);
				if (answerDelta) {
					if (streamAppApiTtftMs === null) {
						streamAppApiTtftMs = durationMsBetween(context.acceptedAt, now().toISOString());
					}
					hasStreamedAnswerDelta = true;
					yield answerDelta;
					continue;
				}
				const terminalOutcome = durableTerminalOutcomeFromDurableRunEvent(context, runEvent);
				if (!terminalOutcome) {
					continue;
				}
				const finalized = await input.finalizeAcceptedCommand({
					context,
					executionResponse: terminalOutcome.response,
					executionFinalizationReceivedAt: runEvent.occurredAt,
					streamAppApiTtftMs,
				});
				for (const event of chatStreamEventsForFinalized({
					context,
					finalized,
					hasStreamedAnswerDelta,
					occurredAt: runEvent.occurredAt,
					sequence: runEvent.sequence,
					sourceEvent: terminalOutcome.sourceEvent,
				})) {
					yield event;
				}
				return;
			}
			lastSequence = nextSequenceFromPage(lastSequence, page);
		}
	} catch (error) {
		const handled = toHandledErrorTransportOutcome(error);
		const finalized = await input.finalizeAcceptedCommand({
			context,
			executionResponse: handled,
			streamAppApiTtftMs,
		});
		for (const event of chatStreamEventsForFinalized({
			context,
			finalized,
			hasStreamedAnswerDelta,
			occurredAt: now().toISOString(),
		})) {
			yield event;
		}
		return;
	}
	const finalized = await input.finalizeAcceptedCommand({
		context,
		executionResponse: durableEventWaitTimeoutResponse(context),
		streamAppApiTtftMs,
	});
	for (const event of chatStreamEventsForFinalized({
		context,
		finalized,
		hasStreamedAnswerDelta,
		occurredAt: now().toISOString(),
	})) {
		yield event;
	}
}

export function startDurableFinalizationCloseout<Context extends DurableRunEventContext>(input: {
	context: Context;
	finalizeAcceptedCommand(finalizeInput: {
		context: Context;
		executionResponse: ToolExecutionResponse;
		executionFinalizationReceivedAt?: string | null;
		streamAppApiTtftMs?: number | null;
	}): Promise<ChatCommandResponse>;
	listRunEvents(afterSequence: number, waitMs?: number): Promise<ExecutionControlRunEventPage>;
	now: () => Date;
	polling?: DurableEventPollingPolicy;
	recordStreamAppApiTtft(input: { durationMs: number; observedAt: string }): Promise<unknown>;
}): {
	completion: Promise<ChatCommandResponse>;
	streamEvents(): AsyncIterable<ChatCommandStreamEvent>;
} {
	const { context } = input;
	const polling = validatePollingPolicy(input.polling);
	const queue = createDurableCloseoutQueue();
	let ttftRecordPromise: Promise<unknown> | null = null;

	const closeoutTask = (async () => {
		let lastSequence = 0;
		let emptyPollAttempts = 0;
		let hasStreamedAnswerDelta = false;
		let streamAppApiTtftMs: number | null = null;
		while (emptyPollAttempts < polling.maxAttempts) {
			const page = await input.listRunEvents(lastSequence, polling.waitMs);
			if (page.events.length === 0) {
				emptyPollAttempts += 1;
			} else {
				emptyPollAttempts = 0;
			}
			for (const runEvent of page.events) {
				lastSequence = updateLastSequence(context, lastSequence, runEvent);
				const lifecycleEvent = lifecycleEventFromDurableRunEvent(context, runEvent);
				if (lifecycleEvent) {
					queue.push({ event: lifecycleEvent, kind: "event" });
					continue;
				}
				const answerDelta = answerDeltaEventFromDurableRunEvent(context, runEvent);
				if (answerDelta) {
					let ttftObservation: { durationMs: number; observedAt: string } | null = null;
					if (streamAppApiTtftMs === null) {
						const observedAt = input.now().toISOString();
						streamAppApiTtftMs = durationMsBetween(context.acceptedAt, observedAt);
						if (streamAppApiTtftMs !== null) {
							ttftObservation = {
								durationMs: streamAppApiTtftMs,
								observedAt,
							};
						}
					}
					hasStreamedAnswerDelta = true;
					queue.push({ event: answerDelta, kind: "event" });
					if (ttftObservation) {
						ttftRecordPromise = Promise.resolve()
							.then(() => input.recordStreamAppApiTtft(ttftObservation))
							.catch(() => undefined);
					}
					continue;
				}
				const terminalOutcome = durableTerminalOutcomeFromDurableRunEvent(context, runEvent);
				if (!terminalOutcome) {
					continue;
				}
				const finalized = await input.finalizeAcceptedCommand({
					context,
					executionResponse: terminalOutcome.response,
					executionFinalizationReceivedAt: runEvent.occurredAt,
					streamAppApiTtftMs,
				});
				for (const event of chatStreamEventsForFinalized({
					context,
					finalized,
					hasStreamedAnswerDelta,
					occurredAt: runEvent.occurredAt,
					sequence: runEvent.sequence,
					sourceEvent: terminalOutcome.sourceEvent,
				})) {
					queue.push({ event, kind: "event" });
				}
				queue.push({ kind: "done" });
				return finalized;
			}
			lastSequence = nextSequenceFromPage(lastSequence, page);
		}

		throw new ExecutionControlTransportError({
			code: "execution_status_pending",
			message: "Durable run event polling ended before a product terminal event was available.",
			retryable: true,
			status: 504,
		});
	})().catch((error) => {
		queue.push({ error, kind: "error" });
		throw error;
	});
	const completion = (async () => {
		try {
			return await closeoutTask;
		} finally {
			await ttftRecordPromise;
		}
	})();

	return {
		completion,
		async *streamEvents() {
			for (;;) {
				const item = await queue.next();
				if (item.kind === "done") {
					return;
				}
				if (item.kind === "error") {
					throw item.error;
				}
				yield item.event;
			}
		},
	};
}
