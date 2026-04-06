import { and, asc, desc, eq } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
  conversations,
  messages,
  projectionOutbox,
  requestExecution,
  requestObservabilityFact,
  sessionSlots,
} from "../../db/schema";
import type { ChatConversation, ChatMessage, ChatSessionSlot } from "../chat";
import type { RequestedScope } from "../integration";
import type { RequestDiagnosticsSummary } from "../request-diagnostics";
import type { ChatCommandResponse } from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export type RequestExecutionStatus =
  | "accepted"
  | "completed"
  | "needs_clarification"
  | "no_answer"
  | "error"
  | "approval_required"
  | "rejected";

export interface RequestExecutionWrite {
  requestId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string | null;
  surface: string;
  actorUserId: string;
  actorPrincipalId: string;
  actorRoles: string[];
  actorDepartments: string[];
  principalType: string;
  principalLabel: string | null;
  entitlementSnapshotId: string | null;
  entitlementGroups: string[];
  visibilityScope: string | null;
  applicabilityScope: string | null;
  idempotencyKey: string | null;
  requestFingerprintSha256: string | null;
  traceId: string;
  requestedCapability: string | null;
  requestedScope: RequestedScope | null;
  resolvedScope: RequestedScope | null;
  selectedTarget: string | null;
  status: RequestExecutionStatus;
  errorCode: string | null;
  questionPreview: string;
  answerPreview: string | null;
  diagnostics: RequestDiagnosticsSummary | null;
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

export interface RequestObservabilityFactWrite {
  requestId: string;
  traceId: string;
  conversationId: string;
  surface: string;
  principalType: string;
  entitlementSnapshotId: string | null;
  policyProjectionVersion: string | null;
  policyReason: string | null;
  requestedCapability: string | null;
  requestedScopeSummary: string | null;
  resolvedScopeSummary: string | null;
  collection: string | null;
  selectedTarget: string | null;
  status: RequestExecutionStatus;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  retrievalAttempted: boolean | null;
  candidateCount: number | null;
  retrievedSourceCount: number | null;
  emptyRecall: boolean | null;
  citationExpected: boolean | null;
  citationCount: number | null;
  citationMissing: boolean | null;
  refusalClass: string | null;
  semanticOutcome: string | null;
  scopeClass: string | null;
  aclDecision: string | null;
  aclAnomalyCode: string | null;
  failClosed: boolean | null;
  modelProvider: string | null;
  modelName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  estimatedCostMicrousd: number | null;
  traceAvailable: boolean;
  projectionLagMs: number | null;
  measuredAt: string;
  updatedAt: string;
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
  requestObservabilityFact: RequestObservabilityFactWrite;
  requestExecution: RequestExecutionWrite;
  userMessage: ChatMessage;
}

export interface FinalizeRequestWrite {
  assistantMessage: ChatMessage;
  conversationTitle: string;
  ownerUserId: string;
  outboxEvent: ProjectionOutboxWrite;
  requestObservabilityFact: RequestObservabilityFactWrite;
  requestExecution: RequestExecutionWrite;
  sessionSlots: ChatSessionSlot[];
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
  sessionSlotRows: Array<typeof sessionSlots.$inferSelect>,
): ChatConversation {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    title: row.title,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    sessionSlots: sessionSlotRows.map((slot) => ({
      confirmed: slot.confirmed,
      name: slot.name,
      updatedAt: toIsoString(slot.updatedAt),
      value: slot.value,
    })),
    messages: messageRows.map(toChatMessage),
  };
}

