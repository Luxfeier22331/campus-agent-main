import { useCallback } from "react";
import { UnauthorizedError } from "@/platform/api/client";

import { ChatStreamRequestError, cancelRun, getRunStatus } from "./api";
import { isRunAlreadyTerminalError, isTerminalRunStatus } from "./assistant-ui-recovery-policy";
import type { ConversationInitializationRegistry } from "./conversation-initialization";
import type { RuntimeRunAction, RuntimeRunState } from "./conversation-run-types";
import type {
	ActiveRun,
	RunCancellationState,
	RunOperationMachine,
	RuntimeOperationIdentity,
} from "./run-operation-machine";

export function useConversationRunCancellation({
	appendLocalErrorMessage,
	applyRunStateAction,
	applyTerminalRunStatus,
	initializationRegistry,
	isRunning,
	onLoginRequired,
	operationMachine,
	ownsOperation,
	removeMessage,
	revealPendingAssistantDeltas,
	runStateRef,
	setIsRunning,
	startOperation,
}: {
	appendLocalErrorMessage: (error: ChatStreamRequestError) => void;
	applyRunStateAction: (action: RuntimeRunAction) => RuntimeRunState;
	applyTerminalRunStatus: (
		status: Awaited<ReturnType<typeof getRunStatus>>,
		operation: RuntimeOperationIdentity,
	) => Promise<void>;
	initializationRegistry: ConversationInitializationRegistry;
	isRunning: boolean;
	onLoginRequired: () => void;
	operationMachine: RunOperationMachine;
	ownsOperation: (operation: RuntimeOperationIdentity) => boolean;
	removeMessage: (messageId: string) => void;
	revealPendingAssistantDeltas: () => void;
	runStateRef: { current: RuntimeRunState };
	setIsRunning: (isRunning: boolean) => void;
	startOperation: () => RuntimeOperationIdentity;
}) {
	const requestRunCancellation = useCallback(
		(run: ActiveRun, operation: RuntimeOperationIdentity): Promise<void> => {
			const current = operationMachine.cancellation;
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
							operationMachine.cancellation === request &&
							ownsOperation(operation) &&
							operationMachine.activeRun?.requestId === run.requestId
						) {
							applyRunStateAction({
								operationId: operation.id,
								run: status,
								sequence: runStateRef.current.sequence,
								type: "hydrate",
							});
							if (isTerminalRunStatus(status)) {
								void applyTerminalRunStatus(status, operation);
								return;
							}
							operationMachine.cancellation = {
								operationId: operation.id,
								phase: "acknowledged",
								requestId: run.requestId,
							};
						}
					},
					(error: unknown) => {
						if (operationMachine.cancellation !== request) {
							return;
						}
						if (isRunAlreadyTerminalError(error)) {
							void getRunStatus({
								requestId: run.requestId,
								signal: operation.controller.signal,
							})
								.then((status) => {
									if (isTerminalRunStatus(status)) {
										void applyTerminalRunStatus(status, operation);
										return;
									}
									if (ownsOperation(operation)) {
										operationMachine.cancellation = {
											operationId: operation.id,
											phase: "acknowledged",
											requestId: run.requestId,
										};
									}
								})
								.catch(() => undefined);
							return;
						}
						operationMachine.cancellation = { phase: "idle" };
						if (
							!ownsOperation(operation) ||
							operationMachine.activeRun?.requestId !== run.requestId
						) {
							return;
						}
						revealPendingAssistantDeltas();
						if (error instanceof UnauthorizedError) {
							onLoginRequired();
							return;
						}
						appendLocalErrorMessage(
							new ChatStreamRequestError({
								code: "request_cancel_failed",
								message: "取消请求失败，当前回答仍在继续。",
								requestId: run.requestId,
								retryable: true,
							}),
						);
					},
				);
			operationMachine.cancellation = request;
			return request.promise;
		},
		[
			appendLocalErrorMessage,
			applyRunStateAction,
			applyTerminalRunStatus,
			onLoginRequired,
			operationMachine,
			ownsOperation,
			revealPendingAssistantDeltas,
			runStateRef,
		],
	);

	const onCancel = useCallback(async () => {
		const currentRun = operationMachine.activeRun;
		let controller = operationMachine.controller;
		const cancellation = operationMachine.cancellation;
		if (
			controller &&
			cancellation.phase === "initializing" &&
			cancellation.operationId === operationMachine.operationId
		) {
			removeMessage(cancellation.localMessageId);
			initializationRegistry.local = null;
			operationMachine.invalidate();
			setIsRunning(false);
			operationMachine.replaceActiveRun(null);
			return;
		}
		if (currentRun?.requestId) {
			let operation: RuntimeOperationIdentity;
			if (controller) {
				operation = { controller, id: operationMachine.operationId };
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
				cancellation.operationId !== operationMachine.operationId
			) {
				operationMachine.cancellation = {
					operationId: operationMachine.operationId,
					phase: "awaiting_request_id",
				};
			}
			return;
		}
		initializationRegistry.local = null;
		operationMachine.invalidate();
		setIsRunning(false);
		operationMachine.replaceActiveRun(null);
	}, [
		applyRunStateAction,
		initializationRegistry,
		isRunning,
		operationMachine,
		removeMessage,
		requestRunCancellation,
		setIsRunning,
		startOperation,
	]);

	return { onCancel, requestRunCancellation };
}
