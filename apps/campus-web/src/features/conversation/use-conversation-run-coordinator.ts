import type { AppendMessage } from "@assistant-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createIdempotencyKey, UnauthorizedError } from "@/platform/api/client";
import {
	type ChatRunStatus,
	ChatStreamRequestError,
	cancelRun,
	deleteTrailingMessages,
	getConversationDetail,
	getRunEvents,
	getRunStatus,
	resumeRunEventsStream,
	submitChatRequestStream,
} from "./api";
import { toAssistantThreadMessages } from "./assistant-ui-mappers";
import {
	isAbortError,
	isRunAlreadyTerminalError,
	isTerminalRunStatus,
} from "./assistant-ui-recovery-policy";
import {
	ConversationInitializationRegistry,
	type ConversationInitializationTarget,
} from "./conversation-initialization";
import type { ChatRequestStreamEvent } from "./model";
import {
	type ActiveRun,
	type RunCancellationState,
	RunOperationMachine,
	type RuntimeOperationIdentity,
} from "./run-operation-machine";
import { useAssistantUiMessageProjection } from "./use-assistant-ui-message-projection";

interface RuntimeRunState {
	connection: "connected" | "disconnected";
	operationId: number;
	requestId: string | null;
	sequence: number;
}

interface PendingAssistantDelta {
	occurredAt: string;
	text: string;
}

interface RuntimeRunAction {
	acceptedAt?: string;
	connection?: RuntimeRunState["connection"];
	event?: ChatRequestStreamEvent;
	operationId: number;
	requestId?: string | null;
	run?: ChatRunStatus;
	sequence?: number;
	type: "connection" | "event" | "hydrate" | "rebind" | "reset" | "start";
}

const EMPTY_RUNTIME_RUN: RuntimeRunState = {
	connection: "connected",
	operationId: 0,
	requestId: null,
	sequence: 0,
};

export interface ConversationRunPromptInput {
	conversationId: string | undefined;
	initializationTarget?: ConversationInitializationTarget;
	messageContent: AppendMessage["content"];
	prompt: string;
	truncateFromMessageId?: string;
}

