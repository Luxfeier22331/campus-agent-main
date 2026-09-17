import { useCallback, useEffect, useRef } from "react";

import { ChatStreamRequestError } from "./api";
import type { RuntimeRunAction } from "./conversation-run-types";
import type { RunOperationMachine } from "./run-operation-machine";

export const RUN_STALL_TIMEOUT_MS = 180_000;

export const RESUME_BACKOFF_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000] as const;

export function resumeBackoffDelayMs(attempt: number): number {
	const index = Math.min(Math.max(attempt, 1), RESUME_BACKOFF_DELAYS_MS.length) - 1;
	return RESUME_BACKOFF_DELAYS_MS[index] ?? RESUME_BACKOFF_DELAYS_MS[0];
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(createAbortError());
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(createAbortError());
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function createAbortError(): Error {
	const error = new DOMException("The operation was aborted.", "AbortError");
	return error;
}

export function useConversationRunWatchdog({
	appendLocalErrorMessage,
	applyRunStateAction,
	operationMachine,
	setIsRunning,
	timeoutMs = RUN_STALL_TIMEOUT_MS,
}: {
	appendLocalErrorMessage: (error: ChatStreamRequestError) => void;
	applyRunStateAction: (action: RuntimeRunAction) => unknown;
	operationMachine: RunOperationMachine;
	setIsRunning: (isRunning: boolean) => void;
	timeoutMs?: number;
}) {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const armedRef = useRef(false);

	const clearTimer = useCallback(() => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		armedRef.current = false;
	}, []);

	const fire = useCallback(() => {
		timerRef.current = null;
		armedRef.current = false;
		const operation = operationMachine.current();
		const requestId = operationMachine.activeRun?.requestId;
		if (!(operation || requestId)) {
			return;
		}
		operationMachine.cancelFailure = null;
		operationMachine.invalidate();
		applyRunStateAction({
			operationId: operation?.id ?? operationMachine.operationId,
			type: "reset",
		});
		setIsRunning(false);
		appendLocalErrorMessage(
			new ChatStreamRequestError({
				code: "answer_stalled",
				message: "回答长时间没有进展，已停止等待，请重试。",
				...(requestId ? { requestId } : {}),
				retryable: true,
			}),
		);
	}, [appendLocalErrorMessage, applyRunStateAction, operationMachine, setIsRunning]);

	const schedule = useCallback(() => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
		}
		timerRef.current = setTimeout(fire, timeoutMs);
	}, [fire, timeoutMs]);

	const startWatchdog = useCallback(() => {
		armedRef.current = true;
		schedule();
	}, [schedule]);

	const noteRunProgress = useCallback(() => {
		if (armedRef.current) {
			schedule();
		}
	}, [schedule]);

	const stopWatchdog = useCallback(() => {
		clearTimer();
	}, [clearTimer]);

	useEffect(() => () => clearTimer(), [clearTimer]);

	return { noteRunProgress, startWatchdog, stopWatchdog };
}
