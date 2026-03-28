import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDatabase } from "../../db/runtime";
import { projectionOutbox, requestExecution, requestProjection } from "../../db/schema";
import type {
  ProjectionOutboxEvent,
  RequestExecutionProjectionSource,
  RequestProjectionMaterialization,
  RequestProjectionProjectorStore,
} from "./service";

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toProjectionEvent(row: typeof projectionOutbox.$inferSelect): ProjectionOutboxEvent {
  return {
    attemptCount: row.attemptCount,
    availableAt: row.availableAt.toISOString(),
    eventId: row.eventId,
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    processedAt: toIsoString(row.processedAt),
    requestId: row.requestId,
  };
}

function toExecutionProjectionSource(
  row: typeof requestExecution.$inferSelect,
): RequestExecutionProjectionSource {
  return {
    actorSnapshot: row.actorSnapshotJson,
    actorUserId: row.actorUserId,
    answerPreview: row.answerPreview ?? null,
    completedAt: toIsoString(row.completedAt),
    conversationId: row.conversationId,
    durationMs: row.durationMs ?? null,
    errorCode: row.errorCode ?? null,
    questionPreview: row.questionPreview,
    requestId: row.requestId,
    requestedCapability: row.requestedCapability ?? null,
    requestedScope: row.requestedScopeJson ?? null,
    selectedTarget: row.selectedTarget ?? null,
    sourceDocIds: row.sourceDocIdsJson ?? [],
    startedAt: row.startedAt.toISOString(),
    status: row.status as RequestExecutionProjectionSource["status"],
    surface: row.surface,
    traceId: row.traceId,
  };
}

export function createPgProjectionStore(env: Env): RequestProjectionProjectorStore {
  return {
    async getRequestExecution(requestIdValue) {
      const db = await createRuntimeDatabase(env);
      const rows = await db
        .select()
        .from(requestExecution)
        .where(eq(requestExecution.requestId, requestIdValue))
        .limit(1);

      return rows[0] ? toExecutionProjectionSource(rows[0]) : null;
    },

    async listPendingEvents(limit, now) {
      const db = await createRuntimeDatabase(env);
      const rows = await db
        .select()
        .from(projectionOutbox)
        .where(and(isNull(projectionOutbox.processedAt), lte(projectionOutbox.availableAt, now)))
        .orderBy(asc(projectionOutbox.availableAt), asc(projectionOutbox.occurredAt))
        .limit(limit);

      return rows.map(toProjectionEvent);
    },

    async markEventFailed(input) {
      const db = await createRuntimeDatabase(env);
      await db
        .update(projectionOutbox)
        .set({
          attemptCount: input.attemptCount,
          lastError: input.lastError,
        })
        .where(eq(projectionOutbox.eventId, input.eventId));
    },

    async markEventProcessed(input) {
      const db = await createRuntimeDatabase(env);
      await db
        .update(projectionOutbox)
        .set({
          attemptCount: sql`${projectionOutbox.attemptCount} + 1`,
          lastError: null,
          processedAt: new Date(input.processedAt),
        })
        .where(eq(projectionOutbox.eventId, input.eventId));
    },

    async upsertProjection(projection) {
      const db = await createRuntimeDatabase(env);
      await db
        .insert(requestProjection)
        .values({
          answerPreview: projection.answerPreview,
          completedAt: projection.completedAt ? new Date(projection.completedAt) : null,
          conversationId: projection.conversationId,
          durationMs: projection.durationMs,
          errorCode: projection.errorCode,
          principalId: projection.principalId,
          principalLabel: projection.principalLabel,
          principalType: projection.principalType,
          projectedAt: new Date(projection.projectedAt),
          questionPreview: projection.questionPreview,
          requestId: projection.requestId,
          requestedCapability: projection.requestedCapability,
          requestedScopeJson: projection.requestedScope,
          selectedTarget: projection.selectedTarget,
          sourceDocIdsJson: projection.sourceDocIds,
          startedAt: new Date(projection.startedAt),
          status: projection.status,
          surface: projection.surface,
          traceId: projection.traceId,
        })
        .onConflictDoUpdate({
          set: {
            answerPreview: projection.answerPreview,
            completedAt: projection.completedAt ? new Date(projection.completedAt) : null,
            conversationId: projection.conversationId,
            durationMs: projection.durationMs,
            errorCode: projection.errorCode,
            principalId: projection.principalId,
            principalLabel: projection.principalLabel,
            principalType: projection.principalType,
            projectedAt: new Date(projection.projectedAt),
            questionPreview: projection.questionPreview,
            requestedCapability: projection.requestedCapability,
            requestedScopeJson: projection.requestedScope,
            selectedTarget: projection.selectedTarget,
            sourceDocIdsJson: projection.sourceDocIds,
            startedAt: new Date(projection.startedAt),
            status: projection.status,
            surface: projection.surface,
            traceId: projection.traceId,
          },
          target: requestProjection.requestId,
        });
    },
  };
}
