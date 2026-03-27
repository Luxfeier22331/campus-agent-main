import type { ChatMessage, Conversation } from "./chat-types";

export type ConversationGroup = {
  label: "Today" | "Yesterday" | "Previous 7 days" | "Previous 30 days" | "Older";
  conversations: Conversation[];
};

export function upsertConversationHistory(
  conversations: Conversation[],
  nextConversation: Conversation,
): Conversation[] {
  return [
    nextConversation,
    ...conversations.filter((conversation) => conversation.id !== nextConversation.id),
  ];
}

export function formatChatMessageRole(message: ChatMessage): string {
  if (message.role !== "assistant" || !message.kind) {
    return message.role;
  }

  return `assistant · ${message.kind}`;
}

function startOfDay(input: Date): number {
  return Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate());
}

function getRecencyLabel(updatedAt: string, now: Date): ConversationGroup["label"] {
  const dayDistance = Math.floor(
    (startOfDay(now) - startOfDay(new Date(updatedAt))) / 86_400_000,
  );

  if (dayDistance <= 0) {
    return "Today";
  }

  if (dayDistance === 1) {
    return "Yesterday";
  }

  if (dayDistance <= 7) {
    return "Previous 7 days";
  }

  if (dayDistance <= 30) {
    return "Previous 30 days";
  }

  return "Older";
}

const GROUP_ORDER: ConversationGroup["label"][] = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Previous 30 days",
  "Older",
];

export function groupConversationsByRecency(
  conversations: Conversation[],
  now = new Date(),
): ConversationGroup[] {
  const groups = new Map<ConversationGroup["label"], Conversation[]>();

  for (const conversation of conversations) {
    const label = getRecencyLabel(conversation.updatedAt, now);
    const existing = groups.get(label) ?? [];
    existing.push(conversation);
    groups.set(label, existing);
  }

  return GROUP_ORDER.flatMap((label) => {
    const groupedConversations = groups.get(label);
    if (!groupedConversations || groupedConversations.length === 0) {
      return [];
    }

    return [
      {
        label,
        conversations: groupedConversations,
      },
    ];
  });
}

export function getConversationPreview(conversation: Conversation): string {
  const latestMessage = conversation.messages.at(-1)?.text?.trim();
  if (latestMessage) {
    return latestMessage;
  }

  return conversation.title.trim() || "New conversation";
}

export function getRetryPromptForMessage(
  messages: ChatMessage[],
  messageId: string,
): string | null {
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex < 1) {
    return null;
  }

  const message = messages[messageIndex];
  const previousMessage = messages[messageIndex - 1];

  if (
    !message ||
    message.role !== "assistant" ||
    message.kind !== "error" ||
    !message.retryable ||
    !previousMessage ||
    previousMessage.role !== "user"
  ) {
    return null;
  }

  return previousMessage.text;
}
