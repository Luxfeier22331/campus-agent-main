import { useCallback, useEffect, useRef, useState } from "react";
import { createIdempotencyKey, UnauthorizedError } from "@/platform/api/client";
import {
	ChatStreamRequestError,
	deleteTrailingMessages,
	getConversationDetail,
	submitChatRequestStream,
} from "./api";
import { toAssistantThreadMessages } from "./assistant-ui-mappers";
import { isAbortError } from "./assistant-ui-recovery-policy";
import { ConversationInitializationRegistry } from "./conversation-initialization";
import type { ConversationRunPromptInput } from "./conversation-run-types";
import {
	type ActiveRun,
	RunOperationMachine,
	type RuntimeOperationIdentity,
} from "./run-operation-machine";
import { useAssistantUiMessageProjection } from "./use-assistant-ui-message-projection";
import { useConversationLifecycleStream } from "./use-conversation-lifecycle-stream";
import { useConversationRunCancellation } from "./use-conversation-run-cancellation";
import { useConversationRunRecovery } from "./use-conversation-run-recovery";
import { useConversationRunState } from "./use-conversation-run-state";
import { useConversationRunTerminalHandlers } from "./use-conversation-run-terminal-handlers";
import { usePendingAssistantDeltas } from "./use-pending-assistant-deltas";

