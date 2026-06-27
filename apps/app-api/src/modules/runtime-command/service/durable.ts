import {
	type ExecutionControlRunEvent,
	ExecutionControlTransportError,
	parseExecutionFinalizationResponsePayload,
	type ToolExecutionResponse,
} from "../../integration";
import { toHandledErrorTransportOutcome } from "./errors";
import { executionFinalizationErrorResponse, toTerminalChatStreamEvent } from "./stream";
import type { ChatCommandResponse, ChatCommandStreamEvent } from "./types";

export const DEFAULT_DURABLE_EVENT_POLLING_POLICY = {
	maxAttempts: 4,
	pollIntervalMs: 1000,
	waitMs: 25_000,
} as const;

interface DurableRunEventContext {
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
	transportError: TransportErrorRecord | null;
}

export interface DurableEventPollingPolicy {
	maxAttempts: number;
	pollIntervalMs: number;
	sleep?: (durationMs: number) => Promise<void>;
	waitMs?: number;
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
			accumulatedText: assistantMessage.text,
			delta: assistantMessage.text,
			messageId: assistantMessage.id,
			occurredAt: input.occurredAt,
			requestId: input.context.requestId,
			runId: input.context.runId,
			sequence: input.sequence,
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
		sourceEvent: input.sourceEvent,
	});
	if (input.hasStreamedAnswerDelta) {
		return [terminal];
	}
	const delta = answerDeltaEvent({
		context: input.context,
		finalized: input.finalized,
		occurredAt: input.occurredAt,
		sequence: input.sequence,
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
	const delta = getRequiredString(
		event.payload,
		"delta",
		"Durable answer delta event delta is required.",
	);
	const accumulatedText = getRequiredString(
		event.payload,
		"accumulated_text",
		"Durable answer delta event accumulated_text is required.",
	);
	return {
		data: {
			accumulatedText,
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
	if (event.eventType === "run.queued") {
		return {
			data: {
				occurredAt: event.occurredAt,
				requestId: context.requestId,
				status: "queued",
				traceId: context.traceId,
			},
			event: "execution.queued",
		};
	}
	if (event.eventType === "run.started") {
		return {
			data: {
				occurredAt: event.occurredAt,
				requestId: context.requestId,
				status: "running",
				traceId: context.traceId,
			},
			event: "execution.running",
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
	if (event.eventType !== "finalization.completed") {
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
				transportError: null,
			};
		}
		if (event.eventType !== "run.failed") {
			return null;
		}
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
		);
		const message = getRequiredString(
			error,
			"message",
			"Durable run failed event error.message is required.",
		);
		const retryable = getRequiredBoolean(
			error,
			"retryable",
			"Durable run failed event error.retryable is required.",
		);
		return {
			response: executionFinalizationErrorResponse({
				code,
				message,
				retryable,
				traceId: context.traceId,
			}),
			sourceEvent: "execution.failed",
			transportError: {
				code,
				retryable,
			},
		};
	}
	assertDurableEventRunMatches(
		context,
		event,
		"Durable finalization event run_id does not match the accepted run.",
	);
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
		transportError: null,
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

interface TransportErrorRecord {
	code: string;
	retryable: boolean;
}

function validatePollingPolicy(
	policy?: DurableEventPollingPolicy,
): Required<DurableEventPollingPolicy> {
	const maxAttempts = policy?.maxAttempts ?? DEFAULT_DURABLE_EVENT_POLLING_POLICY.maxAttempts;
	const pollIntervalMs =
		policy?.pollIntervalMs ?? DEFAULT_DURABLE_EVENT_POLLING_POLICY.pollIntervalMs;
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
		throw new ExecutionControlTransportError({
			code: "runtime_invariant_failed",
			message: "Durable event polling maxAttempts must be a positive integer.",
			retryable: false,
			status: 500,
		});
	}
	if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0) {
		throw new ExecutionControlTransportError({
			code: "runtime_invariant_failed",
			message: "Durable event polling pollIntervalMs must be a non-negative integer.",
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
		pollIntervalMs,
		sleep:
			policy?.sleep ??
			((durationMs) => new Promise<void>((resolve) => setTimeout(resolve, durationMs))),
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

function durableEventWaitTimeoutResponse(context: DurableRunEventContext): ToolExecutionResponse {
	return executionFinalizationErrorResponse({
		code: "execution_timeout",
		message: "Durable run event polling budget expired before terminal finalization.",
		retryable: true,
		traceId: context.traceId,
	});
}

export async function waitForDurableFinalizationResponse<
	Context extends DurableRunEventContext,
>(input: {
	context: Context;
	listRunEvents(afterSequence: number, waitMs?: number): Promise<ExecutionControlRunEvent[]>;
	polling?: DurableEventPollingPolicy;
}): Promise<{
	response: ToolExecutionResponse;
	transportError: TransportErrorRecord | null;
}> {
	const polling = validatePollingPolicy(input.polling);
	let lastSequence = 0;
	let emptyPollAttempts = 0;

	while (emptyPollAttempts < polling.maxAttempts) {
		const runEvents = await input.listRunEvents(lastSequence, polling.waitMs);
		if (runEvents.length === 0) {
			emptyPollAttempts += 1;
		} else {
			emptyPollAttempts = 0;
		}
		for (const runEvent of runEvents) {
			lastSequence = updateLastSequence(input.context, lastSequence, runEvent);
			const terminalOutcome = durableTerminalOutcomeFromDurableRunEvent(input.context, runEvent);
			if (terminalOutcome) {
				return {
					response: terminalOutcome.response,
					transportError: terminalOutcome.transportError,
				};
			}
		}
		if (emptyPollAttempts < polling.maxAttempts && polling.pollIntervalMs > 0) {
			await polling.sleep(polling.pollIntervalMs);
		}
	}

	return {
		response: durableEventWaitTimeoutResponse(input.context),
		transportError: {
			code: "execution_timeout",
			retryable: true,
		},
	};
}

export async function* streamDurableRunEventsUntilTerminal<
	Context extends DurableRunEventContext,
>(input: {
	context: Context;
	finalizeAcceptedCommand(finalizeInput: {
		context: Context;
		executionResponse: ToolExecutionResponse;
		transportError?: TransportErrorRecord | null;
	}): Promise<ChatCommandResponse>;
	listRunEvents(afterSequence: number, waitMs?: number): Promise<ExecutionControlRunEvent[]>;
	now: () => Date;
	polling?: DurableEventPollingPolicy;
}): AsyncIterable<ChatCommandStreamEvent> {
	const { context, now } = input;
	const polling = validatePollingPolicy(input.polling);
	let lastSequence = 0;
	let emptyPollAttempts = 0;
	let hasStreamedAnswerDelta = false;
	try {
		while (emptyPollAttempts < polling.maxAttempts) {
			const runEvents = await input.listRunEvents(lastSequence, polling.waitMs);
			if (runEvents.length === 0) {
				emptyPollAttempts += 1;
			} else {
				emptyPollAttempts = 0;
			}
			for (const runEvent of runEvents) {
				lastSequence = updateLastSequence(context, lastSequence, runEvent);
				const lifecycleEvent = lifecycleEventFromDurableRunEvent(context, runEvent);
				if (lifecycleEvent) {
					yield lifecycleEvent;
					continue;
				}
				const answerDelta = answerDeltaEventFromDurableRunEvent(context, runEvent);
				if (answerDelta) {
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
					transportError: terminalOutcome.transportError,
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
			if (emptyPollAttempts < polling.maxAttempts && polling.pollIntervalMs > 0) {
				await polling.sleep(polling.pollIntervalMs);
			}
		}
	} catch (error) {
		const handled = toHandledErrorTransportOutcome(error);
		const finalized = await input.finalizeAcceptedCommand({
			context,
			executionResponse: handled,
			transportError: {
				code: handled.error.code,
				retryable: handled.error.retryable,
			},
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
		transportError: {
			code: "execution_timeout",
			retryable: true,
		},
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

type DurableCloseoutQueueItem =
	| {
			event: ChatCommandStreamEvent;
			kind: "event";
	  }
	| {
			kind: "done";
	  }
	| {
			error: unknown;
			kind: "error";
	  };

function createDurableCloseoutQueue() {
	const items: DurableCloseoutQueueItem[] = [];
	const waiters: Array<(item: DurableCloseoutQueueItem) => void> = [];

	function push(item: DurableCloseoutQueueItem) {
		const waiter = waiters.shift();
		if (waiter) {
			waiter(item);
			return;
		}
		items.push(item);
	}

	async function next(): Promise<DurableCloseoutQueueItem> {
		const item = items.shift();
		if (item) {
			return item;
		}
		return new Promise<DurableCloseoutQueueItem>((resolve) => {
			waiters.push(resolve);
		});
	}

	return { next, push };
}

export function startDurableFinalizationCloseout<Context extends DurableRunEventContext>(input: {
	context: Context;
	finalizeAcceptedCommand(finalizeInput: {
		context: Context;
		executionResponse: ToolExecutionResponse;
		transportError?: TransportErrorRecord | null;
	}): Promise<ChatCommandResponse>;
	listRunEvents(afterSequence: number, waitMs?: number): Promise<ExecutionControlRunEvent[]>;
	now: () => Date;
	polling?: DurableEventPollingPolicy;
}): {
	completion: Promise<ChatCommandResponse>;
	streamEvents(): AsyncIterable<ChatCommandStreamEvent>;
} {
	const { context, now } = input;
	const polling = validatePollingPolicy(input.polling);
	const queue = createDurableCloseoutQueue();

	const completion = (async () => {
		let lastSequence = 0;
		let emptyPollAttempts = 0;
		let hasStreamedAnswerDelta = false;
		try {
			while (emptyPollAttempts < polling.maxAttempts) {
				const runEvents = await input.listRunEvents(lastSequence, polling.waitMs);
				if (runEvents.length === 0) {
					emptyPollAttempts += 1;
				} else {
					emptyPollAttempts = 0;
				}
				for (const runEvent of runEvents) {
					lastSequence = updateLastSequence(context, lastSequence, runEvent);
					const lifecycleEvent = lifecycleEventFromDurableRunEvent(context, runEvent);
					if (lifecycleEvent) {
						queue.push({ event: lifecycleEvent, kind: "event" });
						continue;
					}
					const answerDelta = answerDeltaEventFromDurableRunEvent(context, runEvent);
					if (answerDelta) {
						hasStreamedAnswerDelta = true;
						queue.push({ event: answerDelta, kind: "event" });
						continue;
					}
					const terminalOutcome = durableTerminalOutcomeFromDurableRunEvent(context, runEvent);
					if (!terminalOutcome) {
						continue;
					}
					const finalized = await input.finalizeAcceptedCommand({
						context,
						executionResponse: terminalOutcome.response,
						transportError: terminalOutcome.transportError,
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
				if (emptyPollAttempts < polling.maxAttempts && polling.pollIntervalMs > 0) {
					await polling.sleep(polling.pollIntervalMs);
				}
			}
		} catch (error) {
			const handled = toHandledErrorTransportOutcome(error);
			const finalized = await input.finalizeAcceptedCommand({
				context,
				executionResponse: handled,
				transportError: {
					code: handled.error.code,
					retryable: handled.error.retryable,
				},
			});
			for (const event of chatStreamEventsForFinalized({
				context,
				finalized,
				hasStreamedAnswerDelta,
				occurredAt: now().toISOString(),
			})) {
				queue.push({ event, kind: "event" });
			}
			queue.push({ kind: "done" });
			return finalized;
		}

		const finalized = await input.finalizeAcceptedCommand({
			context,
			executionResponse: durableEventWaitTimeoutResponse(context),
			transportError: {
				code: "execution_timeout",
				retryable: true,
			},
		});
		for (const event of chatStreamEventsForFinalized({
			context,
			finalized,
			hasStreamedAnswerDelta,
			occurredAt: now().toISOString(),
		})) {
			queue.push({ event, kind: "event" });
		}
		queue.push({ kind: "done" });
		return finalized;
	})().catch((error) => {
		queue.push({ error, kind: "error" });
		throw error;
	});

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