async function* streamFromEvents(
	events: ChatRequestStreamEvent[],
): AsyncIterable<ChatRequestStreamEvent> {
	for (const event of events) {
		yield event;
		await Promise.resolve();
	}
}

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
	const [runState, setRunState] = useState(EMPTY_RUNTIME_RUN);
	const runStateRef = useRef(EMPTY_RUNTIME_RUN);
	const pendingAssistantDeltasRef = useRef(new Map<string, PendingAssistantDelta>());
	const applyTerminalRunStatusRef = useRef<
		((status: ChatRunStatus, operation: RuntimeOperationIdentity) => Promise<void>) | null
	>(null);

	const applyRunStateAction = useCallback((action: RuntimeRunAction): RuntimeRunState => {
		const current = runStateRef.current;
		let next = current;
		if (action.type === "reset" || action.type === "start") {
			next = { ...EMPTY_RUNTIME_RUN, operationId: action.operationId };
		} else if (current.operationId !== action.operationId) {
			return current;
		} else if (action.type === "connection") {
			next = {
				...current,
				connection: action.connection ?? current.connection,
				requestId: action.requestId ?? current.requestId,
			};
		} else if (action.type === "rebind") {
			next = { ...current, requestId: action.requestId ?? current.requestId };
		} else if (action.type === "hydrate" && action.run) {
			next = {
				...current,
				connection: "connected",
				requestId: action.run.requestId,
				sequence: Math.max(current.sequence, action.sequence ?? 0),
			};
		} else if (action.type === "event" && action.event) {
			const eventRequestId = action.event.data.requestId?.trim();
			const eventSequence = action.event.data.sequence;
			if (
				(current.requestId && eventRequestId && current.requestId !== eventRequestId) ||
				(eventSequence !== undefined && eventSequence <= current.sequence)
			) {
				return current;
			}
			next = {
				...current,
				connection: "connected",
				requestId: eventRequestId || current.requestId,
				sequence: eventSequence ?? current.sequence,
			};
		}
		runStateRef.current = next;
		setRunState(next);
		return next;
	}, []);

	const applyRunStateEvent = useCallback(
		(event: ChatRequestStreamEvent, operationId: number) =>
			applyRunStateAction({ event, operationId, type: "event" }),
		[applyRunStateAction],
	);

	const replaceActiveRun = useCallback((run: ActiveRun | null) => {
		operationMachineRef.current.replaceActiveRun(run);
	}, []);

	const updateActiveRun = useCallback((update: (current: ActiveRun | null) => ActiveRun | null) => {
		operationMachineRef.current.updateActiveRun(update);
	}, []);

	const clearPendingAssistantDeltas = useCallback(() => {
		pendingAssistantDeltasRef.current.clear();
	}, []);

	const holdAssistantDelta = useCallback((messageId: string, delta: string, occurredAt: string) => {
		const current = pendingAssistantDeltasRef.current.get(messageId);
		pendingAssistantDeltasRef.current.set(messageId, {
			occurredAt,
			text: (current?.text ?? "") + delta,
		});
	}, []);

	const revealPendingAssistantDeltas = useCallback(() => {
		const pending = [...pendingAssistantDeltasRef.current.entries()];
		pendingAssistantDeltasRef.current.clear();
		for (const [messageId, delta] of pending) {
			appendAssistantDelta(messageId, delta.text, delta.occurredAt);
		}
	}, [appendAssistantDelta]);

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

	const requiresConversationInitialization = useCallback(
		(conversationId: string | undefined): boolean =>
			!conversationId || initializationRegistryRef.current.get(threadId) !== undefined,
		[threadId],
	);

	const appendCancellationFailure = useCallback(
		(run: ActiveRun) => {
			appendLocalErrorMessage(
				new ChatStreamRequestError({
					code: "request_cancel_failed",
					message: "取消请求失败，当前回答仍在继续。",
					requestId: run.requestId,
					retryable: true,
				}),
			);
		},
		[appendLocalErrorMessage],
	);

	const requestRunCancellation = useCallback(
		(run: ActiveRun, operation: RuntimeOperationIdentity): Promise<void> => {
			const current = operationMachineRef.current.cancellation;
			if (
				current.phase !== "idle" &&
				current.operationId === operation.id &&
				"requestId" in current &&
				current.requestId === run.requestId
			) {
				return current.phase === "requesting" ? current.promise : Promise.resolve();
			}

			const request: Extract<RunCancellationState, { phase: "requesting" }> = {
				operationId: operation.id,
				phase: "requesting",
				promise: Promise.resolve(),
				requestId: run.requestId,
			};
			request.promise = Promise.resolve()
				.then(() => cancelRun(run.requestId))
				.then(
					(status) => {
						if (
							operationMachineRef.current.cancellation === request &&
							ownsOperation(operation) &&
							operationMachineRef.current.activeRun?.requestId === run.requestId
						) {
							applyRunStateAction({
								operationId: operation.id,
								run: status,
								sequence: runStateRef.current.sequence,
								type: "hydrate",
							});
							if (isTerminalRunStatus(status)) {
								void applyTerminalRunStatusRef.current?.(status, operation);
								return;
							}
							operationMachineRef.current.cancellation = {
								operationId: operation.id,
								phase: "acknowledged",
								requestId: run.requestId,
							};
						}
					},
					(error: unknown) => {
						if (operationMachineRef.current.cancellation !== request) {
							return;
						}
						if (isRunAlreadyTerminalError(error)) {
							void getRunStatus({
								requestId: run.requestId,
								signal: operation.controller.signal,
							})
								.then((status) => {
									if (isTerminalRunStatus(status)) {
										void applyTerminalRunStatusRef.current?.(status, operation);
										return;
									}
									if (ownsOperation(operation)) {
										operationMachineRef.current.cancellation = {
											operationId: operation.id,
											phase: "acknowledged",
											requestId: run.requestId,
										};
									}
								})
								.catch(() => undefined);
							return;
						}
						operationMachineRef.current.cancellation = { phase: "idle" };
						if (
							!ownsOperation(operation) ||
							operationMachineRef.current.activeRun?.requestId !== run.requestId
						) {
							return;
						}
						revealPendingAssistantDeltas();
						if (error instanceof UnauthorizedError) {
							onLoginRequired();
							return;
						}
						appendCancellationFailure(run);
					},
				);
			operationMachineRef.current.cancellation = request;
			return request.promise;
		},
		[
			appendCancellationFailure,
			applyRunStateAction,
			onLoginRequired,
			ownsOperation,
			revealPendingAssistantDeltas,
		],
	);

	useEffect(
		() => () => {
			operationMachineRef.current.invalidate();
			clearPendingAssistantDeltas();
			initializationRegistryRef.current.clear();
		},
		[clearPendingAssistantDeltas],
	);

	const applyTerminalEvent = useCallback(
		async (event: ChatRequestStreamEvent, operation: RuntimeOperationIdentity) => {
			if (!ownsOperation(operation)) {
				return;
			}
			clearPendingAssistantDeltas();
			const conversationId =
				event.data.answer?.conversation.id ??
				operationMachineRef.current.activeRun?.conversationId ??
				remoteId;
			operationMachineRef.current.cancellation = { phase: "idle" };
			setIsRunning(false);
			replaceActiveRun(null);
			if (
				conversationId &&
				initializationRegistryRef.current.local?.conversationId === conversationId
			) {
				initializationRegistryRef.current.local = null;
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
			ownsOperation,
			remoteId,
			replaceActiveRun,
			replaceWithCanonicalMessages,
		],
	);

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
			const cancellation = operationMachineRef.current.cancellation;
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
		[appendAssistantDelta, holdAssistantDelta, ownsOperation],
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
			operationMachineRef.current.cancellation = { phase: "idle" };
			setIsRunning(false);
			replaceActiveRun(null);
			if (initializationRegistryRef.current.local?.conversationId === status.conversationId) {
				initializationRegistryRef.current.local = null;
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
			ownsOperation,
			replaceActiveRun,
			replaceWithCanonicalMessages,
		],
	);
	applyTerminalRunStatusRef.current = applyTerminalRunStatus;

	const consumeLifecycleStream = useCallback(
		async (
			events: AsyncIterable<ChatRequestStreamEvent>,
			conversationId: string | undefined,
			operation: RuntimeOperationIdentity,
			onEvent: () => void,
		) => {
			let eventCount = 0;
			for await (const event of events) {
				if (!ownsOperation(operation)) {
					return { eventCount, terminal: true };
				}
				eventCount += 1;
				applyRunStateEvent(event, operation.id);
				onEvent();
				if (event.event === "request.accepted" && event.data.requestId) {
					const acceptedRun = {
						...(conversationId ? { conversationId } : {}),
						requestId: event.data.requestId,
						...(event.data.sequence === undefined ? {} : { sequence: event.data.sequence }),
					};
					replaceActiveRun(acceptedRun);
					const cancellation = operationMachineRef.current.cancellation;
					if (
						cancellation.phase === "awaiting_request_id" &&
						cancellation.operationId === operation.id
					) {
						void requestRunCancellation(acceptedRun, operation);
					}
				}
				if (event.data.requestId) {
					updateActiveRun((current) => ({
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
					return { eventCount, terminal: true };
				}
			}
			return { eventCount, terminal: false };
		},
		[
			applyAnswerDelta,
			applyTerminalEvent,
			applyRunStateEvent,
			ownsOperation,
			replaceActiveRun,
			requestRunCancellation,
			updateActiveRun,
		],
	);

	const followLifecycleStream = useCallback(
		async (input: {
			conversationId?: string;
			controller: AbortController;
			operation: RuntimeOperationIdentity;
			initialEvents: AsyncIterable<ChatRequestStreamEvent>;
		}) => {
			if (!ownsOperation(input.operation)) {
				return;
			}
			const consumed = await consumeLifecycleStream(
				input.initialEvents,
				input.conversationId,
				input.operation,
				() => undefined,
			);
			if (!(consumed.terminal || input.controller.signal.aborted)) {
				throw new ChatStreamRequestError({
					code: "chat_stream_connection_lost",
					message: "回答连接已断开。",
					retryable: true,
					requestId: operationMachineRef.current.activeRun?.requestId,
				});
			}
		},
		[consumeLifecycleStream, ownsOperation],
	);

	const markRunDisconnected = useCallback(
		(operationId: number, requestId: string | null) => {
			applyRunStateAction({
				connection: "disconnected",
				operationId,
				...(requestId === null ? {} : { requestId }),
				type: "connection",
			});
		},
		[applyRunStateAction],
	);

	const restoreConversationRun = useCallback(
		async (
			conversationId: string,
			conversation: Awaited<ReturnType<typeof getConversationDetail>>,
			operation: RuntimeOperationIdentity,
		) => {
			if (!ownsOperation(operation)) {
				return;
			}
			const canonicalMessages = toAssistantThreadMessages(conversation);
			applyRunStateAction({ operationId: operation.id, type: "reset" });
			replaceWithCanonicalMessages(canonicalMessages);
			if (!conversation.activeRequestId) {
				setIsRunning(false);
				return;
			}

			const requestId = conversation.activeRequestId;
			try {
				const status = await getRunStatus({ requestId, signal: operation.controller.signal });
				if (!ownsOperation(operation)) {
					return;
				}
				const activeRun: ActiveRun = {
					conversationId,
					requestId: status.requestId,
				};
				replaceActiveRun(activeRun);
				applyRunStateAction({
					operationId: operation.id,
					run: status,
					type: "hydrate",
				});
				setIsRunning(!isTerminalRunStatus(status));
				if (isTerminalRunStatus(status)) {
					const nextMessages = await fetchConversationMessages(
						conversationId,
						operation.controller.signal,
					);
					if (ownsOperation(operation)) {
						replaceWithCanonicalMessages(nextMessages);
						replaceActiveRun(null);
					}
					return;
				}

				const replay = await getRunEvents({
					afterSequence: 0,
					requestId,
					signal: operation.controller.signal,
				});
				if (!ownsOperation(operation)) {
					return;
				}
				const consumed = await consumeLifecycleStream(
					streamFromEvents(replay.events),
					conversationId,
					operation,
					() => undefined,
				);
				if (consumed.terminal) {
					return;
				}
				if (isTerminalRunStatus(replay.run)) {
					await applyTerminalRunStatus(replay.run, operation);
					return;
				}
				applyRunStateAction({
					operationId: operation.id,
					run: replay.run,
					sequence: replay.nextSequence,
					type: "hydrate",
				});
				updateActiveRun((current) =>
					current?.requestId === requestId
						? { ...current, sequence: replay.nextSequence }
						: current,
				);
				await followLifecycleStream({
					conversationId,
					controller: operation.controller,
					operation,
					initialEvents: resumeRunEventsStream({
						afterSequence: replay.nextSequence,
						requestId,
						signal: operation.controller.signal,
					}),
				});
			} catch (error) {
				if (!ownsOperation(operation)) {
					return;
				}
				setIsRunning(true);
				markRunDisconnected(operation.id, requestId);
				if (error instanceof UnauthorizedError) {
					onLoginRequired();
					return;
				}
				if (isAbortError(error)) {
					return;
				}
				if (error instanceof ChatStreamRequestError) {
					return;
				}
				throw error;
			}
		},
		[
			applyRunStateAction,
			applyTerminalRunStatus,
			consumeLifecycleStream,
			fetchConversationMessages,
			followLifecycleStream,
			markRunDisconnected,
			onLoginRequired,
			ownsOperation,
			replaceActiveRun,
			replaceWithCanonicalMessages,
			updateActiveRun,
		],
	);

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
					controller,
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

	const onCancel = useCallback(async () => {
		const currentRun = operationMachineRef.current.activeRun;
		let controller = operationMachineRef.current.controller;
		const cancellation = operationMachineRef.current.cancellation;
		if (
			controller &&
			cancellation.phase === "initializing" &&
			cancellation.operationId === operationMachineRef.current.operationId
		) {
			removeMessage(cancellation.localMessageId);
			initializationRegistryRef.current.local = null;
			operationMachineRef.current.invalidate();
			setIsRunning(false);
			replaceActiveRun(null);
			return;
		}
		if (currentRun?.requestId) {
			let operation: RuntimeOperationIdentity;
			if (controller) {
				operation = { controller, id: operationMachineRef.current.operationId };
			} else {
				operation = startOperation();
				controller = operation.controller;
				applyRunStateAction({
					operationId: operation.id,
					requestId: currentRun.requestId,
					type: "rebind",
				});
			}
			setIsRunning(true);
			return requestRunCancellation(currentRun, operation);
		}
		if (isRunning && controller) {
			if (
				cancellation.phase === "idle" ||
				cancellation.operationId !== operationMachineRef.current.operationId
			) {
				operationMachineRef.current.cancellation = {
					operationId: operationMachineRef.current.operationId,
					phase: "awaiting_request_id",
				};
			}
			return;
		}
		initializationRegistryRef.current.local = null;
		operationMachineRef.current.invalidate();
		setIsRunning(false);
		replaceActiveRun(null);
	}, [
		applyRunStateAction,
		isRunning,
		removeMessage,
		replaceActiveRun,
		requestRunCancellation,
		startOperation,
	]);

	const onResume = useCallback(async () => {
		const currentRun = operationMachineRef.current.activeRun;
		if (!currentRun?.requestId) {
			return;
		}
		const operation = startOperation();
		const controller = operation.controller;
		applyRunStateAction({
			operationId: operation.id,
			requestId: currentRun.requestId,
			type: "rebind",
		});
		setIsRunning(true);
		try {
			await followLifecycleStream({
				...(currentRun.conversationId ? { conversationId: currentRun.conversationId } : {}),
				controller,
				operation,
				initialEvents: resumeRunEventsStream({
					...(currentRun.sequence === undefined ? {} : { afterSequence: currentRun.sequence }),
					requestId: currentRun.requestId,
					signal: controller.signal,
				}),
			});
		} catch (error) {
			if (!ownsOperation(operation)) {
				return;
			}
			setIsRunning(true);
			if (error instanceof UnauthorizedError) {
				markRunDisconnected(operation.id, currentRun.requestId);
				onLoginRequired();
				return;
			}
			if (isAbortError(error)) {
				return;
			}
			if (error instanceof ChatStreamRequestError) {
				markRunDisconnected(operation.id, currentRun.requestId);
				operationMachineRef.current.cancellation = { phase: "idle" };
				return;
			}
			markRunDisconnected(operation.id, currentRun.requestId);
			throw error;
		} finally {
			operationMachineRef.current.clearController(operation);
		}
	}, [
		applyRunStateAction,
		followLifecycleStream,
		markRunDisconnected,
		onLoginRequired,
		ownsOperation,
		startOperation,
	]);

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