export function useConversationRunCoordinator({
	loginRequired,
	onLoginRequired,
	remoteId,
	threadId,
}: {
	loginRequired: boolean;
	onLoginRequired: () => void;
	remoteId: string | undefined;
	threadId: string;
}) {
	const [isLoading, setIsLoading] = useState(false);
	const [isRunning, setIsRunning] = useState(false);
	const operationMachineRef = useRef(new RunOperationMachine());
	const initializationRegistryRef = useRef(new ConversationInitializationRegistry());
	const {
		appendAssistantDelta,
		appendLocalErrorMessage,
		appendLocalUserMessage,
		clearMessages,
		messages,
		removeMessage,
		replaceWithCanonicalMessages,
		setRuntimeMessages,
		truncateMessagesFrom,
	} = useAssistantUiMessageProjection();
	const { applyRunStateAction, applyRunStateEvent, markRunDisconnected, runState, runStateRef } =
		useConversationRunState();
	const { clearPendingAssistantDeltas, holdAssistantDelta, revealPendingAssistantDeltas } =
		usePendingAssistantDeltas(appendAssistantDelta);

	const replaceActiveRun = useCallback((run: ActiveRun | null) => {
		operationMachineRef.current.replaceActiveRun(run);
	}, []);

	const updateActiveRun = useCallback((update: (current: ActiveRun | null) => ActiveRun | null) => {
		operationMachineRef.current.updateActiveRun(update);
	}, []);

	const fetchConversationDetail = useCallback(
		async (conversationId: string, signal?: AbortSignal) =>
			getConversationDetail(conversationId, signal),
		[],
	);

	const fetchConversationMessages = useCallback(
		async (conversationId: string, signal?: AbortSignal) => {
			const conversation = await fetchConversationDetail(conversationId, signal);
			return toAssistantThreadMessages(conversation);
		},
		[fetchConversationDetail],
	);

	const startOperation = useCallback((): RuntimeOperationIdentity => {
		clearPendingAssistantDeltas();
		return operationMachineRef.current.start();
	}, [clearPendingAssistantDeltas]);

	const ownsOperation = useCallback(
		(operation: RuntimeOperationIdentity): boolean =>
			operationMachineRef.current.ownedBy(operation),
		[],
	);
	const { applyTerminalEvent, applyTerminalRunStatus } = useConversationRunTerminalHandlers({
		appendLocalErrorMessage,
		applyRunStateAction,
		clearPendingAssistantDeltas,
		fetchConversationMessages,
		initializationRegistry: initializationRegistryRef.current,
		operationMachine: operationMachineRef.current,
		ownsOperation,
		remoteId,
		replaceWithCanonicalMessages,
		runStateRef,
		setIsRunning,
	});

	const requiresConversationInitialization = useCallback(
		(conversationId: string | undefined): boolean =>
			!conversationId || initializationRegistryRef.current.get(threadId) !== undefined,
		[threadId],
	);

	const { onCancel, requestRunCancellation } = useConversationRunCancellation({
		appendLocalErrorMessage,
		applyRunStateAction,
		applyTerminalRunStatus,
		initializationRegistry: initializationRegistryRef.current,
		isRunning,
		onLoginRequired,
		operationMachine: operationMachineRef.current,
		ownsOperation,
		removeMessage,
		revealPendingAssistantDeltas,
		runStateRef,
		setIsRunning,
		startOperation,
	});

	useEffect(
		() => () => {
			operationMachineRef.current.invalidate();
			clearPendingAssistantDeltas();
			initializationRegistryRef.current.clear();
		},
		[clearPendingAssistantDeltas],
	);

	const { consumeLifecycleStream, followLifecycleStream } = useConversationLifecycleStream({
		appendAssistantDelta,
		applyRunStateEvent,
		applyTerminalEvent,
		holdAssistantDelta,
		operationMachine: operationMachineRef.current,
		ownsOperation,
		requestRunCancellation,
	});
	const { onResume, restoreConversationRun } = useConversationRunRecovery({
		applyRunStateAction,
		applyTerminalRunStatus,
		consumeLifecycleStream,
		fetchConversationMessages,
		followLifecycleStream,
		markRunDisconnected,
		onLoginRequired,
		operationMachine: operationMachineRef.current,
		ownsOperation,
		replaceWithCanonicalMessages,
		setIsRunning,
		startOperation,
		updateActiveRun,
	});

	useEffect(() => {
		const locallyInitializedRunConversation = initializationRegistryRef.current.local;
		const pendingInitialization = initializationRegistryRef.current.get(threadId);
		if (
			remoteId &&
			((locallyInitializedRunConversation?.conversationId === remoteId &&
				locallyInitializedRunConversation.operationId === operationMachineRef.current.operationId &&
				locallyInitializedRunConversation.threadId === threadId) ||
				pendingInitialization !== undefined)
		) {
			return;
		}

		clearPendingAssistantDeltas();
		const operation = operationMachineRef.current.begin();
		const operationId = operation.id;
		const controller = operation.controller;
		operationMachineRef.current.cancellation = { phase: "idle" };
		replaceActiveRun(null);
		applyRunStateAction({ operationId, type: "reset" });
		setIsRunning(false);
		if (!remoteId) {
			operationMachineRef.current.controller = null;
			clearMessages();
			return;
		}

		let cancelled = false;
		setIsLoading(true);
		fetchConversationDetail(remoteId, controller.signal)
			.then((conversation) => {
				if (cancelled || !ownsOperation(operation)) {
					return;
				}
				setIsLoading(false);
				return restoreConversationRun(remoteId, conversation, operation);
			})
			.catch((error: unknown) => {
				if (
					cancelled ||
					operationMachineRef.current.operationId !== operationId ||
					isAbortError(error)
				) {
					return;
				}
				if (error instanceof UnauthorizedError) {
					onLoginRequired();
					return;
				}
				if (error instanceof ChatStreamRequestError) {
					appendLocalErrorMessage(error);
				}
			})
			.finally(() => {
				if (!cancelled && operationMachineRef.current.operationId === operationId) {
					setIsLoading(false);
				}
			});

		return () => {
			cancelled = true;
			controller.abort();
			if (operationMachineRef.current.operationId === operationId) {
				operationMachineRef.current.invalidate();
			}
		};
	}, [
		appendLocalErrorMessage,
		applyRunStateAction,
		clearMessages,
		clearPendingAssistantDeltas,
		fetchConversationDetail,
		onLoginRequired,
		ownsOperation,
		remoteId,
		replaceActiveRun,
		restoreConversationRun,
		threadId,
	]);

	const runPrompt = useCallback(
		async (input: ConversationRunPromptInput) => {
			const prompt = input.prompt.trim();
			if (!prompt) {
				throw new Error("Message text is required.");
			}
			if (loginRequired) {
				onLoginRequired();
				return;
			}
			const operation = startOperation();
			const controller = operation.controller;
			const localMessageId = `local-user-${crypto.randomUUID()}`;
			const acceptedAt = new Date().toISOString();
			replaceActiveRun(null);
			applyRunStateAction({
				acceptedAt,
				operationId: operation.id,
				type: "start",
			});
			operationMachineRef.current.cancellation = input.initializationTarget
				? { localMessageId, operationId: operation.id, phase: "initializing" }
				: { phase: "idle" };
			if (input.truncateFromMessageId) {
				truncateMessagesFrom(input.truncateFromMessageId);
			}
			appendLocalUserMessage(input.messageContent, localMessageId);
			setIsRunning(true);

			let initializationCleanupFailed = false;
			try {
				let conversationId = input.conversationId;
				if (input.initializationTarget) {
					const target = input.initializationTarget;
					const initialization = initializationRegistryRef.current.getOrCreate(
						target,
						operation.id,
					);
					try {
						conversationId = await initialization.initializeTask;
					} catch (error) {
						if (
							!initializationRegistryRef.current.ownedBy(
								target.threadId,
								initialization,
								operation.id,
							)
						) {
							return;
						}
						initializationRegistryRef.current.delete(target.threadId, initialization);
						if (!ownsOperation(operation)) {
							return;
						}
						operationMachineRef.current.cancellation = { phase: "idle" };
						if (
							error instanceof UnauthorizedError ||
							isAbortError(error) ||
							error instanceof ChatStreamRequestError
						) {
							throw error;
						}
						throw new ChatStreamRequestError({
							code: "conversation_initialization_failed",
							message:
								error instanceof Error && error.message.trim()
									? error.message
									: "创建会话失败，请稍后重试。",
							retryable: true,
						});
					}
					if (
						!initializationRegistryRef.current.ownedBy(
							target.threadId,
							initialization,
							operation.id,
						)
					) {
						return;
					}
					if (!ownsOperation(operation)) {
						try {
							await initialization.deleteThread();
						} catch (error) {
							initializationCleanupFailed = true;
							throw error;
						} finally {
							initializationRegistryRef.current.delete(target.threadId, initialization);
						}
						return;
					}
					operationMachineRef.current.cancellation = { phase: "idle" };
					if (conversationId) {
						initializationRegistryRef.current.local = {
							conversationId,
							operationId: operation.id,
							threadId: target.threadId,
						};
					}
					initializationRegistryRef.current.delete(target.threadId, initialization);
				}
				if (input.truncateFromMessageId && conversationId) {
					await deleteTrailingMessages({
						conversationId,
						messageId: input.truncateFromMessageId,
					});
				}
				if (!ownsOperation(operation)) {
					return;
				}
				const idempotencyKey = createIdempotencyKey();
				const submitEvents = () =>
					submitChatRequestStream({
						...(conversationId ? { conversationId } : {}),
						idempotencyKey,
						prompt,
						signal: controller.signal,
					});
				await followLifecycleStream({
					...(conversationId ? { conversationId } : {}),
					operation,
					initialEvents: submitEvents(),
				});
			} catch (error) {
				if (initializationCleanupFailed) {
					throw error;
				}
				if (!ownsOperation(operation)) {
					return;
				}
				const acceptedRun = operationMachineRef.current.activeRun;
				setIsRunning(Boolean(acceptedRun));
				if (error instanceof UnauthorizedError) {
					if (operationMachineRef.current.activeRun) {
						markRunDisconnected(operation.id, operationMachineRef.current.activeRun.requestId);
					}
					onLoginRequired();
					return;
				}
				if (isAbortError(error)) {
					return;
				}
				if (error instanceof ChatStreamRequestError) {
					if (acceptedRun) {
						markRunDisconnected(operation.id, acceptedRun.requestId);
						operationMachineRef.current.cancellation = { phase: "idle" };
						return;
					}
					operationMachineRef.current.cancellation = { phase: "idle" };
					appendLocalErrorMessage(error);
					return;
				}
				throw error;
			} finally {
				operationMachineRef.current.clearController(operation);
			}
		},
		[
			appendLocalErrorMessage,
			appendLocalUserMessage,
			applyRunStateAction,
			followLifecycleStream,
			loginRequired,
			markRunDisconnected,
			onLoginRequired,
			ownsOperation,
			replaceActiveRun,
			startOperation,
			truncateMessagesFrom,
		],
	);

	return {
		isLoading,
		isRunning,
		messages,
		runState,
		onCancel,
		onResume,
		requiresConversationInitialization,
		runPrompt,
		setMessages: setRuntimeMessages,
	};
}
