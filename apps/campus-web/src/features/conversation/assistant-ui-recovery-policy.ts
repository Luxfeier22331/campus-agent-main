import { type ChatRunStatus, ChatStreamRequestError } from "./api";

export const RESUME_INITIAL_DELAY_MS = 250;
export const RESUME_MAX_DELAY_MS = 5_000;
export const MAX_INITIAL_STREAM_REPLAYS = 3;
export const MAX_CONSECUTIVE_RECOVERY_FAILURES = 3;

interface RecoveryRunIdentity {
	requestId: string;
	traceId: string;
}

export function nextResumeDelay(delayMs: number): number {
	return Math.min(delayMs * 2, RESUME_MAX_DELAY_MS);
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

export function isTerminalRunStatus(status: ChatRunStatus): boolean {
	return (
		status.phase === "completed" ||
		status.phase === "failed" ||
		status.phase === "canceled" ||
		status.phase === "expired"
	);
}

export function streamRecoveryExhausted(run?: RecoveryRunIdentity): ChatStreamRequestError {
	return new ChatStreamRequestError({
		code: "chat_stream_connection_lost",
		message: "回答连接已中断，请重试。",
		...(run?.requestId ? { requestId: run.requestId } : {}),
		retryable: true,
		...(run?.traceId ? { traceId: run.traceId } : {}),
	});
}

export function isRunAlreadyTerminalError(error: unknown): boolean {
	return error instanceof ChatStreamRequestError && error.code === "run_already_terminal";
}
