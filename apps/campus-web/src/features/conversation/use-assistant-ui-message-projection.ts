import type { AppendMessage } from "@assistant-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatStreamRequestError } from "./api";
import { AssistantAnswerBuffer } from "./assistant-answer-buffer";
import {
	localUserMessage,
	type RuntimeMessages,
	removeMessagesById,
	upsertAssistantTextMessage,
} from "./assistant-ui-message-projection";

export function useAssistantUiMessageProjection() {
	const [messages, setMessages] = useState<RuntimeMessages>([]);
	const answerBufferRef = useRef(new AssistantAnswerBuffer());

	const revealAssistantText = useCallback(
		(input: { messageId: string; occurredAt: string; text: string }) => {
			setMessages((current) => upsertAssistantTextMessage(current, input));
		},
		[],
	);

	const cancelAssistantFrame = useCallback(() => {
		answerBufferRef.current.cancelFrame();
	}, []);

	const revealAccumulatedAssistantText = useCallback(() => {
		answerBufferRef.current.revealAll(revealAssistantText);
	}, [revealAssistantText]);

	const clearProvisionalAssistantMessages = useCallback(() => {
		const provisionalIds = answerBufferRef.current.clear();
		if (provisionalIds.size > 0) {
			setMessages((current) => removeMessagesById(current, provisionalIds));
		}
	}, []);

	const replaceWithCanonicalMessages = useCallback((nextMessages: RuntimeMessages) => {
		answerBufferRef.current.markCanonical();
		setMessages(nextMessages);
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
				role: "assistant",
			},
		]);
	}, []);

	const flushAssistantFrame = useCallback(() => {
		answerBufferRef.current.flush(revealAssistantText);
	}, [revealAssistantText]);

	const scheduleAssistantFrame = useCallback(
		(messageId: string, occurredAt: string) => {
			answerBufferRef.current.schedule(messageId, occurredAt, revealAssistantText);
		},
		[revealAssistantText],
	);

	const appendAssistantDelta = useCallback(
		(messageId: string, delta: string, occurredAt: string) => {
			answerBufferRef.current.append(messageId, delta, occurredAt);
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

	useEffect(
		() => () => {
			answerBufferRef.current.clear();
		},
		[],
	);

	return {
		appendAssistantDelta,
		appendLocalErrorMessage,
		appendLocalUserMessage,
		cancelAssistantFrame,
		clearMessages,
		clearProvisionalAssistantMessages,
		flushAssistantFrame,
		messages,
		removeMessage,
		replaceWithCanonicalMessages,
		revealAccumulatedAssistantText,
		scheduleAssistantFrame,
		truncateMessagesFrom,
	};
}
