import {
	type AppendMessage,
	type ThreadMessageLike,
	useAui,
	useAuiState,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createIdempotencyKey, UnauthorizedError } from "@/platform/api/client";
import { recordChatBrowserTtft } from "@/platform/telemetry/sentry-browser-loader";
import {
	ChatStreamRequestError,
	cancelRun,
	deleteTrailingMessages,
	getConversationDetail,
	resumeRunEventsStream,
	submitChatRequestStream,
} from "./api";
import { toAssistantThreadMessages } from "./assistant-ui-mappers";
import type { ChatRequestStreamEvent } from "./model";

type RuntimeMessages = ThreadMessageLike[];

const TYPEWRITER_INITIAL_CHARS = 3;
const TYPEWRITER_CHUNK_CHARS = 2;
const TYPEWRITER_INTERVAL_MS = 24;
const RESUME_INITIAL_DELAY_MS = 250;
const RESUME_MAX_DELAY_MS = 5_000;

interface ActiveRun {
	conversationId?: string;
	requestId: string;
	runId: string;
	sequence?: number;
	traceId: string;
}

interface RuntimeOperationIdentity {
	id: number;
	controller: AbortController;
}

interface RuntimeOperation extends RuntimeOperationIdentity {
	browserTtftRecorded: boolean;
	browserTtftStartedAt: number | null;
}

type RunCancellationState =
	| { phase: "idle" }
	| { operationId: number; phase: "awaiting_run_id" }
	| { operationId: number; phase: "requesting"; promise: Promise<void>; runId: string }
	| { operationId: number; phase: "acknowledged"; runId: string };

interface TypewriterState {
	fullText: string;
	intervalId: number | null;
	messageId: string;
	occurredAt: string;
	visibleLength: number;
}

export function createCampusAssistantRuntimeHook(input: {
	hasSession: boolean;
	onLoginRequired: () => void;
}) {
	return function useCampusAssistantExternalStoreRuntime() {
		return useCampusAssistantRuntimeState({
			hasSession: input.hasSession,
			onLoginRequired: input.onLoginRequired,
		});
	};
}

