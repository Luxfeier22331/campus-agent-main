import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Env } from "../../config";
import { createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
  crawlRuns,
  officialWebRunProjection,
  officialWebSiteProjection,
  runArtifacts,
  runOutbox,
} from "../../db/schema";
import type {
  OfficialWebIngestionDispatchStatus,
  OfficialWebIngestionExecutionStatus,
  OfficialWebRunIntent,
  OfficialWebRunStatus,
} from "../official-web-command";
import type {
  OfficialWebArtifactSummary,
  OfficialWebProjectionProjectorStore,
  OfficialWebRunOutboxEvent,
  OfficialWebRunProjectionMaterialization,
  OfficialWebRunProjectionSource,
  OfficialWebSiteProjectionMaterialization,
  OfficialWebSiteProjectionSource,
} from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function deriveDisplayName(siteId: string): string {
  return siteId
    .split("_")
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

function extractFailureCount(summary: Record<string, unknown> | null): number {
  const failureCount = summary?.failureCount;
  if (typeof failureCount === "number" && Number.isFinite(failureCount)) {
    return failureCount;
  }

  const failures = summary?.failures;
  return typeof failures === "number" && Number.isFinite(failures) ? failures : 0;
}

function toRunOutboxEvent(row: typeof runOutbox.$inferSelect): OfficialWebRunOutboxEvent {
  return {
    attemptCount: row.attemptCount,
    availableAt: row.availableAt.toISOString(),
    eventId: row.eventId,
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    payload: row.payloadJson,
    processedAt: toIsoString(row.processedAt),
    runId: row.runId,
  };
}

function toArtifactSummary(
  row: typeof runArtifacts.$inferSelect,
): OfficialWebArtifactSummary {
  return {
    artifactType: row.artifactType,
    byteSize: row.byteSize ?? null,
    contentSha256: row.contentSha256,
    objectKey: row.objectKey,
    recordCount: row.recordCount ?? null,
  };
}

function toRunProjectionSource(
  row: typeof crawlRuns.$inferSelect,
  artifactRows: Array<typeof runArtifacts.$inferSelect>,
): OfficialWebRunProjectionSource {
  return {
    artifacts: artifactRows.map(toArtifactSummary),
    collectorVersion: row.collectorVersion,
    configVersion: row.configVersion,
    crawlPolicyVersion: row.crawlPolicyVersion,
    failureCount: extractFailureCount(row.summaryJson ?? null),
    finishedAt: toIsoString(row.finishedAt),
    hostSet: row.hostSetJson,
    ingestionDispatchRef: row.ingestionDispatchRef ?? null,
    ingestionDispatchStatus: row.ingestionDispatchStatus as OfficialWebIngestionDispatchStatus,
    ingestionExecutionErrorCode: row.ingestionExecutionErrorCode ?? null,
    ingestionExecutionErrorMessage: row.ingestionExecutionErrorMessage ?? null,
    ingestionExecutionRef: row.ingestionExecutionRef ?? null,
    ingestionExecutionStatus: row.ingestionExecutionStatus as OfficialWebIngestionExecutionStatus,
    ingestionExecutionUpdatedAt: toIsoString(row.ingestionExecutionUpdatedAt),
    lastHeartbeatAt: toIsoString(row.lastHeartbeatAt),
    runId: row.runId,
    runIntent: row.runIntent as OfficialWebRunIntent,
    schedulerRunKey: row.schedulerRunKey,
    seedSet: row.seedSetJson,
    siteId: row.siteId,
    startedAt: row.startedAt.toISOString(),
    status: row.status as OfficialWebRunStatus,
    summary: row.summaryJson ?? null,
    triggerType: row.triggerType,
  };
}

export function createPgOfficialWebProjectionStore(
  env: Env,
  input: {
    getDb?: RuntimeDbGetter;
  } = {},
): OfficialWebProjectionProjectorStore {
  const getDb = input.getDb ?? createRuntimeDbGetter(env);

  return {
    async getRunProjectionSource(runId) {
      const db = await getDb();
      const runRows = await db.select().from(crawlRuns).where(eq(crawlRuns.runId, runId)).limit(1);
      const runRow = runRows[0];
      if (!runRow) {
        return null;
      }

      const artifactRows = await db
        .select()
        .from(runArtifacts)
        .where(eq(runArtifacts.runId, runId))
        .orderBy(asc(runArtifacts.artifactType), asc(runArtifacts.objectKey));

      return toRunProjectionSource(runRow, artifactRows);
    },

    async getSiteProjectionSource(siteId) {
      const db = await getDb();
      const latestRows = await db
        .select()
        .from(crawlRuns)
        .where(eq(crawlRuns.siteId, siteId))
        .orderBy(desc(crawlRuns.startedAt), desc(crawlRuns.runId))
        .limit(1);
      const latest = latestRows[0];
      if (!latest) {
        return null;
      }

      const [lastSuccess] = await db
        .select()
        .from(crawlRuns)
        .where(
          and(
            eq(crawlRuns.siteId, siteId),
            inArray(crawlRuns.status, ["completed", "completed_with_errors"]),
          ),
        )
        .orderBy(desc(crawlRuns.finishedAt), desc(crawlRuns.runId))
        .limit(1);
      const [lastFailure] = await db
        .select()
        .from(crawlRuns)
        .where(
          and(
            eq(crawlRuns.siteId, siteId),
            inArray(crawlRuns.status, ["failed", "abandoned"]),
          ),
        )
        .orderBy(desc(crawlRuns.finishedAt), desc(crawlRuns.runId))
        .limit(1);

      return {
        displayName: deriveDisplayName(latest.siteId),
        hostRoots: latest.hostSetJson,
        lastFailureAt: toIsoString(lastFailure?.finishedAt ?? null),
        lastSuccessAt: toIsoString(lastSuccess?.finishedAt ?? null),
        latestCollectorVersion: latest.collectorVersion,
        latestConfigVersion: latest.configVersion,
        latestIngestionDispatchStatus:
          latest.ingestionDispatchStatus as OfficialWebIngestionDispatchStatus,
        latestIngestionExecutionErrorCode: latest.ingestionExecutionErrorCode ?? null,
        latestIngestionExecutionStatus:
          latest.ingestionExecutionStatus as OfficialWebIngestionExecutionStatus,
        latestIngestionExecutionUpdatedAt: toIsoString(latest.ingestionExecutionUpdatedAt),
        latestRunId: latest.runId,
        latestRunStatus: latest.status as OfficialWebRunStatus,
        siteId: latest.siteId,
      } satisfies OfficialWebSiteProjectionSource;
    },

    async listPendingEvents(limit, now) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(runOutbox)
        .where(and(isNull(runOutbox.processedAt), lte(runOutbox.availableAt, now)))
        .orderBy(asc(runOutbox.availableAt), asc(runOutbox.occurredAt))
        .limit(limit);

      return rows.map(toRunOutboxEvent);
    },

    async markEventFailed(input) {
      const db = await getDb();
      await db
        .update(runOutbox)
        .set({
          attemptCount: input.attemptCount,
          availableAt: new Date(input.availableAt),
          lastError: input.lastError,
          processedAt: input.processedAt ? new Date(input.processedAt) : null,
        })
        .where(eq(runOutbox.eventId, input.eventId));
    },

    async markEventProcessed(input) {
      const db = await getDb();
      await db
        .update(runOutbox)
        .set({
          attemptCount: 1,
          lastError: null,
          processedAt: new Date(input.processedAt),
        })
        .where(eq(runOutbox.eventId, input.eventId));
    },

    async markTimedOutRunsAsAbandoned(input) {
      const db = await getDb();
      const cutoff = new Date(new Date(input.now).valueOf() - input.heartbeatTimeoutSeconds * 1000);
      const rows = await db
        .select()
        .from(crawlRuns)
        .where(
          and(
            inArray(crawlRuns.status, ["accepted", "running"]),
            or(
              and(isNull(crawlRuns.lastHeartbeatAt), lte(crawlRuns.startedAt, cutoff)),
              lte(crawlRuns.lastHeartbeatAt, cutoff),
            )!,
          ),
        );

      for (const row of rows) {
        const eventId = `owevt_abandoned_${randomUUID().replace(/-/g, "")}`;
        await db.transaction(async (tx) => {
          await tx
            .update(crawlRuns)
            .set({
              finishedAt: new Date(input.now),
              status: "abandoned",
              terminalErrorCode: "heartbeat_timeout",
              terminalErrorMessage: "Run exceeded heartbeat timeout.",
              updatedAt: new Date(input.now),
            })
            .where(eq(crawlRuns.runId, row.runId));

          await tx.insert(runOutbox).values({
            attemptCount: 0,
            availableAt: new Date(input.now),
            eventId,
            eventType: "official_web.run.abandoned",
            lastError: null,
            occurredAt: new Date(input.now),
            payloadJson: {
              finishedAt: input.now,
              runId: row.runId,
              siteId: row.siteId,
              status: "abandoned",
              summary: row.summaryJson ?? null,
            },
            processedAt: null,
            runId: row.runId,
          });
        });
      }

      return rows.length;
    },

    async updateRunDispatchStatus(input) {
      const db = await getDb();
      await db
        .update(crawlRuns)
        .set({
          ingestionDispatchRef: input.dispatchRef,
          ingestionDispatchStatus: input.status,
          ingestionDispatchedAt: new Date(input.dispatchedAt),
          updatedAt: new Date(input.dispatchedAt),
        })
        .where(eq(crawlRuns.runId, input.runId));
    },

    async updateRunExecutionStatus(input) {
      const db = await getDb();
      const rows = await db
        .update(crawlRuns)
        .set({
          ingestionExecutionErrorCode: input.errorCode,
          ingestionExecutionErrorMessage: input.errorMessage,
          ingestionExecutionRef: input.executionRef,
          ingestionExecutionStatus: input.status,
          ingestionExecutionUpdatedAt: new Date(input.updatedAt),
          updatedAt: new Date(input.updatedAt),
        })
        .where(eq(crawlRuns.runId, input.runId))
        .returning({ runId: crawlRuns.runId });

      return rows.length > 0;
    },

    async upsertRunProjection(projection) {
      const db = await getDb();
      await db
        .insert(officialWebRunProjection)
        .values({
          artifactsJson: projection.artifacts,
          collectorVersion: projection.collectorVersion,
          configVersion: projection.configVersion,
          failureCount: projection.failureCount,
          finishedAt: projection.finishedAt ? new Date(projection.finishedAt) : null,
          ingestionDispatchRef: projection.ingestionDispatchRef,
          ingestionDispatchStatus: projection.ingestionDispatchStatus,
          ingestionExecutionErrorCode: projection.ingestionExecutionErrorCode,
          ingestionExecutionErrorMessage: projection.ingestionExecutionErrorMessage,
          ingestionExecutionRef: projection.ingestionExecutionRef,
          ingestionExecutionStatus: projection.ingestionExecutionStatus,
          ingestionExecutionUpdatedAt: projection.ingestionExecutionUpdatedAt
            ? new Date(projection.ingestionExecutionUpdatedAt)
            : null,
          lastHeartbeatAt: projection.lastHeartbeatAt ? new Date(projection.lastHeartbeatAt) : null,
          projectedAt: new Date(projection.projectedAt),
          runId: projection.runId,
          runIntent: projection.runIntent,
          siteId: projection.siteId,
          startedAt: new Date(projection.startedAt),
          status: projection.status,
          summaryJson: projection.summary,
        })
        .onConflictDoUpdate({
          set: {
            artifactsJson: projection.artifacts,
            collectorVersion: projection.collectorVersion,
            configVersion: projection.configVersion,
            failureCount: projection.failureCount,
            finishedAt: projection.finishedAt ? new Date(projection.finishedAt) : null,
            ingestionDispatchRef: projection.ingestionDispatchRef,
            ingestionDispatchStatus: projection.ingestionDispatchStatus,
            ingestionExecutionErrorCode: projection.ingestionExecutionErrorCode,
            ingestionExecutionErrorMessage: projection.ingestionExecutionErrorMessage,
            ingestionExecutionRef: projection.ingestionExecutionRef,
            ingestionExecutionStatus: projection.ingestionExecutionStatus,
            ingestionExecutionUpdatedAt: projection.ingestionExecutionUpdatedAt
              ? new Date(projection.ingestionExecutionUpdatedAt)
              : null,
            lastHeartbeatAt: projection.lastHeartbeatAt ? new Date(projection.lastHeartbeatAt) : null,
            projectedAt: new Date(projection.projectedAt),
            runIntent: projection.runIntent,
            siteId: projection.siteId,
            startedAt: new Date(projection.startedAt),
            status: projection.status,
            summaryJson: projection.summary,
          },
          target: officialWebRunProjection.runId,
        });
    },

    async upsertSiteProjection(projection) {
      const db = await getDb();
      await db
        .insert(officialWebSiteProjection)
        .values({
          displayName: projection.displayName,
          hostRootsJson: projection.hostRoots,
          lastFailureAt: projection.lastFailureAt ? new Date(projection.lastFailureAt) : null,
          lastSuccessAt: projection.lastSuccessAt ? new Date(projection.lastSuccessAt) : null,
          latestCollectorVersion: projection.latestCollectorVersion,
          latestConfigVersion: projection.latestConfigVersion,
          latestIngestionDispatchStatus: projection.latestIngestionDispatchStatus,
          latestIngestionExecutionErrorCode: projection.latestIngestionExecutionErrorCode,
          latestIngestionExecutionStatus: projection.latestIngestionExecutionStatus,
          latestIngestionExecutionUpdatedAt: projection.latestIngestionExecutionUpdatedAt
            ? new Date(projection.latestIngestionExecutionUpdatedAt)
            : null,
          latestRunId: projection.latestRunId,
          latestRunStatus: projection.latestRunStatus,
          projectedAt: new Date(projection.projectedAt),
          siteId: projection.siteId,
        })
        .onConflictDoUpdate({
          set: {
            displayName: projection.displayName,
            hostRootsJson: projection.hostRoots,
            lastFailureAt: projection.lastFailureAt ? new Date(projection.lastFailureAt) : null,
            lastSuccessAt: projection.lastSuccessAt ? new Date(projection.lastSuccessAt) : null,
            latestCollectorVersion: projection.latestCollectorVersion,
            latestConfigVersion: projection.latestConfigVersion,
            latestIngestionDispatchStatus: projection.latestIngestionDispatchStatus,
            latestIngestionExecutionErrorCode: projection.latestIngestionExecutionErrorCode,
            latestIngestionExecutionStatus: projection.latestIngestionExecutionStatus,
            latestIngestionExecutionUpdatedAt: projection.latestIngestionExecutionUpdatedAt
              ? new Date(projection.latestIngestionExecutionUpdatedAt)
              : null,
            latestRunId: projection.latestRunId,
            latestRunStatus: projection.latestRunStatus,
            projectedAt: new Date(projection.projectedAt),
          },
          target: officialWebSiteProjection.siteId,
        });
    },
  };
}
