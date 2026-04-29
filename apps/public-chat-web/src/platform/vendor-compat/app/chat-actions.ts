import {
	deleteAllConversations as deleteAllConversationsRequest,
	deleteConversation as deleteConversationRequest,
} from "@platform/chat/api";
import { deleteTrailingMessages as deleteTrailingMessagesRequest } from "@platform/chat/message-edits";
import { toast } from "sonner";

import type { VisibilityType } from "@/components/chat/visibility-selector";

type DeleteTrailingMessagesInput = { id: string } | { conversationId: string; messageId: string };

export async function deleteTrailingMessages(input: DeleteTrailingMessagesInput) {
	if ("conversationId" in input) {
		await deleteTrailingMessagesRequest({
			conversationId: input.conversationId,
			messageId: input.messageId,
		});
		return;
	}

	throw new Error("deleteTrailingMessages requires conversationId in Worker runtime.");
}

export async function deleteConversation(conversationId: string) {
	await deleteConversationRequest(conversationId);
}

export async function deleteAllConversations() {
	return deleteAllConversationsRequest();
}

export async function updateChatVisibility(_input: { chatId: string; visibility: VisibilityType }) {
	toast.info("Chat sharing is not available in campus mode yet.");
}
