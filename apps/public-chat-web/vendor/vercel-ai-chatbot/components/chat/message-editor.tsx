"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { deleteTrailingMessages } from "@/app/(chat)/actions";
import type { ChatMessage } from "@/lib/types";

export async function submitEditedMessage({
  conversationId,
  message,
  text,
  setMessages,
  sendMessage,
}: {
  conversationId: string;
  message: ChatMessage;
  text: string;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
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

    return messages.slice(0, index);
  });

  await sendMessage({
    role: "user",
    parts: [{ type: "text", text }],
  });
}
