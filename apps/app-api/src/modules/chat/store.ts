import { and, asc, desc, eq } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDatabase } from "../../db/runtime";
import { conversations, messages } from "../../db/schema";
import type { ChatConversation, ChatConversationSummary, ChatMessage } from "./model";

export interface ChatConversationDraftWrite {
  conversationId: string;
  ownerUserId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatConversationStore {
  listConversationSummariesByOwner(ownerUserId: string): Promise<ChatConversationSummary[]>;
  createConversationDraft(input: ChatConversationDraftWrite): Promise<ChatConversation>;
  getConversationDetailByOwner(
    ownerUserId: string,
    conversationId: string,
  ): Promise<ChatConversation | null>;
  getConversationByOwner(ownerUserId: string, conversationId: string): Promise<ChatConversation | null>;
}

function toIsoString(value: Date): string {
  return value.toISOString();
}

function toChatMessage(row: typeof messages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as ChatMessage["role"],
    kind: (row.kind as ChatMessage["kind"]) ?? null,
    text: row.text,
    createdAt: toIsoString(row.createdAt),
    requestId: row.requestId ?? null,
    retryable: row.retryable ?? null,
  };
}

function toChatConversationSummary(row: typeof conversations.$inferSelect): ChatConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toChatConversation(
  row: typeof conversations.$inferSelect,
  messageRows: Array<typeof messages.$inferSelect>,
): ChatConversation {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    title: row.title,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    messages: messageRows.map(toChatMessage),
  };
}

export function createPgChatConversationStore(env: Env): ChatConversationStore {
  async function loadConversation(
    ownerUserId: string,
    conversationId: string,
  ): Promise<ChatConversation | null> {
    const db = await createRuntimeDatabase(env);
    const conversationRows = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.ownerUserId, ownerUserId)))
      .limit(1);
    const conversationRow = conversationRows[0];
    if (!conversationRow) {
      return null;
    }

    const messageRows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));

    return toChatConversation(conversationRow, messageRows);
  }

  return {
    async listConversationSummariesByOwner(ownerUserId) {
      const db = await createRuntimeDatabase(env);
      const rows = await db
        .select()
        .from(conversations)
        .where(eq(conversations.ownerUserId, ownerUserId))
        .orderBy(desc(conversations.updatedAt));

      return rows.map(toChatConversationSummary);
    },

    async createConversationDraft(input) {
      const db = await createRuntimeDatabase(env);
      await db.insert(conversations).values({
        id: input.conversationId,
        ownerUserId: input.ownerUserId,
        title: input.title,
        createdAt: new Date(input.createdAt),
        updatedAt: new Date(input.updatedAt),
      });

      const conversation = await loadConversation(input.ownerUserId, input.conversationId);
      if (!conversation) {
        throw new Error("Conversation disappeared after draft creation.");
      }

      return conversation;
    },

    async getConversationDetailByOwner(ownerUserId, conversationId) {
      return loadConversation(ownerUserId, conversationId);
    },

    async getConversationByOwner(ownerUserId, conversationId) {
      return loadConversation(ownerUserId, conversationId);
    },
  };
}
