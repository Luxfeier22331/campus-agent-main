import { deleteTrailingMessages as deleteTrailingMessagesRequest } from "./api";

export async function deleteTrailingMessages(input: { conversationId: string; messageId: string }) {
	await deleteTrailingMessagesRequest(input.conversationId, input.messageId);
}
