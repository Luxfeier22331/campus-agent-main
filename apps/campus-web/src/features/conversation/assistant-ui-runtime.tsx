import {
	type AppendMessage,
	type ThreadMessageLike,
	useAui,
	useAuiState,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createIdempotencyKey, UnauthorizedError } from "@/platform/api/client";
import {
	type ChatRunStatus,
	ChatStreamRequestError,
	cancelRun,
	deleteTrailingMessages,
	getConversationDetail,
	getRunStatus,
	resumeRunEventsStream,
	submitChatRequestStream,
} from "./api";
import { toAssistantThreadMessages } from "./assistant-ui-mappers";
import type { ChatRequestStreamEvent } from "./model";

type RuntimeMessages = ThreadMessageLike[];

const RESUME_INITIAL_DELAY_MS = 250;
const RESUME_MAX_DELAY_MS = 5_000;
const MAX_INITIAL_STREAM_REPLAYS = 3;
const MAX_CONSECUTIVE_RECOVERY_FAILURES = 3;

interface ActiveRun {
	conversationId?: string | undefined;
	requestId: string;
	runId: string;
	sequence?: number | undefined;
	traceId: string;
}

interface RuntimeOperationIdentity {
	id: number;
	controller: AbortController;
}

type RunCancellationState =
	| { phase: "idle" }
	| { localMessageId: string; operationId: number; phase: "initializing" }
	| { operationId: number; phase: "awaiting_run_id" }
	| { operationId: number; phase: "requesting"; promise: Promise<void>; runId: string }
	| { operationId: number; phase: "acknowledged"; runId: string };

interface AssistantFrameState {
	frameId: number;
	messageId: string;
	occurredAt: string;
}

interface ConversationInitializationTarget {
	deleteThread: () => void | Promise<void>;
	initialize: () => Promise<{ remoteId: string }>;
	threadId: string;
}

interface PendingConversationInitialization {
	deleteThread: () => void | Promise<void>;
	initializeTask: Promise<string | undefined>;
	ownerOperationId: number;
}

export function createCampusAssistantRuntimeHook(input: {
	loginRequired: boolean;
	onLoginRequired: () => void;
}) {
	return function useCampusAssistantExternalStoreRuntime() {
		return useCampusAssistantRuntimeState({
			loginRequired: input.loginRequired,
			onLoginRequired: input.onLoginRequired,
		});
	};
}

