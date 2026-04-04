import { and, eq } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { crawlRuns, runArtifacts, runHeartbeats, runOutbox } from "../../db/schema";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export type OfficialWebRunStatus =
  | "accepted"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "abandoned";

export type OfficialWebTerminalRunStatus = "completed" | "completed_with_errors" | "failed";

export type OfficialWebIngestionDispatchStatus =
  | "pending"
  | "queued"
  | "dispatched"
  | "ingestion_failed";

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
  lastHeartbeatAt: string | null;
  latestHeartbeatSequence: number;
  runId: string;
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
  outboxEvent: OfficialWebRunOutboxWrite;
  run: StoredOfficialWebRun;
}

export interface OfficialWebCommandStore {
  acceptRun(input: AcceptOfficialWebRunWrite): Promise<StoredOfficialWebRun>;
  appendHeartbeat(input: AppendOfficialWebHeartbeatWrite): Promise<StoredOfficialWebRun>;
  finalizeRun(input: FinalizeOfficialWebRunWrite): Promise<StoredOfficialWebRun>;
  getRunById(runId: string): Promise<StoredOfficialWebRun | null>;
  getRunBySchedulerKey(siteId: string, schedulerRunKey: string): Promise<StoredOfficialWebRun | null>;
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toStoredOfficialWebRun(
  row: typeof crawlRuns.$inferSelect,
): StoredOfficialWebRun {
  return {
    collectorVersion: row.collectorVersion,
    configVersion: row.configVersion,
    crawlPolicyVersion: row.crawlPolicyVersion,
    finishedAt: toIsoString(row.finishedAt),
    hostSet: row.hostSetJson,
    ingestionDispatchRef: row.ingestionDispatchRef ?? null,
    ingestionDispatchStatus: row.ingestionDispatchStatus as OfficialWebIngestionDispatchStatus,
    ingestionDispatchedAt: toIsoString(row.ingestionDispatchedAt),
    lastHeartbeatAt: toIsoString(row.lastHeartbeatAt),
    latestHeartbeatSequence: row.latestHeartbeatSequence,
    runId: row.runId,
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
          lastHeartbeatAt: null,
          latestHeartbeatSequence: input.run.latestHeartbeatSequence,
          runId: input.run.runId,
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
            status: input.run.status,
            summaryJson: input.run.summary,
            terminalErrorCode: input.run.terminalErrorCode,
            terminalErrorMessage: input.run.terminalErrorMessage,
            terminalPayloadSha256: input.run.terminalPayloadSha256,
            updatedAt: new Date(input.run.finishedAt ?? input.outboxEvent.occurredAt),
          })
          .where(eq(crawlRuns.runId, input.run.runId));

        if (input.artifacts.length > 0) {
          await tx.insert(runArtifacts).values(
            input.artifacts.map((artifact, index) => ({
              artifactId: `${input.run.runId}_artifact_${index + 1}`,
              artifactType: artifact.artifactType,
              byteSize: artifact.byteSize,
              contentSha256: artifact.contentSha256,
              createdAt: new Date(input.run.finishedAt ?? input.outboxEvent.occurredAt),
              objectKey: artifact.objectKey,
              recordCount: artifact.recordCount,
              runId: input.run.runId,
            })),
          );
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

    async getRunBySchedulerKey(siteId, schedulerRunKey) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(crawlRuns)
        .where(
          and(
            eq(crawlRuns.siteId, siteId),
            eq(crawlRuns.schedulerRunKey, schedulerRunKey),
          ),
        )
        .limit(1);

      return rows[0] ? toStoredOfficialWebRun(rows[0]) : null;
    },
  };
}
