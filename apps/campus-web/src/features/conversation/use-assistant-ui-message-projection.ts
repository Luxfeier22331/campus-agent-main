import type { AppendMessage } from "@assistant-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatStreamRequestError } from "./api";
import { AssistantAnswerBuffer } from "./assistant-answer-buffer";
import {
	attachAssistantRunMetadata,
	localUserMessage,
	provisionalAssistantMessage,
	type RuntimeMessages,
	updateAssistantRunMetadata,
	upsertAssistantTextMessage,
} from "./assistant-ui-message-projection";
import type { CampusRunViewState } from "./run-view-state";

export function useAssistantUiMessageProjection() {
	const [messages, setMessages] = useState<RuntimeMessages>([]);
	const answerBufferRef = useRef(new AssistantAnswerBuffer());
	const provisionalAssistantMessageIdRef = useRef<string | null>(null);

	const revealAssistantText = useCallback(
		(input: { messageId: string; occurredAt: string; text: string }) => {
			setMessages((current) => {
				const provisionalMessageId = provisionalAssistantMessageIdRef.current;
				return upsertAssistantTextMessage(current, {
					...input,
					messageId: provisionalMessageId ?? input.messageId,
					optimistic: true,
				});
			});
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
		if (provisionalAssistantMessageIdRef.current) {
			provisionalIds.add(provisionalAssistantMessageIdRef.current);
			provisionalAssistantMessageIdRef.current = null;
		}
		if (provisionalIds.size > 0) {
			setMessages((current) =>
				current.filter(
					(message) =>
						message.metadata?.isOptimistic !== true ||
						!message.id ||
						!provisionalIds.has(message.id),
				),
			);
		}
	}, []);

	const replaceWithCanonicalMessages = useCallback(
		(nextMessages: RuntimeMessages, runView?: CampusRunViewState) => {
			answerBufferRef.current.markCanonical();
			provisionalAssistantMessageIdRef.current = null;
			setMessages(runView ? attachAssistantRunMetadata(nextMessages, runView) : nextMessages);
		},
		[],
	);

	const setRuntimeMessages = useCallback((nextMessages: readonly RuntimeMessages[number][]) => {
		setMessages([...nextMessages]);
	}, []);

	const appendProvisionalAssistantMessage = useCallback(
		(input: { messageId: string; occurredAt: string; runView: CampusRunViewState }) => {
			provisionalAssistantMessageIdRef.current = input.messageId;
			setMessages((current) => [...current, provisionalAssistantMessage(input)]);
		},
		[],
	);

	const updateAssistantRunView = useCallback((runView: CampusRunViewState) => {
		setMessages((current) => {
			const targetId = provisionalAssistantMessageIdRef.current ?? runView.requestId;
			if (targetId) {
				const direct = updateAssistantRunMetadata(current, { messageId: targetId, runView });
				if (direct.some((message, index) => message !== current[index])) {
					return direct;
				}
			}
			if (!runView.requestId) {
				return current;
			}
			const index = current.findIndex((message) => {
				if (message.role !== "assistant") {
					return false;
				}
				const metadata = message.metadata?.custom?.campusRequest;
				return Boolean(
					metadata &&
						typeof metadata === "object" &&
						!Array.isArray(metadata) &&
						(metadata as Record<string, unknown>).requestId === runView.requestId,
				);
			});
			if (index < 0) {
				return current;
			}
			const messageId = current[index]?.id;
			return updateAssistantRunMetadata(current, {
				...(messageId ? { messageId } : {}),
				runView,
			});
		});
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
			provisionalAssistantMessageIdRef.current = null;
		},
		[],
	);

	return {
		appendAssistantDelta,
		appendLocalErrorMessage,
		appendLocalUserMessage,
		appendProvisionalAssistantMessage,
		cancelAssistantFrame,
		clearMessages,
		clearProvisionalAssistantMessages,
		flushAssistantFrame,
		messages,
		removeMessage,
		replaceWithCanonicalMessages,
		revealAccumulatedAssistantText,
		scheduleAssistantFrame,
		setRuntimeMessages,
		truncateMessagesFrom,
		updateAssistantRunView,
	};
}
