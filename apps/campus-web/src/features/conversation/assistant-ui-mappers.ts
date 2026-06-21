import type { ChatStructuredPart, ConversationDetail } from "./model";

export interface AssistantThreadMessage {
	content: AssistantThreadMessagePart[];
	id: string;
	role: "assistant" | "user";
}

export type AssistantThreadMessagePart =
	| {
			text: string;
			type: "text";
	  }
	| {
			data: ChatStructuredPart;
			type: "data";
	  };

export function toAssistantThreadMessages(
	conversation: ConversationDetail,
): AssistantThreadMessage[] {
	return conversation.messages.map((message) => ({
		content: [
			...(message.text ? [{ text: message.text, type: "text" as const }] : []),
			...(message.role === "assistant"
				? (message.structuredParts ?? []).map((part) => ({
						data: part,
						type: "data" as const,
					}))
				: []),
		],
		id: message.id,
		role: message.role,
	}));
}
