import { type ChatRunStatus, ChatStreamRequestError } from "./api";

export const RESUME_INITIAL_DELAY_MS = 250;
export const RESUME_MAX_DELAY_MS = 5_000;
export const MAX_INITIAL_STREAM_REPLAYS = 3;
export const MAX_CONSECUTIVE_RECOVERY_FAILURES = 3;

interface RecoveryRequestIdentity {
	requestId: string;
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

export function streamRecoveryExhausted(run?: RecoveryRequestIdentity): ChatStreamRequestError {
	return new ChatStreamRequestError({
		code: "chat_stream_connection_lost",
		message: "回答连接已中断，请重试。",
		...(run?.requestId ? { requestId: run.requestId } : {}),
		retryable: true,
	});
}

export function isStreamRecoveryExhausted(error: unknown): boolean {
	return error instanceof ChatStreamRequestError && error.code === "chat_stream_connection_lost";
}

export function isRunAlreadyTerminalError(error: unknown): boolean {
	return error instanceof ChatStreamRequestError && error.code === "request_already_terminal";
}

export function isPersistedConversationMessageId(
	messageId: string | null | undefined,
): messageId is string {
	return Boolean(messageId && !messageId.startsWith("local-"));
}
