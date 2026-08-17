import { UnauthorizedError } from "@/platform/api/client";
import type { RuntimeMessages } from "./assistant-ui-message-projection";
import { isAbortError, RESUME_INITIAL_DELAY_MS } from "./assistant-ui-recovery-policy";
import type { ChatRequestStreamEvent } from "./model";

export async function consumeRunLifecycleEvents(input: {
	events: AsyncIterable<ChatRequestStreamEvent>;
	isCurrent: () => boolean;
	onAccepted: (event: ChatRequestStreamEvent) => void | Promise<void>;
	onAnswerDelta: (event: ChatRequestStreamEvent) => void | Promise<void>;
	onEvent: (event: ChatRequestStreamEvent) => void | Promise<void>;
	onRunEvent: (event: ChatRequestStreamEvent) => void | Promise<void>;
	onTerminal: (event: ChatRequestStreamEvent) => void | Promise<void>;
}): Promise<{ eventCount: number; terminal: boolean }> {
	let eventCount = 0;
	for await (const event of input.events) {
		if (!input.isCurrent()) {
			return { eventCount, terminal: true };
		}
		eventCount += 1;
		await input.onEvent(event);
		if (event.event === "request.accepted" && event.data.runId) {
			await input.onAccepted(event);
			continue;
		}
		if (event.data.runId) {
			await input.onRunEvent(event);
		}
		if (event.event === "answer.delta") {
			await input.onAnswerDelta(event);
			continue;
		}
		if (
			event.event === "request.completed" ||
			event.event === "request.failed" ||
			event.event === "request.cancelled"
		) {
			await input.onTerminal(event);
			return { eventCount, terminal: true };
		}
	}
	return { eventCount, terminal: false };
}

export async function fetchConversationMessagesWithRetry(
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

export function waitForResumeDelay(delayMs: number, signal: AbortSignal): Promise<void> {
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
