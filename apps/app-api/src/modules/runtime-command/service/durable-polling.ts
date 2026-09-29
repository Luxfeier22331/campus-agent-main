import {
	type ExecutionControlRunEvent,
	type ExecutionControlRunEventPage,
	ExecutionControlTransportError,
	type ToolExecutionResponse,
} from "../../integration";
import {
	answerDeltaEventFromDurableRunEvent,
	chatStreamEventsForFinalized,
	type DurableRunEventContext,
	durableTerminalOutcomeFromDurableRunEvent,
	lifecycleEventFromDurableRunEvent,
} from "./durable";
import { createDurableCloseoutQueue } from "./durable-closeout-queue";
import { executionFinalizationErrorResponse } from "./stream";
import type {
	ChatCommandResponse,
	ChatCommandStreamEvent,
	DurableEventPollingPolicy,
} from "./types";

export const DEFAULT_DURABLE_EVENT_POLLING_POLICY = {
	maxAttempts: 36,
	waitMs: 25_000,
} as const;

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
	if (runEvent.requestId !== context.requestId) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Durable request event request_id does not match the accepted request.",
			retryable: true,
			status: 502,
		});
	}
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

function durableEventWaitTimeoutResponse(): ToolExecutionResponse {
	return executionFinalizationErrorResponse({
		code: "execution_timeout",
		message: "Durable run event polling budget expired before terminal finalization.",
		retryable: true,
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
		response: durableEventWaitTimeoutResponse(),
		terminalObserved: false,
	};
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
