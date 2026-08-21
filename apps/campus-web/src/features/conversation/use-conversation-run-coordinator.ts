import type { AppendMessage } from "@assistant-ui/react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
	isStreamRecoveryExhausted,
	isTerminalRunStatus,
	MAX_CONSECUTIVE_RECOVERY_FAILURES,
	MAX_INITIAL_STREAM_REPLAYS,
	nextResumeDelay,
	RESUME_INITIAL_DELAY_MS,
	streamRecoveryExhausted,
} from "./assistant-ui-recovery-policy";
import {
	ConversationInitializationRegistry,
	type ConversationInitializationTarget,
} from "./conversation-initialization";
import type { ChatRequestStreamEvent } from "./model";
import {
	consumeRunLifecycleEvents,
	fetchConversationMessagesWithRetry,
	waitForResumeDelay,
} from "./run-lifecycle-consumer";
import {
	type ActiveRun,
	type RunCancellationState,
	RunOperationMachine,
	type RuntimeOperationIdentity,
} from "./run-operation-machine";
import {
	type CampusRunViewAction,
	type CampusRunViewState,
	EMPTY_CAMPUS_RUN_VIEW,
	reduceCampusRunViewState,
} from "./run-view-state";
import { useAssistantUiMessageProjection } from "./use-assistant-ui-message-projection";

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
		appendProvisionalAssistantMessage,
		cancelAssistantFrame,
		clearMessages,
		clearProvisionalAssistantMessages,
		flushAssistantFrame,
		messages,
		migrateProvisionalAssistantMessage,
		removeMessage,
		replaceWithCanonicalMessages,
		revealAccumulatedAssistantText,
		scheduleAssistantFrame,
		truncateMessagesFrom,
		updateAssistantRunView,
	} = useAssistantUiMessageProjection();
	const [runView, dispatchRunView] = useReducer(reduceCampusRunViewState, EMPTY_CAMPUS_RUN_VIEW);
	const runViewRef = useRef(EMPTY_CAMPUS_RUN_VIEW);
	const applyTerminalRunStatusRef = useRef<
		((status: ChatRunStatus, operation: RuntimeOperationIdentity) => Promise<void>) | null
	>(null);

	const applyRunViewAction = useCallback(
		(action: CampusRunViewAction): CampusRunViewState => {
			const next = reduceCampusRunViewState(runViewRef.current, action);
			runViewRef.current = next;
			dispatchRunView(action);
			updateAssistantRunView(next);
			return next;
		},
		[updateAssistantRunView],
	);

	const applyRunViewEvent = useCallback(
		(event: ChatRequestStreamEvent, operationId: number): CampusRunViewState =>
			applyRunViewAction({ event, operationId, type: "event" }),
		[applyRunViewAction],
	);

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

	const startOperation = useCallback(
		(): RuntimeOperationIdentity => operationMachineRef.current.start(),
		[],
	);

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
			const current = operationMachineRef.current.cancellation;
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
					(status) => {
						if (
							operationMachineRef.current.cancellation === request &&
							ownsOperation(operation) &&
							operationMachineRef.current.activeRun?.runId === run.runId
						) {
							applyRunViewAction({
								operationId: operation.id,
								run: status,
								sequence: runViewRef.current.sequence,
								type: "hydrate",
							});
							if (isTerminalRunStatus(status)) {
								void applyTerminalRunStatusRef.current?.(status, operation);
								return;
							}
							operationMachineRef.current.cancellation = {
								operationId: operation.id,
								phase: "acknowledged",
								runId: run.runId,
							};
						}
					},
					(error: unknown) => {
						if (operationMachineRef.current.cancellation !== request) {
							return;
						}
						if (isRunAlreadyTerminalError(error)) {
							void getRunStatus({
								runId: run.runId,
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
											runId: run.runId,
										};
									}
								})
								.catch(() => undefined);
							return;
						}
						operationMachineRef.current.cancellation = { phase: "idle" };
						if (
							!ownsOperation(operation) ||
							operationMachineRef.current.activeRun?.runId !== run.runId
						) {
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
			operationMachineRef.current.cancellation = request;
			return request.promise;
		},
		[
			appendCancellationFailure,
			applyRunViewAction,
			onLoginRequired,
			ownsOperation,
			revealAccumulatedAssistantText,
		],
	);

	useEffect(
		() => () => {
			operationMachineRef.current.invalidate();
			initializationRegistryRef.current.clear();
		},
		[],
	);

	const applyTerminalEvent = useCallback(
		async (event: ChatRequestStreamEvent, operation: RuntimeOperationIdentity) => {
			if (!ownsOperation(operation)) {
				return;
			}
			flushAssistantFrame();
			const conversationId =
				event.data.answer?.conversation.id ??
				operationMachineRef.current.activeRun?.conversationId ??
				remoteId;
			const terminalRunView = runViewRef.current;
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
							traceId: event.data.traceId,
						})
					: null;
			if (event.event === "request.cancelled") {
				flushAssistantFrame();
				return;
			}
			if (event.data.answer) {
				const terminalMessages = toAssistantThreadMessages(event.data.answer.conversation);
				cancelAssistantFrame();
				replaceWithCanonicalMessages(terminalMessages, terminalRunView);
				return;
			}
			if (conversationId) {
				cancelAssistantFrame();
				clearProvisionalAssistantMessages();
				try {
					const nextMessages = await fetchConversationMessagesWithRetry(
						conversationId,
						operation.controller.signal,
						fetchConversationMessages,
					);
					if (ownsOperation(operation)) {
						replaceWithCanonicalMessages(nextMessages, terminalRunView);
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
								traceId: event.data.traceId,
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
			cancelAssistantFrame,
			clearProvisionalAssistantMessages,
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
			appendAssistantDelta(messageId, delta, event.data.occurredAt);
			const cancellation = operationMachineRef.current.cancellation;
			if (
				(cancellation.phase === "awaiting_run_id" ||
					cancellation.phase === "requesting" ||
					cancellation.phase === "acknowledged") &&
				cancellation.operationId === operation.id
			) {
				return;
			}
			migrateProvisionalAssistantMessage({
				messageId,
				occurredAt: event.data.occurredAt,
			});
			scheduleAssistantFrame(messageId, event.data.occurredAt);
		},
		[
			appendAssistantDelta,
			migrateProvisionalAssistantMessage,
			ownsOperation,
			scheduleAssistantFrame,
		],
	);

	const applyTerminalRunStatus = useCallback(
		async (status: ChatRunStatus, operation: RuntimeOperationIdentity) => {
			if (!ownsOperation(operation)) {
				return;
			}
			const terminalRunView = applyRunViewAction({
				operationId: operation.id,
				run: status,
				sequence: runViewRef.current.sequence,
				type: "hydrate",
			});
			cancelAssistantFrame();
			operationMachineRef.current.cancellation = { phase: "idle" };
			setIsRunning(false);
			replaceActiveRun(null);
			if (initializationRegistryRef.current.local?.conversationId === status.conversationId) {
				initializationRegistryRef.current.local = null;
			}
			try {
				const nextMessages = await fetchConversationMessagesWithRetry(
					status.conversationId,
					operation.controller.signal,
					fetchConversationMessages,
				);
				if (ownsOperation(operation)) {
					replaceWithCanonicalMessages(nextMessages, terminalRunView);
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
			applyRunViewAction,
			cancelAssistantFrame,
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
		) =>
			consumeRunLifecycleEvents({
				events,
				isCurrent: () => ownsOperation(operation),
				onAccepted: (event) => {
					if (!event.data.runId) {
						return;
					}
					const acceptedRun = {
						...(conversationId ? { conversationId } : {}),
						requestId: event.data.requestId,
						runId: event.data.runId,
						...(event.data.sequence === undefined ? {} : { sequence: event.data.sequence }),
						traceId: event.data.traceId,
					};
					replaceActiveRun(acceptedRun);
					const cancellation = operationMachineRef.current.cancellation;
					if (
						cancellation.phase === "awaiting_run_id" &&
						cancellation.operationId === operation.id
					) {
						void requestRunCancellation(acceptedRun, operation);
					}
				},
				onAnswerDelta: (event) => applyAnswerDelta(event, operation),
				onEvent: (event) => {
					applyRunViewEvent(event, operation.id);
					onEvent();
				},
				onRunEvent: (event) => {
					if (!event.data.runId) {
						return;
					}
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
				},
				onTerminal: (event) => applyTerminalEvent(event, operation),
			}),
		[
			applyAnswerDelta,
			applyTerminalEvent,
			applyRunViewEvent,
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
					if (!(operationMachineRef.current.activeRun || input.retryInitialEvents)) {
						throw error;
					}
				}

				const run = ownsOperation(input.operation) ? operationMachineRef.current.activeRun : null;
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
					delayMs = nextResumeDelay(delayMs);
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
					applyRunViewAction({
						operationId: input.operation.id,
						run: status,
						...(run.sequence === undefined ? {} : { sequence: run.sequence }),
						type: "hydrate",
					});
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
				applyRunViewAction({
					connection: "reconnecting",
					operationId: input.operation.id,
					runId: run.runId,
					type: "connection",
				});
				await waitForResumeDelay(delayMs, input.controller.signal);
				events = resumeRunEventsStream({
					...(run.sequence === undefined ? {} : { afterSequence: run.sequence }),
					runId: run.runId,
					signal: input.controller.signal,
				});
				delayMs = nextResumeDelay(delayMs);
			}
		},
		[
			applyRunViewAction,
			applyTerminalRunStatus,
			consumeLifecycleStream,
			ownsOperation,
			updateActiveRun,
		],
	);

	const markRunDisconnected = useCallback(
		(operationId: number, runId: string | null) => {
			applyRunViewAction({
				connection: "disconnected",
				operationId,
				...(runId === null ? {} : { runId }),
				type: "connection",
			});
		},
		[applyRunViewAction],
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
			applyRunViewAction({ operationId: operation.id, type: "reset" });
			replaceWithCanonicalMessages(canonicalMessages);
			if (!conversation.activeRunId) {
				setIsRunning(false);
				return;
			}

			const runId = conversation.activeRunId;
			try {
				const status = await getRunStatus({ runId, signal: operation.controller.signal });
				if (!ownsOperation(operation)) {
					return;
				}
				const activeRun: ActiveRun = {
					conversationId,
					requestId: status.requestId,
					runId: status.runId,
					traceId: status.traceId,
				};
				replaceActiveRun(activeRun);
				const hydrated = applyRunViewAction({
					operationId: operation.id,
					run: status,
					type: "hydrate",
				});
				const hasAssistantForRun = canonicalMessages.some((message) => {
					if (message.role !== "assistant") {
						return false;
					}
					const metadata = message.metadata?.custom?.campusRun;
					return Boolean(
						metadata &&
							typeof metadata === "object" &&
							!Array.isArray(metadata) &&
							(metadata as Record<string, unknown>).runId === runId,
					);
				});
				if (!hasAssistantForRun) {
					appendProvisionalAssistantMessage({
						messageId: `local-assistant-${crypto.randomUUID()}`,
						occurredAt: status.acceptedAt,
						runView: hydrated,
					});
				}
				setIsRunning(!isTerminalRunStatus(status));
				if (isTerminalRunStatus(status)) {
					const nextMessages = await fetchConversationMessagesWithRetry(
						conversationId,
						operation.controller.signal,
						fetchConversationMessages,
					);
					if (ownsOperation(operation)) {
						replaceWithCanonicalMessages(nextMessages, hydrated);
						replaceActiveRun(null);
					}
					return;
				}

				const replay = await getRunEvents({
					afterSequence: 0,
					runId,
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
				applyRunViewAction({
					operationId: operation.id,
					run: replay.run,
					sequence: replay.nextSequence,
					type: "hydrate",
				});
				updateActiveRun((current) =>
					current?.runId === runId ? { ...current, sequence: replay.nextSequence } : current,
				);
				await followLifecycleStream({
					conversationId,
					controller: operation.controller,
					operation,
					initialEvents: streamFromEvents([]),
				});
			} catch (error) {
				if (!ownsOperation(operation)) {
					return;
				}
				setIsRunning(false);
				markRunDisconnected(operation.id, runId);
				if (error instanceof UnauthorizedError) {
					onLoginRequired();
					return;
				}
				if (isAbortError(error)) {
					cancelAssistantFrame();
					clearProvisionalAssistantMessages();
					return;
				}
				if (error instanceof ChatStreamRequestError) {
					appendLocalErrorMessage(error);
					return;
				}
				throw error;
			}
		},
		[
			appendLocalErrorMessage,
			appendProvisionalAssistantMessage,
			applyRunViewAction,
			applyTerminalRunStatus,
			cancelAssistantFrame,
			clearProvisionalAssistantMessages,
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

		const operation = operationMachineRef.current.begin();
		const operationId = operation.id;
		const controller = operation.controller;
		cancelAssistantFrame();
		clearProvisionalAssistantMessages();
		operationMachineRef.current.cancellation = { phase: "idle" };
		replaceActiveRun(null);
		applyRunViewAction({ operationId, type: "reset" });
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
		applyRunViewAction,
		clearMessages,
		clearProvisionalAssistantMessages,
		cancelAssistantFrame,
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
			const provisionalAssistantMessageId = `local-assistant-${crypto.randomUUID()}`;
			const acceptedAt = new Date().toISOString();
			cancelAssistantFrame();
			clearProvisionalAssistantMessages();
			replaceActiveRun(null);
			const startedRunView = applyRunViewAction({
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
			appendProvisionalAssistantMessage({
				messageId: provisionalAssistantMessageId,
				occurredAt: acceptedAt,
				runView: startedRunView,
			});
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
					retryInitialEvents: submitEvents,
				});
			} catch (error) {
				if (initializationCleanupFailed) {
					throw error;
				}
				if (!ownsOperation(operation)) {
					return;
				}
				const acceptedRun = operationMachineRef.current.activeRun;
				setIsRunning(false);
				if (error instanceof UnauthorizedError) {
					if (operationMachineRef.current.activeRun) {
						markRunDisconnected(operation.id, operationMachineRef.current.activeRun.runId);
					} else {
						cancelAssistantFrame();
						if (!acceptedRun) {
							clearProvisionalAssistantMessages();
						}
					}
					onLoginRequired();
					return;
				}
				if (isAbortError(error)) {
					cancelAssistantFrame();
					clearProvisionalAssistantMessages();
					return;
				}
				if (error instanceof ChatStreamRequestError) {
					const recoveryExhausted = acceptedRun && isStreamRecoveryExhausted(error);
					if (acceptedRun) {
						markRunDisconnected(operation.id, acceptedRun.runId);
					}
					if (!recoveryExhausted) {
						replaceActiveRun(null);
					}
					cancelAssistantFrame();
					if (!acceptedRun) {
						clearProvisionalAssistantMessages();
					}
					operationMachineRef.current.cancellation = { phase: "idle" };
					const conversationId = acceptedRun?.conversationId ?? input.conversationId;
					if (acceptedRun && conversationId) {
						try {
							const canonicalMessages = await fetchConversationMessages(
								conversationId,
								controller.signal,
							);
							if (!ownsOperation(operation)) {
								return;
							}
							replaceWithCanonicalMessages(canonicalMessages, runViewRef.current);
						} catch (refreshError) {
							if (refreshError instanceof UnauthorizedError) {
								onLoginRequired();
								return;
							}
							if (isAbortError(refreshError)) {
								return;
							}
						}
					}
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
			appendProvisionalAssistantMessage,
			applyRunViewAction,
			cancelAssistantFrame,
			clearProvisionalAssistantMessages,
			fetchConversationMessages,
			followLifecycleStream,
			loginRequired,
			markRunDisconnected,
			onLoginRequired,
			ownsOperation,
			replaceActiveRun,
			replaceWithCanonicalMessages,
			startOperation,
			truncateMessagesFrom,
		],
	);

	const onCancel = useCallback(async () => {
		const currentRun = operationMachineRef.current.activeRun;
		let controller = operationMachineRef.current.controller;
		const cancellation = operationMachineRef.current.cancellation;
		cancelAssistantFrame();
		if (
			controller &&
			cancellation.phase === "initializing" &&
			cancellation.operationId === operationMachineRef.current.operationId
		) {
			clearProvisionalAssistantMessages();
			removeMessage(cancellation.localMessageId);
			initializationRegistryRef.current.local = null;
			operationMachineRef.current.invalidate();
			setIsRunning(false);
			replaceActiveRun(null);
			return;
		}
		if (currentRun?.runId) {
			let operation: RuntimeOperationIdentity;
			if (controller) {
				operation = { controller, id: operationMachineRef.current.operationId };
			} else {
				operation = startOperation();
				controller = operation.controller;
				applyRunViewAction({
					operationId: operation.id,
					runId: currentRun.runId,
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
					phase: "awaiting_run_id",
				};
			}
			return;
		}
		cancelAssistantFrame();
		clearProvisionalAssistantMessages();
		initializationRegistryRef.current.local = null;
		operationMachineRef.current.invalidate();
		setIsRunning(false);
		replaceActiveRun(null);
	}, [
		applyRunViewAction,
		cancelAssistantFrame,
		clearProvisionalAssistantMessages,
		isRunning,
		removeMessage,
		replaceActiveRun,
		requestRunCancellation,
		startOperation,
	]);

	const onResume = useCallback(async () => {
		const currentRun = operationMachineRef.current.activeRun;
		if (!currentRun?.runId) {
			return;
		}
		const operation = startOperation();
		const controller = operation.controller;
		applyRunViewAction({
			operationId: operation.id,
			runId: currentRun.runId,
			type: "rebind",
		});
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
				markRunDisconnected(operation.id, currentRun.runId);
				onLoginRequired();
				return;
			}
			if (isAbortError(error)) {
				cancelAssistantFrame();
				clearProvisionalAssistantMessages();
				return;
			}
			if (error instanceof ChatStreamRequestError) {
				markRunDisconnected(operation.id, currentRun.runId);
				if (!isStreamRecoveryExhausted(error)) {
					replaceActiveRun(null);
				}
				cancelAssistantFrame();
				operationMachineRef.current.cancellation = { phase: "idle" };
				appendLocalErrorMessage(error);
				return;
			}
			markRunDisconnected(operation.id, currentRun.runId);
			throw error;
		} finally {
			operationMachineRef.current.clearController(operation);
		}
	}, [
		appendLocalErrorMessage,
		applyRunViewAction,
		cancelAssistantFrame,
		clearProvisionalAssistantMessages,
		followLifecycleStream,
		markRunDisconnected,
		onLoginRequired,
		ownsOperation,
		replaceActiveRun,
		startOperation,
	]);

	return {
		isLoading,
		isRunning,
		messages,
		runView,
		onCancel,
		onResume,
		requiresConversationInitialization,
		runPrompt,
	};
}