function useCampusAssistantRuntimeState({
	hasSession,
	onLoginRequired,
}: {
	hasSession: boolean;
	onLoginRequired: () => void;
}) {
	const aui = useAui();
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const [isLoading, setIsLoading] = useState(false);
	const [isRunning, setIsRunning] = useState(false);
	const [messages, setMessages] = useState<RuntimeMessages>([]);
	const activeRunRef = useRef<ActiveRun | null>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const cancellationStateRef = useRef<RunCancellationState>({ phase: "idle" });
	const operationIdRef = useRef(0);
	const locallyInitializedRunConversationIdRef = useRef<string | null>(null);
	const provisionalAssistantMessageIdsRef = useRef(new Set<string>());
	const streamedAnswerTextRef = useRef(new Map<string, string>());
	const typewriterRef = useRef<TypewriterState | null>(null);

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

	const startOperation = useCallback((measureBrowserTtft = false): RuntimeOperation => {
		abortControllerRef.current?.abort();
		cancellationStateRef.current = { phase: "idle" };
		if (measureBrowserTtft) {
			streamedAnswerTextRef.current.clear();
		}
		const controller = new AbortController();
		const operation = {
			browserTtftRecorded: false,
			browserTtftStartedAt: measureBrowserTtft ? performance.now() : null,
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

	const clearTypewriter = useCallback(() => {
		const current = typewriterRef.current;
		if (current?.intervalId !== null && current?.intervalId !== undefined) {
			window.clearInterval(current.intervalId);
		}
		typewriterRef.current = null;
	}, []);

	const clearProvisionalAssistantMessages = useCallback(() => {
		const provisionalIds = new Set(provisionalAssistantMessageIdsRef.current);
		if (provisionalIds.size > 0) {
			setMessages((current) =>
				current.filter((message) => !(message.id && provisionalIds.has(message.id))),
			);
		}
		provisionalAssistantMessageIdsRef.current.clear();
		streamedAnswerTextRef.current.clear();
	}, []);

	const replaceWithCanonicalMessages = useCallback((nextMessages: RuntimeMessages) => {
		provisionalAssistantMessageIdsRef.current.clear();
		streamedAnswerTextRef.current.clear();
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
		[appendCancellationFailure, onLoginRequired, ownsOperation],
	);

	const finishTypewriter = useCallback(() => {
		const current = typewriterRef.current;
		if (!current) {
			return;
		}
		if (current.intervalId !== null) {
			window.clearInterval(current.intervalId);
			current.intervalId = null;
		}
		typewriterRef.current = null;
		revealAssistantText({
			messageId: current.messageId,
			occurredAt: current.occurredAt,
			text: current.fullText,
		});
	}, [revealAssistantText]);

	const startTypewriterInterval = useCallback(
		(state: TypewriterState) => {
			if (state.intervalId !== null) {
				window.clearInterval(state.intervalId);
				state.intervalId = null;
			}
			if (state.visibleLength >= state.fullText.length) {
				finishTypewriter();
				return;
			}
			state.intervalId = window.setInterval(() => {
				const current = typewriterRef.current;
				if (!current || current.messageId !== state.messageId) {
					window.clearInterval(state.intervalId ?? undefined);
					return;
				}
				current.visibleLength = Math.min(
					current.fullText.length,
					current.visibleLength + TYPEWRITER_CHUNK_CHARS,
				);
				revealAssistantText({
					messageId: current.messageId,
					occurredAt: current.occurredAt,
					text: current.fullText.slice(0, current.visibleLength),
				});
				if (current.visibleLength >= current.fullText.length) {
					finishTypewriter();
				}
			}, TYPEWRITER_INTERVAL_MS);
		},
		[finishTypewriter, revealAssistantText],
	);

	useEffect(() => clearTypewriter, [clearTypewriter]);

	useEffect(() => {
		if (remoteId && locallyInitializedRunConversationIdRef.current === remoteId) {
			return;
		}

		const operationId = ++operationIdRef.current;
		abortControllerRef.current?.abort();
		clearTypewriter();
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
		clearTypewriter,
		fetchConversationMessages,
		onLoginRequired,
		remoteId,
		replaceActiveRun,
		replaceWithCanonicalMessages,
	]);

	const applyTerminalEvent = useCallback(
		async (event: ChatRequestStreamEvent, operation: RuntimeOperation) => {
			if (!ownsOperation(operation)) {
				return;
			}
			const conversationId =
				event.data.answer?.conversation.id ?? activeRunRef.current?.conversationId ?? remoteId;
			cancellationStateRef.current = { phase: "idle" };
			setIsRunning(false);
			replaceActiveRun(null);
			if (conversationId && locallyInitializedRunConversationIdRef.current === conversationId) {
				locallyInitializedRunConversationIdRef.current = null;
			}
			if (event.event === "request.failed" && event.data.error) {
				clearTypewriter();
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
				clearTypewriter();
				replaceWithCanonicalMessages(terminalMessages);
			} else if (conversationId) {
				clearTypewriter();
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
			clearTypewriter,
			fetchConversationMessages,
			ownsOperation,
			remoteId,
			replaceActiveRun,
			replaceWithCanonicalMessages,
		],
	);

	const applyAnswerDelta = useCallback(
		(event: ChatRequestStreamEvent, operation: RuntimeOperation) => {
			if (!ownsOperation(operation)) {
				return;
			}
			const messageId = event.data.messageId?.trim();
			const delta = event.data.delta;
			if (!messageId || typeof delta !== "string" || delta.length === 0) {
				return;
			}
			const current = typewriterRef.current;
			const text = (streamedAnswerTextRef.current.get(messageId) ?? "") + delta;
			streamedAnswerTextRef.current.set(messageId, text);
			if (!operation.browserTtftRecorded && operation.browserTtftStartedAt !== null) {
				operation.browserTtftRecorded = true;
				recordChatBrowserTtft(performance.now() - operation.browserTtftStartedAt);
			}
			const visibleLength =
				current?.messageId === messageId
					? Math.min(current.visibleLength, text.length)
					: Math.min(TYPEWRITER_INITIAL_CHARS, text.length);
			if (current && current.messageId !== messageId) {
				clearTypewriter();
			}
			const nextState: TypewriterState = {
				fullText: text,
				intervalId: current?.messageId === messageId ? current.intervalId : null,
				messageId,
				occurredAt: event.data.occurredAt,
				visibleLength,
			};
			typewriterRef.current = nextState;
			revealAssistantText({
				messageId,
				occurredAt: event.data.occurredAt,
				text: text.slice(0, visibleLength),
			});
			startTypewriterInterval(nextState);
		},
		[clearTypewriter, ownsOperation, revealAssistantText, startTypewriterInterval],
	);

	const consumeLifecycleStream = useCallback(
		async (
			events: AsyncIterable<ChatRequestStreamEvent>,
			conversationId: string | undefined,
			operation: RuntimeOperation,
		) => {
			let eventCount = 0;
			for await (const event of events) {
				if (!ownsOperation(operation)) {
					return { eventCount, terminal: true };
				}
				eventCount += 1;
				if (event.event === "request.accepted" && event.data.runId) {
					const acceptedRun = {
						conversationId,
						requestId: event.data.requestId,
						runId: event.data.runId,
						sequence: event.data.sequence,
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
						conversationId: current?.conversationId ?? conversationId,
						requestId: event.data.requestId,
						runId,
						sequence: event.data.sequence ?? current?.sequence,
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
			operation: RuntimeOperation;
			initialEvents: AsyncIterable<ChatRequestStreamEvent>;
			retryInitialEvents?: () => AsyncIterable<ChatRequestStreamEvent>;
		}) => {
			let delayMs = RESUME_INITIAL_DELAY_MS;
			let events = input.initialEvents;
			for (;;) {
				if (!ownsOperation(input.operation)) {
					return;
				}
				try {
					const consumed = await consumeLifecycleStream(
						events,
						input.conversationId,
						input.operation,
					);
					if (consumed.terminal || input.controller.signal.aborted) {
						return;
					}
					if (consumed.eventCount > 0) {
						delayMs = RESUME_INITIAL_DELAY_MS;
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
					await waitForResumeDelay(delayMs, input.controller.signal);
					events = input.retryInitialEvents();
					delayMs = Math.min(delayMs * 2, RESUME_MAX_DELAY_MS);
					continue;
				}
				await waitForResumeDelay(delayMs, input.controller.signal);
				events = resumeRunEventsStream({
					afterSequence: run.sequence,
					runId: run.runId,
					signal: input.controller.signal,
				});
				delayMs = Math.min(delayMs * 2, RESUME_MAX_DELAY_MS);
			}
		},
		[consumeLifecycleStream, ownsOperation],
	);

	const runPrompt = useCallback(
		async (input: {
			conversationId: string | undefined;
			messageContent: AppendMessage["content"];
			prompt: string;
			truncateFromMessageId?: string;
		}) => {
			const prompt = input.prompt.trim();
			if (!prompt) {
				throw new Error("Message text is required.");
			}
			if (!hasSession) {
				onLoginRequired();
				return;
			}
			const operation = startOperation(true);
			const controller = operation.controller;
			clearTypewriter();
			clearProvisionalAssistantMessages();
			replaceActiveRun(null);
			cancellationStateRef.current = { phase: "idle" };
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
			setMessages((current) => [...current, localUserMessage(input.messageContent)]);
			setIsRunning(true);

			try {
				if (input.truncateFromMessageId && input.conversationId) {
					await deleteTrailingMessages({
						conversationId: input.conversationId,
						messageId: input.truncateFromMessageId,
					});
				}
				const idempotencyKey = createIdempotencyKey();
				const submitEvents = () =>
					submitChatRequestStream({
						conversationId: input.conversationId,
						idempotencyKey,
						prompt,
						signal: controller.signal,
					});
				await followLifecycleStream({
					conversationId: input.conversationId,
					controller,
					operation,
					initialEvents: submitEvents(),
					retryInitialEvents: submitEvents,
				});
			} catch (error) {
				if (!ownsOperation(operation)) {
					return;
				}
				setIsRunning(false);
				if (error instanceof UnauthorizedError) {
					replaceActiveRun(null);
					clearTypewriter();
					clearProvisionalAssistantMessages();
					onLoginRequired();
					return;
				}
				if (isAbortError(error)) {
					clearTypewriter();
					clearProvisionalAssistantMessages();
					return;
				}
				if (error instanceof ChatStreamRequestError) {
					replaceActiveRun(null);
					clearTypewriter();
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
			clearProvisionalAssistantMessages,
			clearTypewriter,
			followLifecycleStream,
			hasSession,
			onLoginRequired,
			ownsOperation,
			replaceActiveRun,
			startOperation,
		],
	);

	const onNew = useCallback(
		async (message: AppendMessage) => {
			if (!hasSession) {
				onLoginRequired();
				return;
			}
			const existingRemoteId = remoteId;
			const conversationId =
				existingRemoteId ?? (await aui.threadListItem().initialize()).remoteId ?? undefined;
			if (!existingRemoteId && conversationId) {
				locallyInitializedRunConversationIdRef.current = conversationId;
			}
			await runPrompt({
				conversationId,
				messageContent: message.content,
				prompt: readTextContent(message),
			});
		},
		[aui.threadListItem, hasSession, onLoginRequired, remoteId, runPrompt],
	);

	const onEdit = useCallback(
		async (message: AppendMessage) => {
			const conversationId = remoteId;
			const truncateFromMessageId = message.parentId;
			await runPrompt({
				conversationId,
				messageContent: message.content,
				prompt: readTextContent(message),
				truncateFromMessageId: truncateFromMessageId ?? undefined,
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
		if (currentRun?.runId && controller) {
			return requestRunCancellation(currentRun, {
				controller,
				id: operationIdRef.current,
			});
		}
		if (isRunning && controller) {
			const cancellation = cancellationStateRef.current;
			if (cancellation.phase === "idle" || cancellation.operationId !== operationIdRef.current) {
				cancellationStateRef.current = {
					operationId: operationIdRef.current,
					phase: "awaiting_run_id",
				};
			}
			return;
		}
		cancellationStateRef.current = { phase: "idle" };
		clearTypewriter();
		clearProvisionalAssistantMessages();
		locallyInitializedRunConversationIdRef.current = null;
		abortControllerRef.current?.abort();
		abortControllerRef.current = null;
		operationIdRef.current += 1;
		setIsRunning(false);
		replaceActiveRun(null);
	}, [
		clearProvisionalAssistantMessages,
		clearTypewriter,
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
		setIsRunning(true);
		try {
			await followLifecycleStream({
				conversationId: currentRun.conversationId,
				controller,
				operation,
				initialEvents: resumeRunEventsStream({
					afterSequence: currentRun.sequence,
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
				clearTypewriter();
				clearProvisionalAssistantMessages();
				onLoginRequired();
				return;
			}
			if (isAbortError(error)) {
				clearTypewriter();
				clearProvisionalAssistantMessages();
				return;
			}
			clearTypewriter();
			clearProvisionalAssistantMessages();
			throw error;
		} finally {
			if (ownsOperation(operation) && abortControllerRef.current === controller) {
				abortControllerRef.current = null;
			}
		}
	}, [
		clearProvisionalAssistantMessages,
		clearTypewriter,
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

function localUserMessage(content: AppendMessage["content"]): ThreadMessageLike {
	return {
		content: typeof content === "string" ? [{ text: content, type: "text" }] : content,
		createdAt: new Date(),
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
