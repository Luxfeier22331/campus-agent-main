import type {
	SupervisorExecutionClient,
	SupervisorExecutionInput,
	SupervisorExecutionResponse,
} from "../../integration";
import { SupervisorTransportError } from "../../integration";
import { toHandledErrorTransportOutcome } from "./errors";
import {
	mapSupervisorLifecycleEvent,
	parseSupervisorSse,
	parseSupervisorTerminalResponse,
	supervisorStreamErrorResponse,
	toTerminalChatStreamEvent,
} from "./stream";
import type { ChatCommandResponse, ChatCommandStreamEvent } from "./types";

interface TransportErrorRecord {
	code: string;
	retryable: boolean;
}

export async function* streamLegacySupervisorExecution<Context>(input: {
	buildSupervisorInput(context: Context): Promise<SupervisorExecutionInput>;
	context: Context;
	executeStream: SupervisorExecutionClient["executeStream"] | undefined;
	finalizeAcceptedCommand(finalizeInput: {
		context: Context;
		executionResponse: SupervisorExecutionResponse;
		transportError?: TransportErrorRecord | null;
	}): Promise<ChatCommandResponse>;
	now: () => Date;
	traceId: string;
}): AsyncIterable<ChatCommandStreamEvent> {
	const { context, now } = input;
	if (!input.executeStream) {
		const error = new SupervisorTransportError({
			code: "dependency_not_ready",
			message: "Supervisor lifecycle stream is not configured.",
			retryable: true,
			status: 503,
		});
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

	let upstreamResponse: Response;
	try {
		upstreamResponse = await input.executeStream(await input.buildSupervisorInput(context));
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

	let sawTerminal = false;
	try {
		for await (const upstreamEvent of parseSupervisorSse(upstreamResponse)) {
			const lifecycleEvent = mapSupervisorLifecycleEvent({
				data: upstreamEvent.data,
				event: upstreamEvent.event,
				now,
			});
			if (lifecycleEvent) {
				yield lifecycleEvent;
				continue;
			}

			const terminal = parseSupervisorTerminalResponse({
				data: upstreamEvent.data,
				event: upstreamEvent.event,
				now,
			});
			if (!terminal) {
				continue;
			}

			sawTerminal = true;
			const finalized = await input.finalizeAcceptedCommand({
				context,
				executionResponse: terminal.response,
			});
			yield toTerminalChatStreamEvent({
				occurredAt: terminal.occurredAt,
				response: finalized,
				sourceEvent: terminal.sourceEvent,
			});
			break;
		}
	} catch (error) {
		const finalized = await input.finalizeAcceptedCommand({
			context,
			executionResponse: supervisorStreamErrorResponse({
				code: "supervisor_invalid_response",
				message:
					error instanceof Error
						? error.message
						: "Supervisor lifecycle stream violated the execution contract.",
				retryable: true,
				traceId: input.traceId,
			}),
			transportError: {
				code: "supervisor_invalid_response",
				retryable: true,
			},
		});
		yield toTerminalChatStreamEvent({
			occurredAt: now().toISOString(),
			response: finalized,
		});
		return;
	}

	if (!sawTerminal) {
		const finalized = await input.finalizeAcceptedCommand({
			context,
			executionResponse: supervisorStreamErrorResponse({
				code: "supervisor_invalid_response",
				message: "Supervisor lifecycle stream ended before a terminal event.",
				retryable: true,
				traceId: input.traceId,
			}),
			transportError: {
				code: "supervisor_invalid_response",
				retryable: true,
			},
		});
		yield toTerminalChatStreamEvent({
			occurredAt: now().toISOString(),
			response: finalized,
		});
	}
}
