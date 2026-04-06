import { and, eq, inArray } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
  crawlRuns,
  pageFreshness,
  pageObservations,
  runArtifacts,
  runHeartbeats,
  runOutbox,
} from "../../db/schema";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export type OfficialWebRunStatus =
  | "accepted"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "abandoned";

export type OfficialWebTerminalRunStatus = "completed" | "completed_with_errors" | "failed";
export type OfficialWebRunIntent = "baseline" | "hot" | "repair";

export type OfficialWebIngestionDispatchStatus =
  | "pending"
  | "queued"
  | "dispatched"
  | "ingestion_failed";
export type OfficialWebIngestionExecutionStatus =
  | "pending"
  | "running"
  | "staged"
  | "promoted"
  | "succeeded"
  | "failed";

export type OfficialWebFetchDisposition =
  | "fetched"
  | "not_modified"
  | "deleted"
  | "fetch_failed";
export type OfficialWebPageChangeStatus =
  | "new"
  | "changed"
  | "deleted"
  | "not_modified"
  | "fetch_failed";

export interface OfficialWebArtifactRecord {
  artifactType: string;
  byteSize: number | null;
  contentSha256: string;
  objectKey: string;
  recordCount: number | null;
}

export interface StoredOfficialWebRun {
  collectorVersion: string;
  configVersion: string;
  crawlPolicyVersion: string;
  finishedAt: string | null;
  hostSet: string[];
  ingestionDispatchRef: string | null;
  ingestionDispatchStatus: OfficialWebIngestionDispatchStatus;
  ingestionDispatchedAt: string | null;
  ingestionExecutionErrorCode: string | null;
  ingestionExecutionErrorMessage: string | null;
  ingestionExecutionRef: string | null;
  ingestionExecutionStatus: OfficialWebIngestionExecutionStatus;
  ingestionExecutionUpdatedAt: string | null;
  lastHeartbeatAt: string | null;
  latestHeartbeatSequence: number;
  runId: string;
  runIntent: OfficialWebRunIntent;
  schedulerRunKey: string;
  seedSet: string[];
  siteId: string;
  startFingerprintSha256: string;
  startedAt: string;
  status: OfficialWebRunStatus;
  summary: Record<string, unknown> | null;
  terminalErrorCode: string | null;
  terminalErrorMessage: string | null;
  terminalPayloadSha256: string | null;
  triggerType: string;
}

export interface StoredOfficialWebPageFreshnessState {
  cadenceClass: string;
  contentType: string | null;
  discoveredFromUrl: string | null;
  discoveryMethod: string;
  etag: string | null;
  host: string;
  lastChangeReason: string;
  lastChangedAt: string | null;
  lastFetchDisposition: OfficialWebFetchDisposition;
  lastHttpStatus: number | null;
  lastModified: string | null;
  lastNotModifiedAt: string | null;
  lastSeenAt: string;
  lastSuccessfulRunId: string | null;
  mainContentHash: string | null;
  nextEligibleFetchAt: string;
  normalizedCanonicalUrl: string;
  pageFamily: string;
  pageTitleNormalized: string;
  priorityScore: number;
  responseBodyHash: string | null;
  siteId: string;
}

export interface OfficialWebPageChange {
  changeStatus: OfficialWebPageChangeStatus;
  normalizedCanonicalUrl: string;
  observedAt: string;
  pageFamily: string;
  rawAssetId: string | null;
  rawVersionId: string | null;
}

export interface PersistedOfficialWebPageObservation {
  cadenceClass: string;
  changeStatus: OfficialWebPageChangeStatus;
  contentType: string | null;
  discoveredFromUrl: string | null;
  discoveryMethod: string;
  etag: string | null;
  fetchDisposition: OfficialWebFetchDisposition;
  finalUrl: string;
  host: string;
  httpStatus: number | null;
  lastChangeReason: string;
  lastModified: string | null;
  mainContentHash: string | null;
  nextEligibleFetchAt: string;
  normalizedCanonicalUrl: string;
  observationId: string;
  observedAt: string;
  pageFamily: string;
  pageTitleNormalized: string;
  priorityScore: number;
  rawAssetId: string | null;
  rawVersionId: string | null;
  requestedUrl: string;
  responseBodyHash: string | null;
  runId: string;
  runIntent: OfficialWebRunIntent;
  siteId: string;
  freshness: {
    lastChangedAt: string | null;
    lastNotModifiedAt: string | null;
    lastSuccessfulRunId: string | null;
    mainContentHash: string | null;
    responseBodyHash: string | null;
  };
}

