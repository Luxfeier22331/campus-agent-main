import { useCallback } from "react";
import { UnauthorizedError } from "@/platform/api/client";

import {
	type ChatRunStatus,
	ChatStreamRequestError,
	getRunEvents,
	getRunStatus,
	resumeRunEventsStream,
} from "./api";
import { toAssistantThreadMessages } from "./assistant-ui-mappers";
import type { RuntimeMessages } from "./assistant-ui-message-projection";
import { isAbortError, isTerminalRunStatus } from "./assistant-ui-recovery-policy";
import type { RuntimeRunAction, RuntimeRunState } from "./conversation-run-types";
import type { ChatRequestStreamEvent, ConversationDetail } from "./model";
import type {
	ActiveRun,
	RunOperationMachine,
	RuntimeOperationIdentity,
} from "./run-operation-machine";
import {
	type FollowLifecycleStreamInput,
	streamFromEvents,
} from "./use-conversation-lifecycle-stream";
import { abortableSleep, resumeBackoffDelayMs } from "./use-conversation-run-watchdog";

export function useConversationRunRecovery({
	applyRunStateAction,
	applyTerminalRunStatus,
	consumeLifecycleStream,
	fetchConversationMessages,
	followLifecycleStream,
	markRunDisconnected,
	noteRunProgress,
	onLoginRequired,
	operationMachine,
	ownsOperation,
	replaceWithCanonicalMessages,
	setIsRunning,
	startOperation,
	startWatchdog,
	updateActiveRun,
}: {
	applyRunStateAction: (action: RuntimeRunAction) => RuntimeRunState;
	applyTerminalRunStatus: (
		status: ChatRunStatus,
		operation: RuntimeOperationIdentity,
	) => Promise<void>;
	consumeLifecycleStream: (
		events: AsyncIterable<ChatRequestStreamEvent>,
		conversationId: string | undefined,
		operation: RuntimeOperationIdentity,
	) => Promise<{ terminal: boolean }>;
	fetchConversationMessages: (
		conversationId: string,
		signal?: AbortSignal,
	) => Promise<RuntimeMessages>;
	followLifecycleStream: (input: FollowLifecycleStreamInput) => Promise<void>;
	markRunDisconnected: (operationId: number, requestId: string | null) => void;
	noteRunProgress: () => void;
	onLoginRequired: () => void;
	operationMachine: RunOperationMachine;
	ownsOperation: (operation: RuntimeOperationIdentity) => boolean;
	replaceWithCanonicalMessages: (messages: RuntimeMessages) => void;
	setIsRunning: (isRunning: boolean) => void;
	startOperation: () => RuntimeOperationIdentity;
	startWatchdog: () => void;
	updateActiveRun: (update: (current: ActiveRun | null) => ActiveRun | null) => void;
}) {
	const resumeRunWithBackoff = useCallback(
		async (run: ActiveRun, operation: RuntimeOperationIdentity) => {
			applyRunStateAction({
				connection: "recovering",
				operationId: operation.id,
				type: "connection",
			});
			let attempt = 0;
			for (;;) {
				const currentRun = operationMachine.activeRun ?? run;
				try {
					const status = await getRunStatus({
						requestId: currentRun.requestId,
						signal: operation.controller.signal,
					});
					noteRunProgress();
					if (!ownsOperation(operation)) {
						return;
					}
					if (isTerminalRunStatus(status)) {
						await applyTerminalRunStatus(status, operation);
						return;
					}
					await followLifecycleStream({
						...(currentRun.conversationId ? { conversationId: currentRun.conversationId } : {}),
						operation,
						initialEvents: resumeRunEventsStream({
							...(operationMachine.activeRun?.answerIndex === undefined
								? {}
								: { afterAnswerIndex: operationMachine.activeRun.answerIndex }),
							...(currentRun.sequence === undefined ? {} : { afterSequence: currentRun.sequence }),
							requestId: currentRun.requestId,
							signal: operation.controller.signal,
						}),
					});
					return;
				} catch (error) {
					if (!ownsOperation(operation)) {
						return;
					}
					if (error instanceof UnauthorizedError || isAbortError(error)) {
						throw error;
					}
					if (
						!(error instanceof ChatStreamRequestError || error instanceof TypeError) ||
						(error instanceof ChatStreamRequestError && error.retryable === false)
					) {
						throw error;
					}
					attempt += 1;
					markRunDisconnected(operation.id, currentRun.requestId);
					if (!ownsOperation(operation)) {
						return;
					}
					applyRunStateAction({
						connection: "recovering",
						operationId: operation.id,
						type: "connection",
					});
					await abortableSleep(resumeBackoffDelayMs(attempt), operation.controller.signal);
				}
			}
		},
		[
			applyRunStateAction,
			applyTerminalRunStatus,
			followLifecycleStream,
			markRunDisconnected,
			noteRunProgress,
			operationMachine,
			ownsOperation,
		],
	);

	const restoreConversationRun = useCallback(
		async (
			conversationId: string,
			conversation: ConversationDetail,
			operation: RuntimeOperationIdentity,
		) => {
			if (!ownsOperation(operation)) {
				return;
			}
			applyRunStateAction({ operationId: operation.id, type: "reset" });
			replaceWithCanonicalMessages(toAssistantThreadMessages(conversation));
			if (!conversation.activeRequestId) {
				setIsRunning(false);
				return;
			}

			const requestId = conversation.activeRequestId;
			try {
				const status = await getRunStatus({ requestId, signal: operation.controller.signal });
				noteRunProgress();
				if (!ownsOperation(operation)) {
					return;
				}
				const activeRun: ActiveRun = {
					conversationId,
					requestId: status.requestId,
				};
				operationMachine.replaceActiveRun(activeRun);
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
						operationMachine.replaceActiveRun(null);
					}
					return;
				}
				startWatchdog();

				const replay = await getRunEvents({
					afterSequence: 0,
					requestId,
					signal: operation.controller.signal,
				});
				noteRunProgress();
				if (!ownsOperation(operation)) {
					return;
				}
				const consumed = await consumeLifecycleStream(
					streamFromEvents(replay.events),
					conversationId,
					operation,
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
					operation,
					initialEvents: resumeRunEventsStream({
						...(operationMachine.activeRun?.answerIndex === undefined
							? {}
							: { afterAnswerIndex: operationMachine.activeRun.answerIndex }),
						afterSequence: replay.nextSequence,
						requestId,
						signal: operation.controller.signal,
					}),
				});
			} catch (error) {
				if (!ownsOperation(operation)) {
					return;
				}
				if (error instanceof UnauthorizedError) {
					setIsRunning(false);
					markRunDisconnected(operation.id, requestId);
					onLoginRequired();
					return;
				}
				if (isAbortError(error)) {
					return;
				}
				if (error instanceof ChatStreamRequestError) {
					operationMachine.replaceActiveRun({ conversationId, requestId });
					setIsRunning(true);
					markRunDisconnected(operation.id, requestId);
					startWatchdog();
					await resumeRunWithBackoff({ conversationId, requestId }, operation);
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
			noteRunProgress,
			onLoginRequired,
			operationMachine,
			ownsOperation,
			replaceWithCanonicalMessages,
			resumeRunWithBackoff,
			setIsRunning,
			startWatchdog,
			updateActiveRun,
		],
	);

	const onResume = useCallback(async () => {
		const currentRun = operationMachine.activeRun;
		if (
			!currentRun?.requestId ||
			operationMachine.recovering ||
			operationMachine.cancellation.phase !== "idle"
		) {
			return;
		}
		const operation = startOperation();
		operationMachine.recovering = true;
		applyRunStateAction({
			operationId: operation.id,
			requestId: currentRun.requestId,
			type: "rebind",
		});
		setIsRunning(true);
		startWatchdog();
		try {
			await resumeRunWithBackoff(currentRun, operation);
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
			if (error instanceof ChatStreamRequestError || error instanceof TypeError) {
				markRunDisconnected(operation.id, currentRun.requestId);
				operationMachine.cancellation = { phase: "idle" };
				return;
			}
			markRunDisconnected(operation.id, currentRun.requestId);
			throw error;
		} finally {
			if (ownsOperation(operation)) {
				operationMachine.recovering = false;
			}
			operationMachine.clearController(operation);
		}
	}, [
		applyRunStateAction,
		markRunDisconnected,
		onLoginRequired,
		operationMachine,
		ownsOperation,
		resumeRunWithBackoff,
		setIsRunning,
		startOperation,
		startWatchdog,
	]);

	return { onResume, restoreConversationRun };
}
