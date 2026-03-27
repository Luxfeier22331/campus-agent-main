import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { buildChatBootstrapSql, qualifyTable } from "./db.server";
import type { Conversation, ChatMessage, RawAnswerResult } from "./chat-types";

const toConversation = (
  row: Record<string, unknown>,
  messages: ChatMessage[],
): Conversation => ({
  id: String(row.id),
  ownerUserId: String(row.owner_user_id),
  title: String(row.title),
  createdAt: new Date(String(row.created_at)).toISOString(),
  updatedAt: new Date(String(row.updated_at)).toISOString(),
  messages,
});

const toMessage = (row: Record<string, unknown>): ChatMessage => ({
  id: String(row.id),
  conversationId: String(row.conversation_id),
  role: row.role === "assistant" ? "assistant" : "user",
  text: String(row.text),
  createdAt: new Date(String(row.created_at)).toISOString(),
  requestId: row.request_id ? String(row.request_id) : undefined,
  kind: row.kind ? (String(row.kind) as ChatMessage["kind"]) : undefined,
  retryable: typeof row.retryable === "boolean" ? row.retryable : undefined,
});

export class PgConversationRepository {
  constructor(
    private readonly pool: Pool,
    private readonly chatSchema: string,
  ) {}

  get conversationsTable(): string {
    return qualifyTable(this.chatSchema, "conversations");
  }

  get messagesTable(): string {
    return qualifyTable(this.chatSchema, "messages");
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(buildChatBootstrapSql(this.chatSchema));
  }

  async listByOwner(ownerUserId: string): Promise<Conversation[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `
        SELECT id, owner_user_id, title, created_at, updated_at
        FROM ${this.conversationsTable}
        WHERE owner_user_id = $1
        ORDER BY updated_at DESC
      `,
      [ownerUserId],
    );

    return result.rows.map((row) => toConversation(row, []));
  }

  async getByOwner(ownerUserId: string, conversationId: string): Promise<Conversation | null> {
    const conversationResult = await this.pool.query<Record<string, unknown>>(
      `
        SELECT id, owner_user_id, title, created_at, updated_at
        FROM ${this.conversationsTable}
        WHERE id = $1 AND owner_user_id = $2
      `,
      [conversationId, ownerUserId],
    );

    const row = conversationResult.rows[0];
    if (!row) {
      return null;
    }

    const messageResult = await this.pool.query<Record<string, unknown>>(
      `
        SELECT id, conversation_id, role, kind, text, created_at, request_id
             , retryable
        FROM ${this.messagesTable}
        WHERE conversation_id = $1
        ORDER BY created_at ASC
      `,
      [conversationId],
    );

    return toConversation(row, messageResult.rows.map((message) => toMessage(message)));
  }

  async create(ownerUserId: string): Promise<Conversation> {
    const now = new Date().toISOString();
    const id = `conv-${randomUUID()}`;

    await this.pool.query(
      `
        INSERT INTO ${this.conversationsTable} (id, owner_user_id, title, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [id, ownerUserId, "New conversation", now, now],
    );

    return {
      id,
      ownerUserId,
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }

  async deleteByOwner(ownerUserId: string, conversationId: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        DELETE FROM ${this.conversationsTable}
        WHERE id = $1 AND owner_user_id = $2
      `,
      [conversationId, ownerUserId],
    );

    return Number(result.rowCount ?? 0) > 0;
  }

  async deleteAllByOwner(ownerUserId: string): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM ${this.conversationsTable}
        WHERE owner_user_id = $1
      `,
      [ownerUserId],
    );
  }

  async appendTurn(
    ownerUserId: string,
    conversationId: string,
    prompt: string,
    result: RawAnswerResult,
  ): Promise<Conversation | null> {
    const conversation = await this.getByOwner(ownerUserId, conversationId);
    if (!conversation) {
      return null;
    }

    const userMessageId = `msg-${randomUUID()}`;
    const assistantMessageId = `msg-${randomUUID()}`;
    const userMessageTime = new Date().toISOString();
    const assistantMessageTime = new Date().toISOString();

    await this.pool.query(
      `
        INSERT INTO ${this.messagesTable} (
          id,
          conversation_id,
          role,
          kind,
          text,
          created_at,
          request_id,
          retryable
        )
        VALUES
          ($1, $2, 'user', NULL, $3, $4, NULL, NULL),
          ($5, $2, 'assistant', $6, $7, $8, $9, $10)
      `,
      [
        userMessageId,
        conversationId,
        prompt,
        userMessageTime,
        assistantMessageId,
        result.kind,
        result.kind === "error" ? result.message : result.text,
        assistantMessageTime,
        result.request_id ?? null,
        result.kind === "error" ? result.retryable ?? true : null,
      ],
    );

    const nextTitle =
      conversation.messages.length === 0 ? prompt.slice(0, 80).trim() || "New conversation" : conversation.title;

    await this.pool.query(
      `
        UPDATE ${this.conversationsTable}
        SET title = $1, updated_at = $2
        WHERE id = $3 AND owner_user_id = $4
      `,
      [nextTitle, assistantMessageTime, conversationId, ownerUserId],
    );

    return this.getByOwner(ownerUserId, conversationId);
  }
}
