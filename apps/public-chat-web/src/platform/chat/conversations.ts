import { getConversationDetail, listConversations } from "../../public-chat/api";
import { mapConversationDetail, mapConversationSummary } from "./mappers";

export async function listShellConversations() {
  const conversations = await listConversations();
  return conversations.map(mapConversationSummary);
}

export async function getShellConversationDetail(conversationId: string) {
  const conversation = await getConversationDetail(conversationId);
  return mapConversationDetail(conversation);
}
