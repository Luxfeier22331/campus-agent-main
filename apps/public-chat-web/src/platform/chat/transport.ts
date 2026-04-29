import { createDraftConversation, submitChatRequest, submitChatRequestStream } from "./api";
import { mapChatAnswerPayload, mapChatStreamEvent, mapConversationDetail } from "./mappers";

export async function createShellDraftConversation() {
	const conversation = await createDraftConversation();
	return mapConversationDetail(conversation);
}

export async function submitShellChatRequest(input: { conversationId?: string; prompt: string }) {
	const payload = await submitChatRequest(input);
	return mapChatAnswerPayload(payload);
}

export async function* submitShellChatRequestStream(input: {
	conversationId?: string;
	prompt: string;
	signal?: AbortSignal;
}) {
	for await (const event of submitChatRequestStream(input)) {
		yield mapChatStreamEvent(event);
	}
}
