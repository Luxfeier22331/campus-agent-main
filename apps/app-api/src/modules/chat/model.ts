export type AssistantMessageKind = "answer" | "clarification" | "no_answer" | "error";
export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  kind: AssistantMessageKind | null;
  text: string;
  createdAt: string;
  requestId: string | null;
  retryable: boolean | null;
}

export interface ChatConversation {
  id: string;
  ownerUserId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ChatConversationResponse {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export function toConversationResponse(conversation: ChatConversation): ChatConversationResponse {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages,
  };
}
