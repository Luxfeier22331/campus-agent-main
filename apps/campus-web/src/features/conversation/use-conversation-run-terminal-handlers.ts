import { useCallback } from "react";
import { UnauthorizedError } from "@/platform/api/client";

import { type ChatRunStatus, ChatStreamRequestError } from "./api";
import { toAssistantThreadMessages } from "./assistant-ui-mappers";
import type { RuntimeMessages } from "./assistant-ui-message-projection";
import { isAbortError } from "./assistant-ui-recovery-policy";
import type { ConversationInitializationRegistry } from "./conversation-initialization";
import type { RuntimeRunAction, RuntimeRunState } from "./conversation-run-types";
import type { ChatRequestStreamEvent } from "./model";
import type { RunOperationMachine, RuntimeOperationIdentity } from "./run-operation-machine";

export function useConversationRunTerminalHandlers({
	appendLocalErrorMessage,
	applyRunStateAction,
	clearPendingAssistantDeltas,
	fetchConversationMessages,
	initializationRegistry,
	operationMachine,
	ownsOperation,
	remoteId,
	replaceWithCanonicalMessages,
	runStateRef,
	setIsRunning,
}: {
	appendLocalErrorMessage: (error: ChatStreamRequestError) => void;
	applyRunStateAction: (action: RuntimeRunAction) => RuntimeRunState;
	clearPendingAssistantDeltas: () => void;
	fetchConversationMessages: (
		conversationId: string,
		signal?: AbortSignal,
	) => Promise<RuntimeMessages>;
	initializationRegistry: ConversationInitializationRegistry;
	operationMachine: RunOperationMachine;
	ownsOperation: (operation: RuntimeOperationIdentity) => boolean;
	remoteId: string | undefined;
	replaceWithCanonicalMessages: (messages: RuntimeMessages) => void;
	runStateRef: { current: RuntimeRunState };
	setIsRunning: (isRunning: boolean) => void;
}) {
	const applyTerminalEvent = useCallback(
		async (event: ChatRequestStreamEvent, operation: RuntimeOperationIdentity) => {
			if (!ownsOperation(operation)) {
				return;
			}
			clearPendingAssistantDeltas();
			const conversationId =
				event.data.answer?.conversation.id ??
				operationMachine.activeRun?.conversationId ??
				remoteId;
			operationMachine.cancellation = { phase: "idle" };
			setIsRunning(false);
			operationMachine.replaceActiveRun(null);
			if (conversationId && initializationRegistry.local?.conversationId === conversationId) {
				initializationRegistry.local = null;
			}
			const terminalError =
				event.event === "request.failed" && event.data.error
					? new ChatStreamRequestError({
							code: event.data.error.code,
							message: event.data.error.message,
							requestId: event.data.requestId,
							retryable: event.data.error.retryable ?? true,
						})
					: null;
			if (event.event === "request.cancelled") {
				return;
			}
			if (event.data.answer) {
				const terminalMessages = toAssistantThreadMessages(event.data.answer.conversation);
				replaceWithCanonicalMessages(terminalMessages);
				return;
			}
			if (conversationId) {
				try {
					const nextMessages = await fetchConversationMessages(
						conversationId,
						operation.controller.signal,
					);
					if (ownsOperation(operation)) {
						replaceWithCanonicalMessages(nextMessages);
						return;
					}
				} catch (error) {
					if (error instanceof UnauthorizedError || isAbortError(error)) {
						throw error;
					}
					if (ownsOperation(operation) && !terminalError) {
						appendLocalErrorMessage(
							new ChatStreamRequestError({
								code: "conversation_refresh_failed",
								message: "回答已完成，但会话内容暂时无法刷新。",
								retryable: true,
								requestId: event.data.requestId,
							}),
						);
					}
				}
			}
			if (terminalError && ownsOperation(operation)) {
				appendLocalErrorMessage(terminalError);
			}
		},
		[
			appendLocalErrorMessage,
			clearPendingAssistantDeltas,
			fetchConversationMessages,
			initializationRegistry,
			operationMachine,
			ownsOperation,
			remoteId,
			replaceWithCanonicalMessages,
			setIsRunning,
		],
	);

	const applyTerminalRunStatus = useCallback(
		async (status: ChatRunStatus, operation: RuntimeOperationIdentity) => {
			if (!ownsOperation(operation)) {
				return;
			}
			clearPendingAssistantDeltas();
			applyRunStateAction({
				operationId: operation.id,
				run: status,
				sequence: runStateRef.current.sequence,
				type: "hydrate",
			});
			operationMachine.cancellation = { phase: "idle" };
			setIsRunning(false);
			operationMachine.replaceActiveRun(null);
			if (initializationRegistry.local?.conversationId === status.conversationId) {
				initializationRegistry.local = null;
			}
			try {
				const nextMessages = await fetchConversationMessages(
					status.conversationId,
					operation.controller.signal,
				);
				if (ownsOperation(operation)) {
					replaceWithCanonicalMessages(nextMessages);
				}
			} catch (error) {
				if (error instanceof UnauthorizedError || isAbortError(error)) {
					throw error;
				}
				if (ownsOperation(operation)) {
					appendLocalErrorMessage(
						new ChatStreamRequestError({
							code: "conversation_refresh_failed",
							message: "回答已结束，但会话内容暂时无法刷新。",
							requestId: status.requestId,
							retryable: true,
						}),
					);
				}
			}
		},
		[
			appendLocalErrorMessage,
			applyRunStateAction,
			clearPendingAssistantDeltas,
			fetchConversationMessages,
			initializationRegistry,
			operationMachine,
			ownsOperation,
			replaceWithCanonicalMessages,
			runStateRef,
			setIsRunning,
		],
	);

	return { applyTerminalEvent, applyTerminalRunStatus };
}
