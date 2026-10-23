import { type ChatRunStatus, ChatStreamRequestError } from "./api";

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

export function isRunAlreadyTerminalError(error: unknown): boolean {
	return error instanceof ChatStreamRequestError && error.code === "request_already_terminal";
}

export function isPersistedConversationMessageId(
	messageId: string | null | undefined,
): messageId is string {
	return Boolean(messageId && !messageId.startsWith("local-"));
}
