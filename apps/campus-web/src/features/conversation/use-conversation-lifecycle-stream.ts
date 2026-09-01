import { useCallback } from "react";

import { ChatStreamRequestError } from "./api";
import type { RuntimeRunState } from "./conversation-run-types";
import type { ChatRequestStreamEvent } from "./model";
import type {
	ActiveRun,
	RunOperationMachine,
	RuntimeOperationIdentity,
} from "./run-operation-machine";

export async function* streamFromEvents(
	events: ChatRequestStreamEvent[],
): AsyncIterable<ChatRequestStreamEvent> {
	for (const event of events) {
		yield event;
		await Promise.resolve();
	}
}

export interface FollowLifecycleStreamInput {
	conversationId?: string;
	initialEvents: AsyncIterable<ChatRequestStreamEvent>;
	operation: RuntimeOperationIdentity;
}

export function useConversationLifecycleStream({
	appendAssistantDelta,
	applyRunStateEvent,
	applyTerminalEvent,
	holdAssistantDelta,
	operationMachine,
	ownsOperation,
	requestRunCancellation,
}: {
	appendAssistantDelta: (messageId: string, delta: string, occurredAt: string) => void;
	applyRunStateEvent: (event: ChatRequestStreamEvent, operationId: number) => RuntimeRunState;
	applyTerminalEvent: (
		event: ChatRequestStreamEvent,
		operation: RuntimeOperationIdentity,
	) => Promise<void>;
	holdAssistantDelta: (messageId: string, delta: string, occurredAt: string) => void;
	operationMachine: RunOperationMachine;
	ownsOperation: (operation: RuntimeOperationIdentity) => boolean;
	requestRunCancellation: (run: ActiveRun, operation: RuntimeOperationIdentity) => Promise<void>;
}) {
	const applyAnswerDelta = useCallback(
		(event: ChatRequestStreamEvent, operation: RuntimeOperationIdentity) => {
			if (!ownsOperation(operation)) {
				return;
			}
			const messageId = event.data.messageId?.trim();
			const delta = event.data.delta;
			if (!messageId || typeof delta !== "string" || delta.length === 0) {
				return;
			}
			const cancellation = operationMachine.cancellation;
			if (
				(cancellation.phase === "awaiting_request_id" ||
					cancellation.phase === "requesting" ||
					cancellation.phase === "acknowledged") &&
				cancellation.operationId === operation.id
			) {
				holdAssistantDelta(messageId, delta, event.data.occurredAt);
				return;
			}
			appendAssistantDelta(messageId, delta, event.data.occurredAt);
		},
		[appendAssistantDelta, holdAssistantDelta, operationMachine, ownsOperation],
	);

	const consumeLifecycleStream = useCallback(
		async (
			events: AsyncIterable<ChatRequestStreamEvent>,
			conversationId: string | undefined,
			operation: RuntimeOperationIdentity,
		): Promise<{ terminal: boolean }> => {
			for await (const event of events) {
				if (!ownsOperation(operation)) {
					return { terminal: true };
				}
				applyRunStateEvent(event, operation.id);
				if (event.event === "request.accepted" && event.data.requestId) {
					const acceptedRun: ActiveRun = {
						...(conversationId ? { conversationId } : {}),
						requestId: event.data.requestId,
						...(event.data.sequence === undefined ? {} : { sequence: event.data.sequence }),
					};
					operationMachine.replaceActiveRun(acceptedRun);
					const cancellation = operationMachine.cancellation;
					if (
						cancellation.phase === "awaiting_request_id" &&
						cancellation.operationId === operation.id
					) {
						void requestRunCancellation(acceptedRun, operation);
					}
				}
				if (event.data.requestId) {
					operationMachine.updateActiveRun((current) => ({
						...((current?.conversationId ?? conversationId)
							? { conversationId: current?.conversationId ?? conversationId }
							: {}),
						requestId: event.data.requestId,
						...((event.data.sequence ?? current?.sequence) === undefined
							? {}
							: { sequence: event.data.sequence ?? current?.sequence }),
					}));
				}
				if (event.event === "answer.delta") {
					applyAnswerDelta(event, operation);
				}
				if (
					event.event === "request.completed" ||
					event.event === "request.failed" ||
					event.event === "request.cancelled"
				) {
					await applyTerminalEvent(event, operation);
					return { terminal: true };
				}
			}
			return { terminal: false };
		},
		[
			applyAnswerDelta,
			applyRunStateEvent,
			applyTerminalEvent,
			operationMachine,
			ownsOperation,
			requestRunCancellation,
		],
	);

	const followLifecycleStream = useCallback(
		async (input: FollowLifecycleStreamInput) => {
			if (!ownsOperation(input.operation)) {
				return;
			}
			const consumed = await consumeLifecycleStream(
				input.initialEvents,
				input.conversationId,
				input.operation,
			);
			if (!(consumed.terminal || input.operation.controller.signal.aborted)) {
				throw new ChatStreamRequestError({
					code: "chat_stream_connection_lost",
					message: "回答连接已断开。",
					retryable: true,
					requestId: operationMachine.activeRun?.requestId,
				});
			}
		},
		[consumeLifecycleStream, operationMachine, ownsOperation],
	);

	return { consumeLifecycleStream, followLifecycleStream };
}
