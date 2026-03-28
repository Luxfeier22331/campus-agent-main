import { and, asc, desc, eq } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDatabase } from "../../db/runtime";
import { conversations, messages, projectionOutbox, requestExecution } from "../../db/schema";
import type { ChatConversation, ChatMessage } from "../chat";
import type { RequestedScope } from "../integration";
import type { ChatCommandResponse } from "./service";

export type RequestExecutionStatus =
  | "accepted"
  | "completed"
  | "needs_clarification"
  | "no_answer"
  | "error";

export interface RequestExecutionWrite {
  requestId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string | null;
  surface: string;
  actorUserId: string;
  actorRoles: string[];
  actorDepartments: string[];
  actorGroups: string[];
  actorCampusScope: string | null;
  actorSnapshot: Record<string, unknown>;
  idempotencyKey: string | null;
  requestFingerprintSha256: string | null;
  traceId: string;
  requestedCapability: string | null;
  requestedScope: RequestedScope | null;
  selectedTarget: string | null;
  status: RequestExecutionStatus;
  errorCode: string | null;
  questionPreview: string;
  answerPreview: string | null;
  sourceDocIds: string[];
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectionOutboxWrite {
  eventId: string;
  requestId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  availableAt: string;
  processedAt: string | null;
  attemptCount: number;
  lastError: string | null;
}

export interface AcceptRequestWrite {
  conversationSeed?: {
    id: string;
    ownerUserId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  };
  conversationTitle: string;
  ownerUserId: string;
  outboxEvent: ProjectionOutboxWrite;
  requestExecution: RequestExecutionWrite;
  userMessage: ChatMessage;
}

export interface FinalizeRequestWrite {
  assistantMessage: ChatMessage;
  conversationTitle: string;
  ownerUserId: string;
  outboxEvent: ProjectionOutboxWrite;
  requestExecution: RequestExecutionWrite;
}

export interface StoredIdempotentRequest {
  requestFingerprintSha256: string;
  response: ChatCommandResponse;
  status: RequestExecutionStatus;
}

export interface ChatCommandStore {
  findIdempotentRequest(input: {
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<StoredIdempotentRequest | null>;
  acceptRequest(input: AcceptRequestWrite): Promise<void>;
  finalizeRequest(input: FinalizeRequestWrite): Promise<ChatConversation>;
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

export function createPgChatCommandStore(env: Env): ChatCommandStore {
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
    async findIdempotentRequest(input) {
      const db = await createRuntimeDatabase(env);
      const executionRows = await db
        .select()
        .from(requestExecution)
        .where(
          and(
            eq(requestExecution.actorUserId, input.actorUserId),
            eq(requestExecution.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      const executionRow = executionRows[0];
      if (!executionRow) {
        return null;
      }

      const conversation = await loadConversation(
        input.actorUserId,
        executionRow.conversationId,
      );
      if (!conversation) {
        return null;
      }

      const assistantRows = await db
        .select()
        .from(messages)
        .where(eq(messages.requestId, executionRow.requestId))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      const assistantMessage = assistantRows[0] ? toChatMessage(assistantRows[0]) : null;
      if (!assistantMessage && executionRow.status !== "accepted") {
        return null;
      }

      const result =
        assistantMessage?.kind === "error"
          ? {
              kind: "error" as const,
              message: assistantMessage.text,
              errorCode: executionRow.errorCode ?? "internal_error",
              retryable: assistantMessage.retryable ?? true,
              requestId: executionRow.requestId,
              traceId: executionRow.traceId,
            }
          : assistantMessage?.kind === "clarification"
            ? {
                kind: "clarification" as const,
                text: assistantMessage.text,
                requestId: executionRow.requestId,
                traceId: executionRow.traceId,
              }
            : assistantMessage?.kind === "no_answer"
              ? {
                  kind: "no_answer" as const,
                  text: assistantMessage.text,
                  requestId: executionRow.requestId,
                  traceId: executionRow.traceId,
                }
              : {
                  kind: "answer" as const,
                  text: assistantMessage?.text ?? executionRow.answerPreview ?? "",
                  requestId: executionRow.requestId,
                  traceId: executionRow.traceId,
                };

      return {
        requestFingerprintSha256: executionRow.requestFingerprintSha256 ?? "",
        response: {
          answer: {
            conversation: {
              id: conversation.id,
              title: conversation.title,
              createdAt: conversation.createdAt,
              updatedAt: conversation.updatedAt,
              messages: conversation.messages,
            },
            result,
          },
          requestId: executionRow.requestId,
          traceId: executionRow.traceId,
        },
        status: executionRow.status as RequestExecutionStatus,
      };
    },

    async acceptRequest(input) {
      const db = await createRuntimeDatabase(env);
      await db.transaction(async (tx) => {
        if (input.conversationSeed) {
          await tx.insert(conversations).values({
            id: input.conversationSeed.id,
            ownerUserId: input.conversationSeed.ownerUserId,
            title: input.conversationSeed.title,
            createdAt: new Date(input.conversationSeed.createdAt),
            updatedAt: new Date(input.conversationSeed.updatedAt),
          });
        }

        await tx
          .insert(messages)
          .values({
            id: input.userMessage.id,
            conversationId: input.userMessage.conversationId,
            role: input.userMessage.role,
            kind: null,
            text: input.userMessage.text,
            createdAt: new Date(input.userMessage.createdAt),
            requestId: null,
            retryable: null,
          });

        await tx
          .insert(requestExecution)
          .values({
            requestId: input.requestExecution.requestId,
            conversationId: input.requestExecution.conversationId,
            userMessageId: input.requestExecution.userMessageId,
            assistantMessageId: null,
            surface: input.requestExecution.surface,
            actorUserId: input.requestExecution.actorUserId,
            actorRolesJson: input.requestExecution.actorRoles,
            actorDepartmentsJson: input.requestExecution.actorDepartments,
            actorGroupsJson: input.requestExecution.actorGroups,
            actorCampusScope: input.requestExecution.actorCampusScope,
            actorSnapshotJson: input.requestExecution.actorSnapshot,
            idempotencyKey: input.requestExecution.idempotencyKey,
            requestFingerprintSha256: input.requestExecution.requestFingerprintSha256,
            traceId: input.requestExecution.traceId,
            requestedCapability: input.requestExecution.requestedCapability,
            requestedScopeJson:
              (input.requestExecution.requestedScope as Record<string, unknown> | null) ?? null,
            selectedTarget: null,
            status: input.requestExecution.status,
            errorCode: null,
            questionPreview: input.requestExecution.questionPreview,
            answerPreview: null,
            sourceDocIdsJson: [],
            startedAt: new Date(input.requestExecution.startedAt),
            completedAt: null,
            durationMs: null,
            createdAt: new Date(input.requestExecution.createdAt),
            updatedAt: new Date(input.requestExecution.updatedAt),
          });

        await tx
          .insert(projectionOutbox)
          .values({
            eventId: input.outboxEvent.eventId,
            requestId: input.outboxEvent.requestId,
            eventType: input.outboxEvent.eventType,
            payloadJson: input.outboxEvent.payload as Record<string, unknown>,
            occurredAt: new Date(input.outboxEvent.occurredAt),
            availableAt: new Date(input.outboxEvent.availableAt),
            processedAt: null,
            attemptCount: input.outboxEvent.attemptCount,
            lastError: null,
          });

        await tx
          .update(conversations)
          .set({
            title: input.conversationTitle,
            updatedAt: new Date(input.userMessage.createdAt),
          })
          .where(
            and(
              eq(conversations.id, input.userMessage.conversationId),
              eq(conversations.ownerUserId, input.ownerUserId),
            ),
          );
      });
    },

    async finalizeRequest(input) {
      const db = await createRuntimeDatabase(env);
      await db.transaction(async (tx) => {
        await tx
          .insert(messages)
          .values({
            id: input.assistantMessage.id,
            conversationId: input.assistantMessage.conversationId,
            role: input.assistantMessage.role,
            kind: input.assistantMessage.kind,
            text: input.assistantMessage.text,
            createdAt: new Date(input.assistantMessage.createdAt),
            requestId: input.assistantMessage.requestId,
            retryable: input.assistantMessage.retryable,
          });

        await tx
          .update(requestExecution)
          .set({
            assistantMessageId: input.requestExecution.assistantMessageId,
            selectedTarget: input.requestExecution.selectedTarget,
            status: input.requestExecution.status,
            errorCode: input.requestExecution.errorCode,
            answerPreview: input.requestExecution.answerPreview,
            sourceDocIdsJson: input.requestExecution.sourceDocIds,
            completedAt: input.requestExecution.completedAt
              ? new Date(input.requestExecution.completedAt)
              : null,
            durationMs: input.requestExecution.durationMs,
            updatedAt: new Date(input.requestExecution.updatedAt),
          })
          .where(eq(requestExecution.requestId, input.requestExecution.requestId));

        await tx
          .insert(projectionOutbox)
          .values({
            eventId: input.outboxEvent.eventId,
            requestId: input.outboxEvent.requestId,
            eventType: input.outboxEvent.eventType,
            payloadJson: input.outboxEvent.payload as Record<string, unknown>,
            occurredAt: new Date(input.outboxEvent.occurredAt),
            availableAt: new Date(input.outboxEvent.availableAt),
            processedAt: null,
            attemptCount: input.outboxEvent.attemptCount,
            lastError: null,
          });

        await tx
          .update(conversations)
          .set({
            title: input.conversationTitle,
            updatedAt: new Date(input.assistantMessage.createdAt),
          })
          .where(
            and(
              eq(conversations.id, input.assistantMessage.conversationId),
              eq(conversations.ownerUserId, input.ownerUserId),
            ),
          );
      });

      const conversation = await loadConversation(
        input.ownerUserId,
        input.requestExecution.conversationId,
      );
      if (!conversation) {
        throw new Error("Conversation disappeared after finalize.");
      }

      return conversation;
    },
  };
}
