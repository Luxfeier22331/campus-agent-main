import { createDraftConversation, submitChatRequest } from "../../public-chat/api";
import { mapChatAnswerPayload, mapConversationDetail } from "./mappers";

export async function createShellDraftConversation() {
  const conversation = await createDraftConversation();
  return mapConversationDetail(conversation);
}

export async function submitShellChatRequest(input: {
  conversationId?: string;
  prompt: string;
}) {
  const payload = await submitChatRequest(input);
  return mapChatAnswerPayload(payload);
}
