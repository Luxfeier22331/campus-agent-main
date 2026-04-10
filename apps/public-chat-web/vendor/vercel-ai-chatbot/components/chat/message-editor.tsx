"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { deleteTrailingMessages } from "@platform/chat/message-edits";
import type { ChatMessage } from "@/lib/types";

export async function submitEditedMessage({
  conversationId,
  message,
  text,
  setMessages,
  regenerate,
}: {
  conversationId: string;
  message: ChatMessage;
  text: string;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
}) {
  await deleteTrailingMessages({
    conversationId,
    messageId: message.id,
  });

  setMessages((messages) => {
    const index = messages.findIndex((m) => m.id === message.id);
    if (index === -1) {
      return messages;
    }

    return [
      ...messages.slice(0, index),
      { ...message, parts: [{ type: "text" as const, text }] },
    ];
  });

  regenerate();
}