function useCampusAssistantRuntimeState({
	loginRequired,
	onLoginRequired,
}: {
	loginRequired: boolean;
	onLoginRequired: () => void;
}) {
	const aui = useAui();
	const threadId = useAuiState((state) => state.threadListItem.id);
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const [isLoading, setIsLoading] = useState(false);
	const [isRunning, setIsRunning] = useState(false);
	const [messages, setMessages] = useState<RuntimeMessages>([]);
	const activeRunRef = useRef<ActiveRun | null>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const cancellationStateRef = useRef<RunCancellationState>({ phase: "idle" });
	const operationIdRef = useRef(0);
	const locallyInitializedRunConversationRef = useRef<{
		conversationId: string;
		operationId: number;
		threadId: string;
	} | null>(null);
	const pendingConversationInitializationsRef = useRef(
		new Map<string, PendingConversationInitialization>(),
	);
	const provisionalAssistantMessageIdsRef = useRef(new Set<string>());
	const streamedAnswerTextRef = useRef(new Map<string, string>());
	const streamedAnswerOccurredAtRef = useRef(new Map<string, string>());
	const assistantFrameRef = useRef<AssistantFrameState | null>(null);

	const replaceActiveRun = useCallback((run: ActiveRun | null) => {
		activeRunRef.current = run;
	}, []);

	const updateActiveRun = useCallback(
		(update: (current: ActiveRun | null) => ActiveRun | null) => {
			replaceActiveRun(update(activeRunRef.current));
		},
		[replaceActiveRun],
	);

	const fetchConversationMessages = useCallback(
		async (conversationId: string, signal?: AbortSignal) => {
			const conversation = await getConversationDetail(conversationId, signal);
			return toAssistantThreadMessages(conversation);
		},
		[],
	);

	const startOperation = useCallback((): RuntimeOperationIdentity => {
		abortControllerRef.current?.abort();
		cancellationStateRef.current = { phase: "idle" };
		const controller = new AbortController();
		const operation = {
			controller,
			id: ++operationIdRef.current,
		};
		abortControllerRef.current = controller;
		return operation;
	}, []);

	const ownsOperation = useCallback(
		(operation: RuntimeOperationIdentity): boolean =>
			operationIdRef.current === operation.id &&
			abortControllerRef.current === operation.controller,
		[],
	);

	const revealAssistantText = useCallback(
		(input: { messageId: string; occurredAt: string; text: string }) => {
			provisionalAssistantMessageIdsRef.current.add(input.messageId);
			setMessages((current) => {
				const nextMessage: ThreadMessageLike = {
					content: input.text ? [{ text: input.text, type: "text" }] : [],
					createdAt: new Date(input.occurredAt),
					id: input.messageId,
					role: "assistant",
				};
				const existingIndex = current.findIndex((message) => message.id === input.messageId);
				if (existingIndex < 0) {
					return [...current, nextMessage];
				}
				return current.map((message, index) =>
					index === existingIndex
						? {
								...message,
								content: nextMessage.content,
							}
						: message,
				);
			});
		},
		[],
	);

	const cancelAssistantFrame = useCallback(() => {
		const current = assistantFrameRef.current;
		if (current) {
			window.cancelAnimationFrame(current.frameId);
		}
		assistantFrameRef.current = null;
	}, []);

	const revealAccumulatedAssistantText = useCallback(() => {
		cancelAssistantFrame();
		for (const [messageId, text] of streamedAnswerTextRef.current) {
			const occurredAt = streamedAnswerOccurredAtRef.current.get(messageId);
			if (!occurredAt) {
				continue;
			}
			revealAssistantText({
				messageId,
				occurredAt,
				text,
			});
		}
	}, [cancelAssistantFrame, revealAssistantText]);

	const clearProvisionalAssistantMessages = useCallback(() => {
		const provisionalIds = new Set(provisionalAssistantMessageIdsRef.current);
		if (provisionalIds.size > 0) {
			setMessages((current) =>
				current.filter((message) => !(message.id && provisionalIds.has(message.id))),
			);
		}
		provisionalAssistantMessageIdsRef.current.clear();
		streamedAnswerTextRef.current.clear();
		streamedAnswerOccurredAtRef.current.clear();
	}, []);

	const replaceWithCanonicalMessages = useCallback((nextMessages: RuntimeMessages) => {
		provisionalAssistantMessageIdsRef.current.clear();
		streamedAnswerTextRef.current.clear();
		streamedAnswerOccurredAtRef.current.clear();
		setMessages(nextMessages);
	}, []);

	const appendLocalErrorMessage = useCallback((error: ChatStreamRequestError) => {
		const messageId = error.requestId
			? `local-error-${error.requestId}`
			: `local-error-${crypto.randomUUID()}`;
		const text = error.message.trim() || "请求失败，请稍后重试。";
		setMessages((current) => [
			...current,
			{
				content: [{ text, type: "text" }],
				createdAt: new Date(),
				id: messageId,
				role: "assistant",
			},
		]);
	}, []);

	const appendCancellationFailure = useCallback(
		(run: ActiveRun) => {
			appendLocalErrorMessage(
				new ChatStreamRequestError({
					code: "run_cancel_failed",
					message: "取消请求失败，当前回答仍在继续。",
					retryable: true,
					traceId: run.traceId,
				}),
			);
		},
		[appendLocalErrorMessage],
	);

	const requestRunCancellation = useCallback(
		(run: ActiveRun, operation: RuntimeOperationIdentity): Promise<void> => {
			const current = cancellationStateRef.current;
			if (
				current.phase !== "idle" &&
				current.operationId === operation.id &&
				"runId" in current &&
				current.runId === run.runId
			) {
				return current.phase === "requesting" ? current.promise : Promise.resolve();
			}

			const request: Extract<RunCancellationState, { phase: "requesting" }> = {
				operationId: operation.id,
				phase: "requesting",
				promise: Promise.resolve(),
				runId: run.runId,
			};
			request.promise = Promise.resolve()
				.then(() => cancelRun(run.runId))
				.then(
					() => {
						if (
							cancellationStateRef.current === request &&
							ownsOperation(operation) &&
							activeRunRef.current?.runId === run.runId
						) {
							cancellationStateRef.current = {
								operationId: operation.id,
								phase: "acknowledged",
								runId: run.runId,
							};
						}
					},
					(error: unknown) => {
						if (cancellationStateRef.current !== request) {
							return;
						}
						if (isRunAlreadyTerminalError(error)) {
							cancellationStateRef.current = {
								operationId: operation.id,
								phase: "acknowledged",
								runId: run.runId,
							};
							return;
						}
						cancellationStateRef.current = { phase: "idle" };
						if (!ownsOperation(operation) || activeRunRef.current?.runId !== run.runId) {
							return;
						}
						revealAccumulatedAssistantText();
						if (error instanceof UnauthorizedError) {
							onLoginRequired();
							return;
						}
						appendCancellationFailure(run);
					},
				);
			cancellationStateRef.current = request;
			return request.promise;
		},
		[appendCancellationFailure, onLoginRequired, ownsOperation, revealAccumulatedAssistantText],
	);

	const flushAssistantFrame = useCallback(() => {
		const current = assistantFrameRef.current;
		if (!current) {
			return;
		}
		window.cancelAnimationFrame(current.frameId);
		assistantFrameRef.current = null;
		revealAssistantText({
			messageId: current.messageId,
			occurredAt: current.occurredAt,
			text: streamedAnswerTextRef.current.get(current.messageId) ?? "",
		});
	}, [revealAssistantText]);

	const scheduleAssistantFrame = useCallback(
		(messageId: string, occurredAt: string) => {
			const pending = assistantFrameRef.current;
			if (pending?.messageId === messageId) {
				pending.occurredAt = occurredAt;
				return;
			}
			if (pending) {
				flushAssistantFrame();
			}
			const frame: AssistantFrameState = {
				frameId: 0,
				messageId,
				occurredAt,
			};
			frame.frameId = window.requestAnimationFrame(() => {
				if (assistantFrameRef.current !== frame) {
					return;
				}
				assistantFrameRef.current = null;
				revealAssistantText({
					messageId: frame.messageId,
					occurredAt: frame.occurredAt,
					text: streamedAnswerTextRef.current.get(frame.messageId) ?? "",
				});
			});
			assistantFrameRef.current = frame;
		},
		[flushAssistantFrame, revealAssistantText],
	);

	useEffect(
		() => () => {
			operationIdRef.current += 1;
			abortControllerRef.current?.abort();
			abortControllerRef.current = null;
			activeRunRef.current = null;
			cancellationStateRef.current = { phase: "idle" };
			locallyInitializedRunConversationRef.current = null;
			cancelAssistantFrame();
			provisionalAssistantMessageIdsRef.current.clear();
			streamedAnswerTextRef.current.clear();
			streamedAnswerOccurredAtRef.current.clear();
		},
		[cancelAssistantFrame],
	);

	useEffect(() => {
		const locallyInitializedRunConversation = locallyInitializedRunConversationRef.current;
		const pendingInitialization = pendingConversationInitializationsRef.current.get(threadId);
		if (
			remoteId &&
			((locallyInitializedRunConversation?.conversationId === remoteId &&
				locallyInitializedRunConversation.operationId === operationIdRef.current &&
				locallyInitializedRunConversation.threadId === threadId) ||
				pendingInitialization !== undefined)
		) {
			return;
		}

		const operationId = ++operationIdRef.current;
		abortControllerRef.current?.abort();
		cancelAssistantFrame();
		clearProvisionalAssistantMessages();
		cancellationStateRef.current = { phase: "idle" };
		replaceActiveRun(null);
		setIsRunning(false);
		if (!remoteId) {
			abortControllerRef.current = null;
			setMessages([]);
			return;
		}
		const controller = new AbortController();
		abortControllerRef.current = controller;

		let cancelled = false;
		setIsLoading(true);
		fetchConversationMessages(remoteId, controller.signal)
			.then((nextMessages) => {
				if (!cancelled && operationIdRef.current === operationId) {
					replaceWithCanonicalMessages(nextMessages);
				}
			})
			.catch((error: unknown) => {
				if (cancelled || operationIdRef.current !== operationId || isAbortError(error)) {
					return;
				}
				if (error instanceof UnauthorizedError) {
					onLoginRequired();
					return;
				}
			})
			.finally(() => {
				if (!cancelled && operationIdRef.current === operationId) {
					setIsLoading(false);
				}
			});

		return () => {
			cancelled = true;
			controller.abort();
			if (operationIdRef.current === operationId) {
				operationIdRef.current += 1;
				if (abortControllerRef.current === controller) {
					abortControllerRef.current = null;
				}
			}
		};
	}, [
		clearProvisionalAssistantMessages,
		cancelAssistantFrame,
		fetchConversationMessages,
		onLoginRequired,
		remoteId,
		replaceActiveRun,
		replaceWithCanonicalMessages,
		threadId,
	]);

	const applyTerminalEvent = useCallback(
		async (event: ChatRequestStreamEvent, operation: RuntimeOperationIdentity) => {
			if (!ownsOperation(operation)) {
				return;
			}
			flushAssistantFrame();
			const conversationId =
				event.data.answer?.conversation.id ?? activeRunRef.current?.conversationId ?? remoteId;
			cancellationStateRef.current = { phase: "idle" };
			setIsRunning(false);
			replaceActiveRun(null);
			if (
				conversationId &&
				locallyInitializedRunConversationRef.current?.conversationId === conversationId
			) {
				locallyInitializedRunConversationRef.current = null;
			}
			if (event.event === "request.failed" && event.data.error) {
				cancelAssistantFrame();
				clearProvisionalAssistantMessages();
				appendLocalErrorMessage(
					new ChatStreamRequestError({
						code: event.data.error.code,
						message: event.data.error.message,
						requestId: event.data.requestId,
						retryable: event.data.error.retryable ?? true,
						traceId: event.data.traceId,
					}),
				);
				return;
			}
			if (event.data.answer) {
				const terminalMessages = toAssistantThreadMessages(event.data.answer.conversation);
				cancelAssistantFrame();
				replaceWithCanonicalMessages(terminalMessages);
			} else if (conversationId) {
				cancelAssistantFrame();
				clearProvisionalAssistantMessages();
				try {
					const nextMessages = await fetchConversationMessagesWithRetry(
						conversationId,
						operation.controller.signal,
						fetchConversationMessages,
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
								message: "回答已完成，但会话内容暂时无法刷新。",
								retryable: true,
								requestId: event.data.requestId,
								traceId: event.data.traceId,
							}),
						);
					}
				}
			}
		},
		[
			appendLocalErrorMessage,
			clearProvisionalAssistantMessages,
			cancelAssistantFrame,
			fetchConversationMessages,
			flushAssistantFrame,
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
			const text = (streamedAnswerTextRef.current.get(messageId) ?? "") + delta;
			streamedAnswerTextRef.current.set(messageId, text);
			streamedAnswerOccurredAtRef.current.set(messageId, event.data.occurredAt);
			const cancellation = cancellationStateRef.current;
			if (
				(cancellation.phase === "awaiting_run_id" ||
					cancellation.phase === "requesting" ||
					cancellation.phase === "acknowledged") &&
				cancellation.operationId === operation.id
			) {
				return;
			}
			scheduleAssistantFrame(messageId, event.data.occurredAt);
		},
		[ownsOperation, scheduleAssistantFrame],
	);

	const applyTerminalRunStatus = useCallback(
		async (status: ChatRunStatus, operation: RuntimeOperationIdentity) => {
			if (!ownsOperation(operation)) {
				return;
			}
			cancelAssistantFrame();
			clearProvisionalAssistantMessages();
			cancellationStateRef.current = { phase: "idle" };
			setIsRunning(false);
			replaceActiveRun(null);
			if (locallyInitializedRunConversationRef.current?.conversationId === status.conversationId) {
				locallyInitializedRunConversationRef.current = null;
			}
			try {
				const nextMessages = await fetchConversationMessagesWithRetry(
					status.conversationId,
					operation.controller.signal,
					fetchConversationMessages,
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
							traceId: status.traceId,
						}),
					);
				}
			}
		},
		[
			appendLocalErrorMessage,
			cancelAssistantFrame,
			clearProvisionalAssistantMessages,
			fetchConversationMessages,
			ownsOperation,
			replaceActiveRun,
			replaceWithCanonicalMessages,
		],
	);

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
				onEvent();
				if (event.event === "request.accepted" && event.data.runId) {
					const acceptedRun = {
						...(conversationId ? { conversationId } : {}),
						requestId: event.data.requestId,
						runId: event.data.runId,
						...(event.data.sequence === undefined ? {} : { sequence: event.data.sequence }),
						traceId: event.data.traceId,
					};
					replaceActiveRun(acceptedRun);
					const cancellation = cancellationStateRef.current;
					if (
						cancellation.phase === "awaiting_run_id" &&
						cancellation.operationId === operation.id
					) {
						void requestRunCancellation(acceptedRun, operation);
					}
					continue;
				}
				if (event.data.runId) {
					const runId = event.data.runId;
					updateActiveRun((current) => ({
						...((current?.conversationId ?? conversationId)
							? { conversationId: current?.conversationId ?? conversationId }
							: {}),
						requestId: event.data.requestId,
						runId,
						...((event.data.sequence ?? current?.sequence) === undefined
							? {}
							: { sequence: event.data.sequence ?? current?.sequence }),
						traceId: event.data.traceId,
					}));
				}
				if (event.event === "answer.delta") {
					applyAnswerDelta(event, operation);
					continue;
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
			retryInitialEvents?: () => AsyncIterable<ChatRequestStreamEvent>;
		}) => {
			let delayMs = RESUME_INITIAL_DELAY_MS;
			let events = input.initialEvents;
			let initialReplayCount = 0;
			let consecutiveRecoveryFailures = 0;
			for (;;) {
				if (!ownsOperation(input.operation)) {
					return;
				}
				let streamProgress = false;
				try {
					const consumed = await consumeLifecycleStream(
						events,
						input.conversationId,
						input.operation,
						() => {
							streamProgress = true;
							consecutiveRecoveryFailures = 0;
							delayMs = RESUME_INITIAL_DELAY_MS;
						},
					);
					if (consumed.terminal || input.controller.signal.aborted) {
						return;
					}
					if (consumed.eventCount > 0) {
						delayMs = RESUME_INITIAL_DELAY_MS;
						consecutiveRecoveryFailures = 0;
					}
				} catch (error) {
					if (!ownsOperation(input.operation)) {
						return;
					}
					if (
						error instanceof UnauthorizedError ||
						isAbortError(error) ||
						(error instanceof ChatStreamRequestError && !error.retryable)
					) {
						throw error;
					}
					if (!(activeRunRef.current || input.retryInitialEvents)) {
						throw error;
					}
				}

				const run = ownsOperation(input.operation) ? activeRunRef.current : null;
				if (!run) {
					if (!input.retryInitialEvents) {
						throw new ChatStreamRequestError({
							code: "stream_closed_before_acceptance",
							message: "回答连接在运行被接受前关闭。",
							retryable: true,
						});
					}
					if (initialReplayCount >= MAX_INITIAL_STREAM_REPLAYS) {
						throw streamRecoveryExhausted();
					}
					initialReplayCount += 1;
					await waitForResumeDelay(delayMs, input.controller.signal);
					events = input.retryInitialEvents();
					delayMs = Math.min(delayMs * 2, RESUME_MAX_DELAY_MS);
					continue;
				}

				try {
					const status = await getRunStatus({
						runId: run.runId,
						signal: input.controller.signal,
					});
					if (isTerminalRunStatus(status)) {
						await applyTerminalRunStatus(status, input.operation);
						return;
					}
					updateActiveRun((current) =>
						current?.runId === status.runId
							? {
									...current,
									conversationId: status.conversationId,
									requestId: status.requestId,
									traceId: status.traceId,
								}
							: current,
					);
					consecutiveRecoveryFailures = 0;
				} catch (error) {
					if (!ownsOperation(input.operation)) {
						return;
					}
					if (
						error instanceof UnauthorizedError ||
						isAbortError(error) ||
						(error instanceof ChatStreamRequestError && !error.retryable)
					) {
						throw error;
					}
					if (!streamProgress) {
						consecutiveRecoveryFailures += 1;
					}
					if (consecutiveRecoveryFailures >= MAX_CONSECUTIVE_RECOVERY_FAILURES) {
						throw streamRecoveryExhausted(run);
					}
				}
				await waitForResumeDelay(delayMs, input.controller.signal);
				events = resumeRunEventsStream({
					...(run.sequence === undefined ? {} : { afterSequence: run.sequence }),
					runId: run.runId,
					signal: input.controller.signal,
				});
				delayMs = Math.min(delayMs * 2, RESUME_MAX_DELAY_MS);
			}
		},
		[applyTerminalRunStatus, consumeLifecycleStream, ownsOperation, updateActiveRun],
	);

	const runPrompt = useCallback(
		async (input: {
			conversationId: string | undefined;
			initializationTarget?: ConversationInitializationTarget;
			messageContent: AppendMessage["content"];
			prompt: string;
			truncateFromMessageId?: string;
		}) => {
			const prompt = input.prompt.trim();
			if (!prompt) {
				throw new Error("Message text is required.");
			}
			if (loginRequired) {
				onLoginRequired();
				return;
			}
			streamedAnswerTextRef.current.clear();
			const operation = startOperation();
			const controller = operation.controller;
			const localMessageId = `local-user-${crypto.randomUUID()}`;
			cancelAssistantFrame();
			clearProvisionalAssistantMessages();
			replaceActiveRun(null);
			cancellationStateRef.current = input.initializationTarget
				? { localMessageId, operationId: operation.id, phase: "initializing" }
				: { phase: "idle" };
			if (input.truncateFromMessageId) {
				setMessages((current) =>
					current.slice(
						0,
						Math.max(
							current.findIndex((message) => message.id === input.truncateFromMessageId),
							0,
						),
					),
				);
			}
			setMessages((current) => [
				...current,
				localUserMessage(input.messageContent, localMessageId),
			]);
			setIsRunning(true);

			let initializationCleanupFailed = false;
			try {
				let conversationId = input.conversationId;
				if (input.initializationTarget) {
					const target = input.initializationTarget;
					let initialization = pendingConversationInitializationsRef.current.get(target.threadId);
					if (initialization) {
						initialization.ownerOperationId = operation.id;
					} else {
						initialization = {
							deleteThread: target.deleteThread,
							initializeTask: Promise.resolve()
								.then(() => target.initialize())
								.then((result) => result.remoteId ?? undefined),
							ownerOperationId: operation.id,
						};
						pendingConversationInitializationsRef.current.set(target.threadId, initialization);
					}
					try {
						conversationId = await initialization.initializeTask;
					} catch (error) {
						if (
							pendingConversationInitializationsRef.current.get(target.threadId) !==
								initialization ||
							initialization.ownerOperationId !== operation.id
						) {
							return;
						}
						pendingConversationInitializationsRef.current.delete(target.threadId);
						if (!ownsOperation(operation)) {
							return;
						}
						cancellationStateRef.current = { phase: "idle" };
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
						pendingConversationInitializationsRef.current.get(target.threadId) !== initialization ||
						initialization.ownerOperationId !== operation.id
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
							if (
								pendingConversationInitializationsRef.current.get(target.threadId) ===
								initialization
							) {
								pendingConversationInitializationsRef.current.delete(target.threadId);
							}
						}
						return;
					}
					cancellationStateRef.current = { phase: "idle" };
					if (conversationId) {
						locallyInitializedRunConversationRef.current = {
							conversationId,
							operationId: operation.id,
							threadId: target.threadId,
						};
					}
					pendingConversationInitializationsRef.current.delete(target.threadId);
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
					retryInitialEvents: submitEvents,
				});
			} catch (error) {
				if (initializationCleanupFailed) {
					throw error;
				}
				if (!ownsOperation(operation)) {
					return;
				}
				setIsRunning(false);
				if (error instanceof UnauthorizedError) {
					replaceActiveRun(null);
					cancelAssistantFrame();
					clearProvisionalAssistantMessages();
					onLoginRequired();
					return;
				}
				if (isAbortError(error)) {
					cancelAssistantFrame();
					clearProvisionalAssistantMessages();
					return;
				}
				if (error instanceof ChatStreamRequestError) {
					replaceActiveRun(null);
					cancelAssistantFrame();
					clearProvisionalAssistantMessages();
					cancellationStateRef.current = { phase: "idle" };
					appendLocalErrorMessage(error);
					return;
				}
				throw error;
			} finally {
				if (ownsOperation(operation) && abortControllerRef.current === controller) {
					abortControllerRef.current = null;
				}
			}
		},
		[
			appendLocalErrorMessage,
			cancelAssistantFrame,
			clearProvisionalAssistantMessages,
			followLifecycleStream,
			loginRequired,
			onLoginRequired,
			ownsOperation,
			replaceActiveRun,
			startOperation,
		],
	);

	const onNew = useCallback(
		async (message: AppendMessage) => {
			if (loginRequired) {
				onLoginRequired();
				return;
			}
			const existingRemoteId = remoteId;
			const pendingInitialization = pendingConversationInitializationsRef.current.get(threadId);
			const needsInitialization = !existingRemoteId || pendingInitialization !== undefined;
			const threadItem = needsInitialization ? aui.threads.item({ id: threadId }) : undefined;
			await runPrompt({
				conversationId: needsInitialization ? undefined : existingRemoteId,
				...(threadItem
					? {
							initializationTarget: {
								deleteThread: () => threadItem.delete(),
								initialize: () => threadItem.initialize(),
								threadId,
							},
						}
					: {}),
				messageContent: message.content,
				prompt: readTextContent(message),
			});
		},
		[aui.threads, loginRequired, onLoginRequired, remoteId, runPrompt, threadId],
	);

	const onEdit = useCallback(
		async (message: AppendMessage) => {
			const conversationId = remoteId;
			const truncateFromMessageId = message.parentId;
			await runPrompt({
				conversationId,
				messageContent: message.content,
				prompt: readTextContent(message),
				...(truncateFromMessageId ? { truncateFromMessageId } : {}),
			});
		},
		[remoteId, runPrompt],
	);

	const onReload = useCallback(
		async (parentId: string | null) => {
			if (!parentId) {
				return;
			}
			const parentMessage = messages.find((message) => message.id === parentId);
			const prompt = readMessageText(parentMessage).trim();
			if (!prompt) {
				return;
			}
			await runPrompt({
				conversationId: remoteId,
				messageContent: [{ text: prompt, type: "text" }],
				prompt,
				truncateFromMessageId: parentId,
			});
		},
		[messages, remoteId, runPrompt],
	);

	const onCancel = useCallback(async () => {
		const currentRun = activeRunRef.current;
		const controller = abortControllerRef.current;
		const cancellation = cancellationStateRef.current;
		cancelAssistantFrame();
		if (
			controller &&
			cancellation.phase === "initializing" &&
			cancellation.operationId === operationIdRef.current
		) {
			cancellationStateRef.current = { phase: "idle" };
			clearProvisionalAssistantMessages();
			setMessages((current) =>
				current.filter((message) => message.id !== cancellation.localMessageId),
			);
			locallyInitializedRunConversationRef.current = null;
			controller.abort();
			abortControllerRef.current = null;
			operationIdRef.current += 1;
			setIsRunning(false);
			replaceActiveRun(null);
			return;
		}
		if (currentRun?.runId && controller) {
			return requestRunCancellation(currentRun, {
				controller,
				id: operationIdRef.current,
			});
		}
		if (isRunning && controller) {
			if (cancellation.phase === "idle" || cancellation.operationId !== operationIdRef.current) {
				cancellationStateRef.current = {
					operationId: operationIdRef.current,
					phase: "awaiting_run_id",
				};
			}
			return;
		}
		cancellationStateRef.current = { phase: "idle" };
		cancelAssistantFrame();
		clearProvisionalAssistantMessages();
		locallyInitializedRunConversationRef.current = null;
		abortControllerRef.current?.abort();
		abortControllerRef.current = null;
		operationIdRef.current += 1;
		setIsRunning(false);
		replaceActiveRun(null);
	}, [
		cancelAssistantFrame,
		clearProvisionalAssistantMessages,
		isRunning,
		replaceActiveRun,
		requestRunCancellation,
	]);

	const onResume = useCallback(async () => {
		const currentRun = activeRunRef.current;
		if (!currentRun?.runId) {
			return;
		}
		const operation = startOperation();
		const controller = operation.controller;
		cancelAssistantFrame();
		setIsRunning(true);
		try {
			await followLifecycleStream({
				...(currentRun.conversationId ? { conversationId: currentRun.conversationId } : {}),
				controller,
				operation,
				initialEvents: resumeRunEventsStream({
					...(currentRun.sequence === undefined ? {} : { afterSequence: currentRun.sequence }),
					runId: currentRun.runId,
					signal: controller.signal,
				}),
			});
		} catch (error) {
			if (!ownsOperation(operation)) {
				return;
			}
			setIsRunning(false);
			if (error instanceof UnauthorizedError) {
				replaceActiveRun(null);
				cancelAssistantFrame();
				clearProvisionalAssistantMessages();
				onLoginRequired();
				return;
			}
			if (isAbortError(error)) {
				cancelAssistantFrame();
				clearProvisionalAssistantMessages();
				return;
			}
			if (error instanceof ChatStreamRequestError) {
				replaceActiveRun(null);
				cancelAssistantFrame();
				clearProvisionalAssistantMessages();
				cancellationStateRef.current = { phase: "idle" };
				appendLocalErrorMessage(error);
				return;
			}
			cancelAssistantFrame();
			clearProvisionalAssistantMessages();
			throw error;
		} finally {
			if (ownsOperation(operation) && abortControllerRef.current === controller) {
				abortControllerRef.current = null;
			}
		}
	}, [
		appendLocalErrorMessage,
		cancelAssistantFrame,
		clearProvisionalAssistantMessages,
		followLifecycleStream,
		onLoginRequired,
		ownsOperation,
		replaceActiveRun,
		startOperation,
	]);

	const runtime = useExternalStoreRuntime({
		convertMessage: (message) => message,
		isLoading,
		isRunning,
		messages,
		onCancel,
		onEdit,
		onNew,
		onReload,
		onResume,
	});

	return runtime;
}

