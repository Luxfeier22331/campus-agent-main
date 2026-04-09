import type {
  ChatAnswerPayload,
  ChatMessage,
  ConversationDetail,
  ConversationSummary,
  SessionPrincipal,
} from "./api-types";
import type {
  ShellConversationDetail,
  ShellConversationListItem,
  ShellMessage,
  ShellRequestOutcome,
  ShellSessionPrincipal,
} from "./types";

export function mapSessionPrincipal(principal: SessionPrincipal): ShellSessionPrincipal {
  return {
    canChat: principal.permissions.chat,
    displayName: principal.principal.displayName,
    email: principal.principal.email,
    principalId: principal.principal.principalId,
    principalType: principal.principal.type,
  };
}

export function mapConversationSummary(
  conversation: ConversationSummary,
): ShellConversationListItem {
  return {
    createdAt: conversation.createdAt,
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
  };
}

export function mapChatMessage(message: ChatMessage): ShellMessage {
  return {
    createdAt: message.createdAt,
    id: message.id,
    kind: message.role === "user" ? "user" : (message.kind ?? "answer"),
    requestId: message.requestId,
    retryable: Boolean(message.retryable),
    role: message.role,
    text: message.text,
  };
}

export function mapConversationDetail(
  conversation: ConversationDetail,
): ShellConversationDetail {
  return {
    ...mapConversationSummary(conversation),
    messages: conversation.messages.map(mapChatMessage),
  };
}

export function mapChatAnswerPayload(payload: ChatAnswerPayload): ShellRequestOutcome {
  return {
    conversation: mapConversationDetail(payload.conversation),
    requestId: payload.result.requestId,
    resultKind: payload.result.kind,
    traceId: payload.result.traceId,
  };
}
