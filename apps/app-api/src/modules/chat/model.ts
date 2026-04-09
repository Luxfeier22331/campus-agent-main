export type AssistantMessageKind = "answer" | "clarification" | "no_answer" | "error";
export type ChatMessageRole = "user" | "assistant";
export const DRAFT_CONVERSATION_TITLE = "New conversation";

export interface ChatSessionSlot {
  confirmed: boolean;
  name: string;
  updatedAt: string;
  value: string;
}

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
  sessionSlots: ChatSessionSlot[];
  messages: ChatMessage[];
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatConversationResponse {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ChatConversationSummaryResponse {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface VendorChatHistoryItemResponse {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  visibility: "private" | "public";
}

export interface VendorChatHistoryPageResponse {
  chats: VendorChatHistoryItemResponse[];
  hasMore: boolean;
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

export function toConversationSummaryResponse(
  conversation: ChatConversationSummary,
): ChatConversationSummaryResponse {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export function toVendorChatHistoryItemResponse(
  conversation: ChatConversationSummary,
): VendorChatHistoryItemResponse {
  return {
    ...toConversationSummaryResponse(conversation),
    visibility: "private",
  };
}
