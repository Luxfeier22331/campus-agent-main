import type { ChatMessage } from "@/lib/types";
import type { ShellConversationDetail, ShellMessage } from "./types";

function mapStructuredPartsToUiParts(message: ShellMessage): ChatMessage["parts"] {
	const parts: ChatMessage["parts"] = [];

	if (message.text.trim().length > 0) {
		parts.push({
			text: message.text,
			type: "text",
		});
	}

	for (const part of message.structuredParts ?? []) {
		if (part.type === "place_card") {
			parts.push({
				data: part.placeCard,
				type: "data-place-card",
			});
		}

		if (part.type === "source_cards") {
			parts.push({
				data: part.sourceCards,
				type: "data-source-cards",
			});
		}
	}

	return parts;
}

export function mapShellMessageToChatMessage(message: ShellMessage): ChatMessage {
	return {
		id: message.id,
		kind: message.kind,
		metadata: {
			createdAt: message.createdAt,
		},
		parts: mapStructuredPartsToUiParts(message),
		requestId: message.requestId,
		retryable: message.retryable,
		role: message.role,
	};
}

export function mapShellConversationMessages(conversation: ShellConversationDetail | null) {
	return conversation ? conversation.messages.map(mapShellMessageToChatMessage) : [];
}
