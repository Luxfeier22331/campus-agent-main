import type { AppendMessage } from "@assistant-ui/react";
import { useCallback, useState } from "react";
import type { ChatStreamRequestError } from "./api";
import {
	localUserMessage,
	type RuntimeMessages,
	upsertAssistantTextMessage,
} from "./assistant-ui-message-projection";

export function useAssistantUiMessageProjection() {
	const [messages, setMessages] = useState<RuntimeMessages>([]);

	const replaceWithCanonicalMessages = useCallback((nextMessages: RuntimeMessages) => {
		setMessages(nextMessages);
	}, []);

	const setRuntimeMessages = useCallback((nextMessages: readonly RuntimeMessages[number][]) => {
		setMessages([...nextMessages]);
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
				metadata: {
					custom: {
						campusMessage: {
							kind: "error",
							requestId: error.requestId,
							retryable: error.retryable,
						},
					},
				},
				role: "assistant",
			},
		]);
	}, []);

	const appendAssistantDelta = useCallback(
		(messageId: string, delta: string, occurredAt: string) => {
			setMessages((current) => {
				const existing = current.find((message) => message.id === messageId);
				const currentText = existing
					? typeof existing.content === "string"
						? existing.content
						: existing.content
								.filter((part) => part.type === "text")
								.map((part) => part.text)
								.join("")
					: "";
				return upsertAssistantTextMessage(current, {
					messageId,
					occurredAt,
					text: currentText + delta,
				});
			});
		},
		[],
	);

	const appendLocalUserMessage = useCallback(
		(content: AppendMessage["content"], messageId: string) => {
			setMessages((current) => [...current, localUserMessage(content, messageId)]);
		},
		[],
	);

	const truncateMessagesFrom = useCallback((messageId: string) => {
		setMessages((current) =>
			current.slice(
				0,
				Math.max(
					current.findIndex((message) => message.id === messageId),
					0,
				),
			),
		);
	}, []);

	const removeMessage = useCallback((messageId: string) => {
		setMessages((current) => current.filter((message) => message.id !== messageId));
	}, []);

	const clearMessages = useCallback(() => {
		setMessages([]);
	}, []);

	return {
		appendAssistantDelta,
		appendLocalErrorMessage,
		appendLocalUserMessage,
		clearMessages,
		messages,
		removeMessage,
		replaceWithCanonicalMessages,
		setRuntimeMessages,
		truncateMessagesFrom,
	};
}
