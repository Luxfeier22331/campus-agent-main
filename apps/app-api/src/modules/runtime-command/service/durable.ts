import {
	type ExecutionControlRunEvent,
	ExecutionControlTransportError,
	parseSupervisorExecutionResponsePayload,
	type SupervisorExecutionResponse,
} from "../../integration";
import { toHandledErrorTransportOutcome } from "./errors";
import { supervisorStreamErrorResponse, toTerminalChatStreamEvent } from "./stream";
import type { ChatCommandResponse, ChatCommandStreamEvent } from "./types";

export const DEFAULT_DURABLE_EVENT_POLLING_POLICY = {
	maxAttempts: 160,
	pollIntervalMs: 500,
} as const;

interface DurableRunEventContext {
	requestId: string;
	runId: string | null;
	traceId: string;
}

export interface DurableEventPollingPolicy {
	maxAttempts: number;
	pollIntervalMs: number;
	sleep?: (durationMs: number) => Promise<void>;
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
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
): SupervisorExecutionResponse | null {
	if (event.eventType !== "finalization.completed") {
		return null;
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
	return parseSupervisorExecutionResponsePayload(response);
}

export function finalizationResponseFromDurableRunEvents(
	context: DurableRunEventContext,
	runEvents: ExecutionControlRunEvent[],
): SupervisorExecutionResponse | null {
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
	return {
		maxAttempts,
		pollIntervalMs,
		sleep:
			policy?.sleep ??
			((durationMs) => new Promise<void>((resolve) => setTimeout(resolve, durationMs))),
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

function durableEventWaitTimeoutResponse(
	context: DurableRunEventContext,
): SupervisorExecutionResponse {
	return supervisorStreamErrorResponse({
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
	listRunEvents(afterSequence: number): Promise<ExecutionControlRunEvent[]>;
	polling?: DurableEventPollingPolicy;
}): Promise<{
	response: SupervisorExecutionResponse;
	transportError: TransportErrorRecord | null;
}> {
	const polling = validatePollingPolicy(input.polling);
	let lastSequence = 0;

	for (let attempt = 0; attempt < polling.maxAttempts; attempt += 1) {
		const runEvents = await input.listRunEvents(lastSequence);
		for (const runEvent of runEvents) {
			lastSequence = updateLastSequence(input.context, lastSequence, runEvent);
			const finalizationResponse = finalizationResponseFromDurableRunEvent(input.context, runEvent);
			if (finalizationResponse) {
				return {
					response: finalizationResponse,
					transportError: null,
				};
			}
		}
		if (attempt + 1 < polling.maxAttempts && polling.pollIntervalMs > 0) {
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
		executionResponse: SupervisorExecutionResponse;
		transportError?: TransportErrorRecord | null;
	}): Promise<ChatCommandResponse>;
	listRunEvents(afterSequence: number): Promise<ExecutionControlRunEvent[]>;
	now: () => Date;
	polling?: DurableEventPollingPolicy;
}): AsyncIterable<ChatCommandStreamEvent> {
	const { context, now } = input;
	const polling = validatePollingPolicy(input.polling);
	let lastSequence = 0;
	try {
		for (let attempt = 0; attempt < polling.maxAttempts; attempt += 1) {
			const runEvents = await input.listRunEvents(lastSequence);
			for (const runEvent of runEvents) {
				lastSequence = updateLastSequence(context, lastSequence, runEvent);
				const lifecycleEvent = lifecycleEventFromDurableRunEvent(context, runEvent);
				if (lifecycleEvent) {
					yield lifecycleEvent;
					continue;
				}
				const finalizationResponse = finalizationResponseFromDurableRunEvent(context, runEvent);
				if (!finalizationResponse) {
					continue;
				}
				const finalized = await input.finalizeAcceptedCommand({
					context,
					executionResponse: finalizationResponse,
				});
				yield toTerminalChatStreamEvent({
					occurredAt: runEvent.occurredAt,
					response: finalized,
					sourceEvent: "execution.completed",
				});
				return;
			}
			if (attempt + 1 < polling.maxAttempts && polling.pollIntervalMs > 0) {
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
		yield toTerminalChatStreamEvent({
			occurredAt: now().toISOString(),
			response: finalized,
		});
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
	yield toTerminalChatStreamEvent({
		occurredAt: now().toISOString(),
		response: finalized,
	});
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
		executionResponse: SupervisorExecutionResponse;
		transportError?: TransportErrorRecord | null;
	}): Promise<ChatCommandResponse>;
	listRunEvents(afterSequence: number): Promise<ExecutionControlRunEvent[]>;
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
		try {
			for (let attempt = 0; attempt < polling.maxAttempts; attempt += 1) {
				const runEvents = await input.listRunEvents(lastSequence);
				for (const runEvent of runEvents) {
					lastSequence = updateLastSequence(context, lastSequence, runEvent);
					const lifecycleEvent = lifecycleEventFromDurableRunEvent(context, runEvent);
					if (lifecycleEvent) {
						queue.push({ event: lifecycleEvent, kind: "event" });
						continue;
					}
					const finalizationResponse = finalizationResponseFromDurableRunEvent(context, runEvent);
					if (!finalizationResponse) {
						continue;
					}
					const finalized = await input.finalizeAcceptedCommand({
						context,
						executionResponse: finalizationResponse,
					});
					queue.push({
						event: toTerminalChatStreamEvent({
							occurredAt: runEvent.occurredAt,
							response: finalized,
							sourceEvent: "execution.completed",
						}),
						kind: "event",
					});
					queue.push({ kind: "done" });
					return finalized;
				}
				if (attempt + 1 < polling.maxAttempts && polling.pollIntervalMs > 0) {
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
			queue.push({
				event: toTerminalChatStreamEvent({
					occurredAt: now().toISOString(),
					response: finalized,
				}),
				kind: "event",
			});
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
		queue.push({
			event: toTerminalChatStreamEvent({
				occurredAt: now().toISOString(),
				response: finalized,
			}),
			kind: "event",
		});
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
