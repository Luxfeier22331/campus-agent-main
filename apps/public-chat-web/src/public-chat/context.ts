import { createContext, useContext } from "react";

import type { ConversationSummary, SessionPrincipal } from "./types";

export type SessionState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string }
  | { kind: "authenticated"; principal: SessionPrincipal };

export interface ConversationSummaryLike {
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
}

export interface PublicChatAppContextValue {
  conversations: ConversationSummary[];
  historyError: string | null;
  historyLoading: boolean;
  refreshConversations: () => Promise<void>;
  refreshSession: () => Promise<void>;
  session: SessionState;
  setSessionUnauthenticated: () => void;
  upsertConversationSummary: (conversation: ConversationSummaryLike) => void;
}

export const PublicChatAppContext = createContext<PublicChatAppContextValue | null>(null);

export function usePublicChatAppContext() {
  const context = useContext(PublicChatAppContext);
  if (!context) {
    throw new Error("Public chat app context is not available.");
  }

  return context;
}

export function toConversationSummary(conversation: ConversationSummaryLike): ConversationSummary {
  return {
    createdAt: conversation.createdAt,
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
  };
}

export function upsertConversationSummaryList(
  conversations: ConversationSummary[],
  nextConversation: ConversationSummaryLike,
): ConversationSummary[] {
  const nextSummary = toConversationSummary(nextConversation);

  return [
    nextSummary,
    ...conversations.filter((conversation) => conversation.id !== nextConversation.id),
  ];
}
