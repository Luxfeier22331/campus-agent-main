import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";
import { type CampusRunViewState, campusRunViewToMetadata } from "./run-view-state";

export type RuntimeMessages = ThreadMessageLike[];

export function upsertAssistantTextMessage(
	messages: RuntimeMessages,
	input: {
		messageId: string;
		occurredAt: string;
		provisionalMessageId?: string;
		runView?: CampusRunViewState;
		text: string;
	},
): RuntimeMessages {
	const content = input.text ? [{ text: input.text, type: "text" as const }] : [];
	const existingIndex = messages.findIndex((message) => message.id === input.messageId);
	const provisionalIndex = input.provisionalMessageId
		? messages.findIndex((message) => message.id === input.provisionalMessageId)
		: -1;
	const runMetadata = input.runView
		? { custom: { campusRun: campusRunViewToMetadata(input.runView) } }
		: undefined;
	if (existingIndex < 0) {
		if (provisionalIndex >= 0 && input.provisionalMessageId !== input.messageId) {
			return messages.map((message, index) =>
				index === provisionalIndex
					? {
							...message,
							...(runMetadata ? { metadata: runMetadata } : {}),
							content,
							createdAt: new Date(input.occurredAt),
							id: input.messageId,
						}
					: message,
			);
		}
		return [
			...messages,
			{
				content,
				createdAt: new Date(input.occurredAt),
				id: input.messageId,
				...(runMetadata ? { metadata: runMetadata } : {}),
				role: "assistant",
			},
		];
	}
	return messages.map((message, index) =>
		index === existingIndex
			? {
					...message,
					...(runMetadata ? { metadata: runMetadata } : {}),
					content,
				}
			: message,
	);
}

export function provisionalAssistantMessage(input: {
	messageId: string;
	occurredAt: string;
	runView: CampusRunViewState;
}): ThreadMessageLike {
	return {
		content: [],
		createdAt: new Date(input.occurredAt),
		id: input.messageId,
		metadata: { custom: { campusRun: campusRunViewToMetadata(input.runView) } },
		role: "assistant",
	};
}

export function updateAssistantRunMetadata(
	messages: RuntimeMessages,
	input: { messageId?: string | null; runView: CampusRunViewState },
): RuntimeMessages {
	const targetId = input.messageId ?? input.runView.runId;
	if (!targetId) {
		return messages;
	}
	return messages.map((message) => {
		if (message.id !== targetId || message.role !== "assistant") {
			return message;
		}
		return {
			...message,
			metadata: {
				...message.metadata,
				custom: {
					...message.metadata?.custom,
					campusRun: campusRunViewToMetadata(input.runView),
				},
			},
		};
	});
}

export function attachAssistantRunMetadata(
	messages: RuntimeMessages,
	runView: CampusRunViewState,
): RuntimeMessages {
	if (!runView.runId) {
		return messages;
	}
	const matchingIndex = messages.reduce((found, message, index) => {
		if (message.role !== "assistant") {
			return found;
		}
		const metadata = message.metadata?.custom?.campusRun;
		if (
			metadata &&
			typeof metadata === "object" &&
			!Array.isArray(metadata) &&
			(metadata as Record<string, unknown>).runId === runView.runId
		) {
			return index;
		}
		return found;
	}, -1);
	const targetIndex =
		matchingIndex >= 0
			? matchingIndex
			: messages.reduce(
					(found, message, index) => (message.role === "assistant" ? index : found),
					-1,
				);
	if (targetIndex < 0) {
		return messages;
	}
	return messages.map((message, index) =>
		index === targetIndex
			? {
					...message,
					metadata: {
						...message.metadata,
						custom: {
							...message.metadata?.custom,
							campusRun: campusRunViewToMetadata(runView),
						},
					},
				}
			: message,
	);
}

export function removeMessagesById(
	messages: RuntimeMessages,
	messageIds: ReadonlySet<string>,
): RuntimeMessages {
	return messageIds.size === 0
		? messages
		: messages.filter((message) => !(message.id && messageIds.has(message.id)));
}

export function localUserMessage(content: AppendMessage["content"], id: string): ThreadMessageLike {
	return {
		content: typeof content === "string" ? [{ text: content, type: "text" }] : content,
		createdAt: new Date(),
		id,
		role: "user",
	};
}

export function readMessageText(message: ThreadMessageLike | undefined): string {
	if (!message) {
		return "";
	}
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function readTextContent(message: AppendMessage): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}