export function createPgChatCommandStore(
  env: Env,
  input: {
    getDb?: RuntimeDbGetter;
  } = {},
): ChatCommandStore {
  const getDb = input.getDb ?? createRuntimeDbGetter(env);

  async function loadConversation(
    ownerUserId: string,
    conversationId: string,
  ): Promise<ChatConversation | null> {
    const db = await getDb();
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
    const sessionSlotRows = await db
      .select()
      .from(sessionSlots)
      .where(eq(sessionSlots.conversationId, conversationId))
      .orderBy(asc(sessionSlots.name));

    return toChatConversation(conversationRow, messageRows, sessionSlotRows);
  }

  return {
    async findIdempotentRequest(input) {
      const db = await getDb();
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
              retryable:
                assistantMessage.retryable ??
                (executionRow.status === "error" ? true : false),
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
                sessionSlots: conversation.sessionSlots,
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
      const db = await getDb();
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
            actorPrincipalId: input.requestExecution.actorPrincipalId,
            actorRolesJson: input.requestExecution.actorRoles,
            actorDepartmentsJson: input.requestExecution.actorDepartments,
            principalType: input.requestExecution.principalType,
            principalLabel: input.requestExecution.principalLabel,
            entitlementSnapshotId: input.requestExecution.entitlementSnapshotId,
            entitlementGroupsJson: input.requestExecution.entitlementGroups,
            visibilityScope: input.requestExecution.visibilityScope,
            applicabilityScope: input.requestExecution.applicabilityScope,
            idempotencyKey: input.requestExecution.idempotencyKey,
            requestFingerprintSha256: input.requestExecution.requestFingerprintSha256,
            traceId: input.requestExecution.traceId,
            requestedCapability: input.requestExecution.requestedCapability,
            requestedScopeJson:
              (input.requestExecution.requestedScope as Record<string, unknown> | null) ?? null,
            resolvedScopeJson:
              (input.requestExecution.resolvedScope as Record<string, unknown> | null) ?? null,
            selectedTarget: null,
            status: input.requestExecution.status,
            errorCode: null,
            questionPreview: input.requestExecution.questionPreview,
            answerPreview: null,
            diagnosticsJson: null,
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

        await tx.insert(requestObservabilityFact).values({
          aclAnomalyCode: input.requestObservabilityFact.aclAnomalyCode,
          aclDecision: input.requestObservabilityFact.aclDecision,
          cachedInputTokens: input.requestObservabilityFact.cachedInputTokens,
          candidateCount: input.requestObservabilityFact.candidateCount,
          citationCount: input.requestObservabilityFact.citationCount,
          citationExpected: input.requestObservabilityFact.citationExpected,
          citationMissing: input.requestObservabilityFact.citationMissing,
          collection: input.requestObservabilityFact.collection,
          completedAt: input.requestObservabilityFact.completedAt
            ? new Date(input.requestObservabilityFact.completedAt)
            : null,
          conversationId: input.requestObservabilityFact.conversationId,
          durationMs: input.requestObservabilityFact.durationMs,
          emptyRecall: input.requestObservabilityFact.emptyRecall,
          entitlementSnapshotId: input.requestObservabilityFact.entitlementSnapshotId,
          errorCode: input.requestObservabilityFact.errorCode,
          estimatedCostMicrousd: input.requestObservabilityFact.estimatedCostMicrousd,
          failClosed: input.requestObservabilityFact.failClosed,
          inputTokens: input.requestObservabilityFact.inputTokens,
          measuredAt: new Date(input.requestObservabilityFact.measuredAt),
          modelName: input.requestObservabilityFact.modelName,
          modelProvider: input.requestObservabilityFact.modelProvider,
          outputTokens: input.requestObservabilityFact.outputTokens,
          policyProjectionVersion: input.requestObservabilityFact.policyProjectionVersion,
          policyReason: input.requestObservabilityFact.policyReason,
          principalType: input.requestObservabilityFact.principalType,
          projectionLagMs: input.requestObservabilityFact.projectionLagMs,
          requestId: input.requestObservabilityFact.requestId,
          requestedCapability: input.requestObservabilityFact.requestedCapability,
          requestedScopeSummary: input.requestObservabilityFact.requestedScopeSummary,
          resolvedScopeSummary: input.requestObservabilityFact.resolvedScopeSummary,
          refusalClass: input.requestObservabilityFact.refusalClass,
          scopeClass: input.requestObservabilityFact.scopeClass,
          semanticOutcome: input.requestObservabilityFact.semanticOutcome,
          retrievedSourceCount: input.requestObservabilityFact.retrievedSourceCount,
          retrievalAttempted: input.requestObservabilityFact.retrievalAttempted,
          selectedTarget: input.requestObservabilityFact.selectedTarget,
          startedAt: new Date(input.requestObservabilityFact.startedAt),
          status: input.requestObservabilityFact.status,
          surface: input.requestObservabilityFact.surface,
          traceAvailable: input.requestObservabilityFact.traceAvailable,
          traceId: input.requestObservabilityFact.traceId,
          updatedAt: new Date(input.requestObservabilityFact.updatedAt),
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
      const db = await getDb();
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
            requestedScopeJson:
              (input.requestExecution.requestedScope as Record<string, unknown> | null) ?? null,
            resolvedScopeJson:
              (input.requestExecution.resolvedScope as Record<string, unknown> | null) ?? null,
            answerPreview: input.requestExecution.answerPreview,
            diagnosticsJson: input.requestExecution.diagnostics,
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
          .insert(requestObservabilityFact)
          .values({
            aclAnomalyCode: input.requestObservabilityFact.aclAnomalyCode,
            aclDecision: input.requestObservabilityFact.aclDecision,
            cachedInputTokens: input.requestObservabilityFact.cachedInputTokens,
            candidateCount: input.requestObservabilityFact.candidateCount,
            citationCount: input.requestObservabilityFact.citationCount,
            citationExpected: input.requestObservabilityFact.citationExpected,
            citationMissing: input.requestObservabilityFact.citationMissing,
            collection: input.requestObservabilityFact.collection,
            completedAt: input.requestObservabilityFact.completedAt
              ? new Date(input.requestObservabilityFact.completedAt)
              : null,
            conversationId: input.requestObservabilityFact.conversationId,
            durationMs: input.requestObservabilityFact.durationMs,
            emptyRecall: input.requestObservabilityFact.emptyRecall,
            entitlementSnapshotId: input.requestObservabilityFact.entitlementSnapshotId,
            errorCode: input.requestObservabilityFact.errorCode,
            estimatedCostMicrousd: input.requestObservabilityFact.estimatedCostMicrousd,
            failClosed: input.requestObservabilityFact.failClosed,
            inputTokens: input.requestObservabilityFact.inputTokens,
            measuredAt: new Date(input.requestObservabilityFact.measuredAt),
            modelName: input.requestObservabilityFact.modelName,
            modelProvider: input.requestObservabilityFact.modelProvider,
            outputTokens: input.requestObservabilityFact.outputTokens,
            policyProjectionVersion: input.requestObservabilityFact.policyProjectionVersion,
            policyReason: input.requestObservabilityFact.policyReason,
            principalType: input.requestObservabilityFact.principalType,
            projectionLagMs: input.requestObservabilityFact.projectionLagMs,
            requestId: input.requestObservabilityFact.requestId,
            requestedCapability: input.requestObservabilityFact.requestedCapability,
            requestedScopeSummary: input.requestObservabilityFact.requestedScopeSummary,
            resolvedScopeSummary: input.requestObservabilityFact.resolvedScopeSummary,
            refusalClass: input.requestObservabilityFact.refusalClass,
            scopeClass: input.requestObservabilityFact.scopeClass,
            semanticOutcome: input.requestObservabilityFact.semanticOutcome,
            retrievedSourceCount: input.requestObservabilityFact.retrievedSourceCount,
            retrievalAttempted: input.requestObservabilityFact.retrievalAttempted,
            selectedTarget: input.requestObservabilityFact.selectedTarget,
            startedAt: new Date(input.requestObservabilityFact.startedAt),
            status: input.requestObservabilityFact.status,
            surface: input.requestObservabilityFact.surface,
            traceAvailable: input.requestObservabilityFact.traceAvailable,
            traceId: input.requestObservabilityFact.traceId,
            updatedAt: new Date(input.requestObservabilityFact.updatedAt),
          })
          .onConflictDoUpdate({
            set: {
              aclAnomalyCode: input.requestObservabilityFact.aclAnomalyCode,
              aclDecision: input.requestObservabilityFact.aclDecision,
              cachedInputTokens: input.requestObservabilityFact.cachedInputTokens,
              candidateCount: input.requestObservabilityFact.candidateCount,
              citationCount: input.requestObservabilityFact.citationCount,
              citationExpected: input.requestObservabilityFact.citationExpected,
              citationMissing: input.requestObservabilityFact.citationMissing,
              collection: input.requestObservabilityFact.collection,
              completedAt: input.requestObservabilityFact.completedAt
                ? new Date(input.requestObservabilityFact.completedAt)
                : null,
              conversationId: input.requestObservabilityFact.conversationId,
              durationMs: input.requestObservabilityFact.durationMs,
              emptyRecall: input.requestObservabilityFact.emptyRecall,
              entitlementSnapshotId: input.requestObservabilityFact.entitlementSnapshotId,
              errorCode: input.requestObservabilityFact.errorCode,
              estimatedCostMicrousd: input.requestObservabilityFact.estimatedCostMicrousd,
              failClosed: input.requestObservabilityFact.failClosed,
              inputTokens: input.requestObservabilityFact.inputTokens,
              measuredAt: new Date(input.requestObservabilityFact.measuredAt),
              modelName: input.requestObservabilityFact.modelName,
              modelProvider: input.requestObservabilityFact.modelProvider,
              outputTokens: input.requestObservabilityFact.outputTokens,
              policyProjectionVersion: input.requestObservabilityFact.policyProjectionVersion,
              policyReason: input.requestObservabilityFact.policyReason,
              principalType: input.requestObservabilityFact.principalType,
              projectionLagMs: input.requestObservabilityFact.projectionLagMs,
              requestedCapability: input.requestObservabilityFact.requestedCapability,
              requestedScopeSummary: input.requestObservabilityFact.requestedScopeSummary,
              resolvedScopeSummary: input.requestObservabilityFact.resolvedScopeSummary,
              refusalClass: input.requestObservabilityFact.refusalClass,
              scopeClass: input.requestObservabilityFact.scopeClass,
              semanticOutcome: input.requestObservabilityFact.semanticOutcome,
              retrievedSourceCount: input.requestObservabilityFact.retrievedSourceCount,
              retrievalAttempted: input.requestObservabilityFact.retrievalAttempted,
              selectedTarget: input.requestObservabilityFact.selectedTarget,
              startedAt: new Date(input.requestObservabilityFact.startedAt),
              status: input.requestObservabilityFact.status,
              surface: input.requestObservabilityFact.surface,
              traceAvailable: input.requestObservabilityFact.traceAvailable,
              traceId: input.requestObservabilityFact.traceId,
              updatedAt: new Date(input.requestObservabilityFact.updatedAt),
            },
            target: requestObservabilityFact.requestId,
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

        await tx
          .delete(sessionSlots)
          .where(eq(sessionSlots.conversationId, input.requestExecution.conversationId));

        if (input.sessionSlots.length > 0) {
          await tx.insert(sessionSlots).values(
            input.sessionSlots.map((slot) => ({
              conversationId: input.requestExecution.conversationId,
              name: slot.name,
              value: slot.value,
              confirmed: slot.confirmed,
              updatedAt: new Date(slot.updatedAt),
            })),
          );
        }
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
