import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ConversationDetail } from "./model";

export function toAssistantThreadMessages(conversation: ConversationDetail): ThreadMessageLike[] {
	return conversation.messages.map((message) => ({
		createdAt: new Date(message.createdAt),
		content: [
			...(message.text ? [{ text: message.text, type: "text" as const }] : []),
			...(message.role === "assistant"
				? (message.structuredParts ?? []).map((part) => ({
						data: part,
						name: part.type,
						type: "data" as const,
					}))
				: []),
		],
		id: message.id,
		role: message.role,
	}));
}
