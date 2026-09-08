import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";

export type RuntimeMessages = ThreadMessageLike[];

export function settleAssistantMessage(message: ThreadMessageLike): ThreadMessageLike {
	if (!message.metadata?.isOptimistic) {
		return message;
	}
	const { isOptimistic: _isOptimistic, ...metadata } = message.metadata;
	return {
		...message,
		...(Object.keys(metadata).length > 0 ? { metadata } : {}),
	};
}

export function upsertAssistantTextMessage(
	messages: RuntimeMessages,
	input: {
		messageId: string;
		occurredAt: string;
		text: string;
	},
): RuntimeMessages {
	const content = input.text ? [{ text: input.text, type: "text" as const }] : [];
	const existingIndex = messages.findIndex((message) => message.id === input.messageId);
	if (existingIndex < 0) {
		return [
			...messages,
			{
				content,
				createdAt: new Date(input.occurredAt),
				id: input.messageId,
				metadata: { isOptimistic: true },
				role: "assistant",
			},
		];
	}
	return messages.map((message, index) =>
		index === existingIndex
			? {
					...message,
					content,
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
		metadata: { isOptimistic: true },
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