function localUserMessage(content: AppendMessage["content"], id: string): ThreadMessageLike {
	return {
		content: typeof content === "string" ? [{ text: content, type: "text" }] : content,
		createdAt: new Date(),
		id,
		role: "user",
	};
}

function readMessageText(message: ThreadMessageLike | undefined): string {
	if (!message) {
		return "";
	}
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function readTextContent(message: AppendMessage): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

function isTerminalRunStatus(status: ChatRunStatus): boolean {
	return (
		status.phase === "completed" ||
		status.phase === "failed" ||
		status.phase === "canceled" ||
		status.phase === "expired"
	);
}

function streamRecoveryExhausted(run?: ActiveRun): ChatStreamRequestError {
	return new ChatStreamRequestError({
		code: "chat_stream_connection_lost",
		message: "回答连接已中断，请重试。",
		...(run?.requestId ? { requestId: run.requestId } : {}),
		retryable: true,
		...(run?.traceId ? { traceId: run.traceId } : {}),
	});
}

async function fetchConversationMessagesWithRetry(
	conversationId: string,
	signal: AbortSignal,
	fetchMessages: (conversationId: string, signal?: AbortSignal) => Promise<RuntimeMessages>,
): Promise<RuntimeMessages> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			return await fetchMessages(conversationId, signal);
		} catch (error) {
			lastError = error;
			if (error instanceof UnauthorizedError || isAbortError(error) || attempt === 2) {
				throw error;
			}
			await waitForResumeDelay((attempt + 1) * RESUME_INITIAL_DELAY_MS, signal);
		}
	}
	throw lastError instanceof Error ? lastError : new Error("Conversation refresh failed.");
}

function waitForResumeDelay(delayMs: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new DOMException("The operation was aborted.", "AbortError"));
			return;
		}
		const timeoutId = window.setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		const onAbort = () => {
			window.clearTimeout(timeoutId);
			reject(new DOMException("The operation was aborted.", "AbortError"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function isRunAlreadyTerminalError(error: unknown): boolean {
	return error instanceof ChatStreamRequestError && error.code === "run_already_terminal";
}