export interface OfficialWebRunOutboxWrite {
  attemptCount: number;
  availableAt: string;
  eventId: string;
  eventType: string;
  lastError: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
  processedAt: string | null;
  runId: string;
}

export interface AcceptOfficialWebRunWrite {
  outboxEvent: OfficialWebRunOutboxWrite;
  run: StoredOfficialWebRun;
}

export interface OfficialWebHeartbeatWrite {
  counts: Record<string, number>;
  createdAt: string;
  heartbeatId: string;
  observedAt: string;
  runId: string;
  sequence: number;
}

export interface AppendOfficialWebHeartbeatWrite {
  heartbeat: OfficialWebHeartbeatWrite;
  run: StoredOfficialWebRun;
}

export interface FinalizeOfficialWebRunWrite {
  artifacts: OfficialWebArtifactRecord[];
  observations: PersistedOfficialWebPageObservation[];
  outboxEvent: OfficialWebRunOutboxWrite;
  run: StoredOfficialWebRun;
}

export interface OfficialWebCommandStore {
  acceptRun(input: AcceptOfficialWebRunWrite): Promise<StoredOfficialWebRun>;
  appendHeartbeat(input: AppendOfficialWebHeartbeatWrite): Promise<StoredOfficialWebRun>;
  finalizeRun(input: FinalizeOfficialWebRunWrite): Promise<StoredOfficialWebRun>;
  getRunById(runId: string): Promise<StoredOfficialWebRun | null>;
  getRunBySchedulerKey(
    siteId: string,
    schedulerRunKey: string,
    runIntent: OfficialWebRunIntent,
  ): Promise<StoredOfficialWebRun | null>;
  listPageFreshnessStates(
    siteId: string,
    normalizedCanonicalUrls: string[],
  ): Promise<StoredOfficialWebPageFreshnessState[]>;
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toStoredOfficialWebRun(row: typeof crawlRuns.$inferSelect): StoredOfficialWebRun {
  return {
    collectorVersion: row.collectorVersion,
    configVersion: row.configVersion,
    crawlPolicyVersion: row.crawlPolicyVersion,
    finishedAt: toIsoString(row.finishedAt),
    hostSet: row.hostSetJson,
    ingestionDispatchRef: row.ingestionDispatchRef ?? null,
    ingestionDispatchStatus: row.ingestionDispatchStatus as OfficialWebIngestionDispatchStatus,
    ingestionDispatchedAt: toIsoString(row.ingestionDispatchedAt),
    ingestionExecutionErrorCode: row.ingestionExecutionErrorCode ?? null,
    ingestionExecutionErrorMessage: row.ingestionExecutionErrorMessage ?? null,
    ingestionExecutionRef: row.ingestionExecutionRef ?? null,
    ingestionExecutionStatus: row.ingestionExecutionStatus as OfficialWebIngestionExecutionStatus,
    ingestionExecutionUpdatedAt: toIsoString(row.ingestionExecutionUpdatedAt),
    lastHeartbeatAt: toIsoString(row.lastHeartbeatAt),
    latestHeartbeatSequence: row.latestHeartbeatSequence,
    runId: row.runId,
    runIntent: row.runIntent as OfficialWebRunIntent,
    schedulerRunKey: row.schedulerRunKey,
    seedSet: row.seedSetJson,
    siteId: row.siteId,
    startFingerprintSha256: row.startFingerprintSha256,
    startedAt: row.startedAt.toISOString(),
    status: row.status as OfficialWebRunStatus,
    summary: row.summaryJson ?? null,
    terminalErrorCode: row.terminalErrorCode ?? null,
    terminalErrorMessage: row.terminalErrorMessage ?? null,
    terminalPayloadSha256: row.terminalPayloadSha256 ?? null,
    triggerType: row.triggerType,
  };
}

function toStoredPageFreshnessState(
  row: typeof pageFreshness.$inferSelect,
): StoredOfficialWebPageFreshnessState {
  return {
    cadenceClass: row.cadenceClass,
    contentType: row.contentType ?? null,
    discoveredFromUrl: row.discoveredFromUrl ?? null,
    discoveryMethod: row.discoveryMethod,
    etag: row.etag ?? null,
    host: row.host,
    lastChangeReason: row.lastChangeReason,
    lastChangedAt: toIsoString(row.lastChangedAt),
    lastFetchDisposition: row.lastFetchDisposition as OfficialWebFetchDisposition,
    lastHttpStatus: row.lastHttpStatus ?? null,
    lastModified: row.lastModified ?? null,
    lastNotModifiedAt: toIsoString(row.lastNotModifiedAt),
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastSuccessfulRunId: row.lastSuccessfulRunId ?? null,
    mainContentHash: row.mainContentHash ?? null,
    nextEligibleFetchAt: row.nextEligibleFetchAt.toISOString(),
    normalizedCanonicalUrl: row.normalizedCanonicalUrl,
    pageFamily: row.pageFamily,
    pageTitleNormalized: row.pageTitleNormalized,
    priorityScore: row.priorityScore,
    responseBodyHash: row.responseBodyHash ?? null,
    siteId: row.siteId,
  };
}

export function createPgOfficialWebCommandStore(
  env: Env,
  input: {
    getDb?: RuntimeDbGetter;
  } = {},
): OfficialWebCommandStore {
  const getDb = input.getDb ?? createRuntimeDbGetter(env);

  return {
    async acceptRun(input) {
      const db = await getDb();
      await db.transaction(async (tx) => {
        await tx.insert(crawlRuns).values({
          collectorVersion: input.run.collectorVersion,
          configVersion: input.run.configVersion,
          crawlPolicyVersion: input.run.crawlPolicyVersion,
          createdAt: new Date(input.run.startedAt),
          finishedAt: null,
          hostSetJson: input.run.hostSet,
          ingestionDispatchRef: null,
          ingestionDispatchStatus: input.run.ingestionDispatchStatus,
          ingestionDispatchedAt: null,
          ingestionExecutionErrorCode: null,
          ingestionExecutionErrorMessage: null,
          ingestionExecutionRef: null,
          ingestionExecutionStatus: input.run.ingestionExecutionStatus,
          ingestionExecutionUpdatedAt: input.run.ingestionExecutionUpdatedAt
            ? new Date(input.run.ingestionExecutionUpdatedAt)
            : null,
          lastHeartbeatAt: null,
          latestHeartbeatSequence: input.run.latestHeartbeatSequence,
          runId: input.run.runId,
          runIntent: input.run.runIntent,
          schedulerRunKey: input.run.schedulerRunKey,
          seedSetJson: input.run.seedSet,
          siteId: input.run.siteId,
          startFingerprintSha256: input.run.startFingerprintSha256,
          startedAt: new Date(input.run.startedAt),
          status: input.run.status,
          summaryJson: input.run.summary,
          terminalErrorCode: null,
          terminalErrorMessage: null,
          terminalPayloadSha256: null,
          triggerType: input.run.triggerType,
          updatedAt: new Date(input.run.startedAt),
        });

        await tx.insert(runOutbox).values({
          attemptCount: input.outboxEvent.attemptCount,
          availableAt: new Date(input.outboxEvent.availableAt),
          eventId: input.outboxEvent.eventId,
          eventType: input.outboxEvent.eventType,
          lastError: input.outboxEvent.lastError,
          occurredAt: new Date(input.outboxEvent.occurredAt),
          payloadJson: input.outboxEvent.payload,
          processedAt: input.outboxEvent.processedAt
            ? new Date(input.outboxEvent.processedAt)
            : null,
          runId: input.outboxEvent.runId,
        });
      });

      return input.run;
    },

    async appendHeartbeat(input) {
      const db = await getDb();
      await db.transaction(async (tx) => {
        await tx.insert(runHeartbeats).values({
          countsJson: input.heartbeat.counts,
          createdAt: new Date(input.heartbeat.createdAt),
          heartbeatId: input.heartbeat.heartbeatId,
          observedAt: new Date(input.heartbeat.observedAt),
          runId: input.heartbeat.runId,
          sequence: input.heartbeat.sequence,
        });

        await tx
          .update(crawlRuns)
          .set({
            lastHeartbeatAt: new Date(input.run.lastHeartbeatAt ?? input.heartbeat.observedAt),
            latestHeartbeatSequence: input.run.latestHeartbeatSequence,
            status: input.run.status,
            summaryJson: input.run.summary,
            updatedAt: new Date(input.heartbeat.createdAt),
          })
          .where(eq(crawlRuns.runId, input.run.runId));
      });

      return input.run;
    },

    async finalizeRun(input) {
      const writeTimestamp = new Date(input.run.finishedAt ?? input.outboxEvent.occurredAt);
      const db = await getDb();

      await db.transaction(async (tx) => {
        await tx
          .update(crawlRuns)
          .set({
            finishedAt: input.run.finishedAt ? new Date(input.run.finishedAt) : null,
            ingestionDispatchRef: input.run.ingestionDispatchRef,
            ingestionDispatchStatus: input.run.ingestionDispatchStatus,
            ingestionDispatchedAt: input.run.ingestionDispatchedAt
              ? new Date(input.run.ingestionDispatchedAt)
              : null,
            ingestionExecutionErrorCode: input.run.ingestionExecutionErrorCode,
            ingestionExecutionErrorMessage: input.run.ingestionExecutionErrorMessage,
            ingestionExecutionRef: input.run.ingestionExecutionRef,
            ingestionExecutionStatus: input.run.ingestionExecutionStatus,
            ingestionExecutionUpdatedAt: input.run.ingestionExecutionUpdatedAt
              ? new Date(input.run.ingestionExecutionUpdatedAt)
              : null,
            status: input.run.status,
            summaryJson: input.run.summary,
            terminalErrorCode: input.run.terminalErrorCode,
            terminalErrorMessage: input.run.terminalErrorMessage,
            terminalPayloadSha256: input.run.terminalPayloadSha256,
            updatedAt: writeTimestamp,
          })
          .where(eq(crawlRuns.runId, input.run.runId));

        if (input.artifacts.length > 0) {
          await tx.insert(runArtifacts).values(
            input.artifacts.map((artifact, index) => ({
              artifactId: `${input.run.runId}_artifact_${index + 1}`,
              artifactType: artifact.artifactType,
              byteSize: artifact.byteSize,
              contentSha256: artifact.contentSha256,
              createdAt: writeTimestamp,
              objectKey: artifact.objectKey,
              recordCount: artifact.recordCount,
              runId: input.run.runId,
            })),
          );
        }

        if (input.observations.length > 0) {
          await tx.insert(pageObservations).values(
            input.observations.map((observation) => ({
              cadenceClass: observation.cadenceClass,
              changeStatus: observation.changeStatus,
              contentType: observation.contentType,
              createdAt: writeTimestamp,
              discoveredFromUrl: observation.discoveredFromUrl,
              discoveryMethod: observation.discoveryMethod,
              etag: observation.etag,
              fetchDisposition: observation.fetchDisposition,
              finalUrl: observation.finalUrl,
              host: observation.host,
              httpStatus: observation.httpStatus,
              lastChangeReason: observation.lastChangeReason,
              lastModified: observation.lastModified,
              mainContentHash: observation.mainContentHash,
              nextEligibleFetchAt: new Date(observation.nextEligibleFetchAt),
              normalizedCanonicalUrl: observation.normalizedCanonicalUrl,
              observationId: observation.observationId,
              observedAt: new Date(observation.observedAt),
              pageFamily: observation.pageFamily,
              pageTitleNormalized: observation.pageTitleNormalized,
              priorityScore: observation.priorityScore,
              rawAssetId: observation.rawAssetId,
              rawVersionId: observation.rawVersionId,
              requestedUrl: observation.requestedUrl,
              responseBodyHash: observation.responseBodyHash,
              runId: observation.runId,
              runIntent: observation.runIntent,
              siteId: observation.siteId,
            })),
          );

          for (const observation of input.observations) {
            await tx
              .insert(pageFreshness)
              .values({
                cadenceClass: observation.cadenceClass,
                contentType: observation.contentType,
                createdAt: writeTimestamp,
                discoveredFromUrl: observation.discoveredFromUrl,
                discoveryMethod: observation.discoveryMethod,
                etag: observation.etag,
                host: observation.host,
                lastChangeReason: observation.lastChangeReason,
                lastChangedAt: observation.freshness.lastChangedAt
                  ? new Date(observation.freshness.lastChangedAt)
                  : null,
                lastFetchDisposition: observation.fetchDisposition,
                lastHttpStatus: observation.httpStatus,
                lastModified: observation.lastModified,
                lastNotModifiedAt: observation.freshness.lastNotModifiedAt
                  ? new Date(observation.freshness.lastNotModifiedAt)
                  : null,
                lastSeenAt: new Date(observation.observedAt),
                lastSuccessfulRunId: observation.freshness.lastSuccessfulRunId,
                mainContentHash: observation.freshness.mainContentHash,
                nextEligibleFetchAt: new Date(observation.nextEligibleFetchAt),
                normalizedCanonicalUrl: observation.normalizedCanonicalUrl,
                pageFamily: observation.pageFamily,
                pageTitleNormalized: observation.pageTitleNormalized,
                priorityScore: observation.priorityScore,
                responseBodyHash: observation.freshness.responseBodyHash,
                siteId: observation.siteId,
                updatedAt: writeTimestamp,
              })
              .onConflictDoUpdate({
                target: [pageFreshness.siteId, pageFreshness.normalizedCanonicalUrl],
                set: {
                  cadenceClass: observation.cadenceClass,
                  contentType: observation.contentType,
                  discoveredFromUrl: observation.discoveredFromUrl,
                  discoveryMethod: observation.discoveryMethod,
                  etag: observation.etag,
                  host: observation.host,
                  lastChangeReason: observation.lastChangeReason,
                  lastChangedAt: observation.freshness.lastChangedAt
                    ? new Date(observation.freshness.lastChangedAt)
                    : null,
                  lastFetchDisposition: observation.fetchDisposition,
                  lastHttpStatus: observation.httpStatus,
                  lastModified: observation.lastModified,
                  lastNotModifiedAt: observation.freshness.lastNotModifiedAt
                    ? new Date(observation.freshness.lastNotModifiedAt)
                    : null,
                  lastSeenAt: new Date(observation.observedAt),
                  lastSuccessfulRunId: observation.freshness.lastSuccessfulRunId,
                  mainContentHash: observation.freshness.mainContentHash,
                  nextEligibleFetchAt: new Date(observation.nextEligibleFetchAt),
                  pageFamily: observation.pageFamily,
                  pageTitleNormalized: observation.pageTitleNormalized,
                  priorityScore: observation.priorityScore,
                  responseBodyHash: observation.freshness.responseBodyHash,
                  updatedAt: writeTimestamp,
                },
              });
          }
        }

        await tx.insert(runOutbox).values({
          attemptCount: input.outboxEvent.attemptCount,
          availableAt: new Date(input.outboxEvent.availableAt),
          eventId: input.outboxEvent.eventId,
          eventType: input.outboxEvent.eventType,
          lastError: input.outboxEvent.lastError,
          occurredAt: new Date(input.outboxEvent.occurredAt),
          payloadJson: input.outboxEvent.payload,
          processedAt: input.outboxEvent.processedAt
            ? new Date(input.outboxEvent.processedAt)
            : null,
          runId: input.outboxEvent.runId,
        });
      });

      return input.run;
    },

    async getRunById(runId) {
      const db = await getDb();
      const rows = await db.select().from(crawlRuns).where(eq(crawlRuns.runId, runId)).limit(1);

      return rows[0] ? toStoredOfficialWebRun(rows[0]) : null;
    },

    async getRunBySchedulerKey(siteId, schedulerRunKey, runIntent) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(crawlRuns)
        .where(
          and(
            eq(crawlRuns.siteId, siteId),
            eq(crawlRuns.schedulerRunKey, schedulerRunKey),
            eq(crawlRuns.runIntent, runIntent),
          ),
        )
        .limit(1);

      return rows[0] ? toStoredOfficialWebRun(rows[0]) : null;
    },

    async listPageFreshnessStates(siteId, normalizedCanonicalUrls) {
      if (normalizedCanonicalUrls.length === 0) {
        return [];
      }

      const db = await getDb();
      const rows = await db
        .select()
        .from(pageFreshness)
        .where(
          and(
            eq(pageFreshness.siteId, siteId),
            inArray(pageFreshness.normalizedCanonicalUrl, normalizedCanonicalUrls),
          ),
        )
        .limit(normalizedCanonicalUrls.length);

      return rows.map(toStoredPageFreshnessState);
    },
  };
}
