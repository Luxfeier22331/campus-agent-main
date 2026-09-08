import { useCallback } from "react";
import { UnauthorizedError } from "@/platform/api/client";

import { ChatStreamRequestError, getRunEvents, getRunStatus, resumeRunEventsStream } from "./api";
import { toAssistantThreadMessages } from "./assistant-ui-mappers";
import type { RuntimeMessages } from "./assistant-ui-message-projection";
import { isAbortError, isTerminalRunStatus } from "./assistant-ui-recovery-policy";
import type { RuntimeRunAction, RuntimeRunState } from "./conversation-run-types";
import type { ChatRequestStreamEvent, ConversationDetail } from "./model";
import type { ChatRunStatus } from "./run-client";
import type {
	ActiveRun,
	RunOperationMachine,
	RuntimeOperationIdentity,
} from "./run-operation-machine";
import {
	type FollowLifecycleStreamInput,
	streamFromEvents,
} from "./use-conversation-lifecycle-stream";

export function useConversationRunRecovery({
	applyRunStateAction,
	applyTerminalRunStatus,
	consumeLifecycleStream,
	fetchConversationMessages,
	followLifecycleStream,
	markRunDisconnected,
	onLoginRequired,
	operationMachine,
	ownsOperation,
	replaceWithCanonicalMessages,
	setIsRunning,
	startOperation,
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
	onLoginRequired: () => void;
	operationMachine: RunOperationMachine;
	ownsOperation: (operation: RuntimeOperationIdentity) => boolean;
	replaceWithCanonicalMessages: (messages: RuntimeMessages) => void;
	setIsRunning: (isRunning: boolean) => void;
	startOperation: () => RuntimeOperationIdentity;
	updateActiveRun: (update: (current: ActiveRun | null) => ActiveRun | null) => void;
}) {
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
			operationMachine,
			ownsOperation,
			replaceWithCanonicalMessages,
			setIsRunning,
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
		const controller = operation.controller;
		applyRunStateAction({
			operationId: operation.id,
			requestId: currentRun.requestId,
			type: "rebind",
		});
		setIsRunning(true);
		try {
			applyRunStateAction({
				type: "connection",
				connection: "recovering",
				operationId: operation.id,
			});
			const status = await getRunStatus({
				requestId: currentRun.requestId,
				signal: controller.signal,
			});
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
		applyTerminalRunStatus,
		followLifecycleStream,
		markRunDisconnected,
		onLoginRequired,
		operationMachine,
		ownsOperation,
		setIsRunning,
		startOperation,
	]);

	return { onResume, restoreConversationRun };
}
