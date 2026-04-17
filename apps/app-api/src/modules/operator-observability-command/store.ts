import { eq } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
  qualityGradeProjection,
  requestObservabilityFact,
  traceBacklinkProjection,
} from "../../db/schema";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface StoredRequestObservabilitySeed {
  requestId: string;
  traceId: string;
  surface: string;
  requestStartedAt: string;
  selectedTarget: string | null;
  requestedCapability: string | null;
  principalType: string;
  collection: string | null;
  modelName: string | null;
}

export interface QualityGradeProjectionWrite {
  gradeId: string;
  requestId: string;
  traceId: string;
  surface: string;
  requestStartedAt: string;
  selectedTarget: string | null;
  requestedCapability: string | null;
  principalType: string;
  collection: string | null;
  modelName: string | null;
  gradeSource: string;
  gradeDomain: string;
  verdict: string;
  scoreMilli: number | null;
  graderVersion: string;
  rationaleSummary: string | null;
  sampledAt: string;
  projectedAt: string;
}

export interface TraceBacklinkProjectionWrite {
  requestId: string;
  traceId: string;
  traceLink: string | null;
  issueLink: string | null;
  issueFingerprint: string | null;
  projectedAt: string;
}

export interface OperatorObservabilityCommandStore {
  getRequestObservabilitySeed(requestId: string): Promise<StoredRequestObservabilitySeed | null>;
  upsertQualityGrades(input: { grades: QualityGradeProjectionWrite[] }): Promise<void>;
  upsertTraceBacklinks(input: { backlinks: TraceBacklinkProjectionWrite[] }): Promise<void>;
}

function toStoredRequestObservabilitySeed(
  row: typeof requestObservabilityFact.$inferSelect,
): StoredRequestObservabilitySeed {
  return {
    collection: row.collection ?? null,
    modelName: row.modelName ?? null,
    principalType: row.principalType,
    requestId: row.requestId,
    requestedCapability: row.requestedCapability ?? null,
    requestStartedAt: row.startedAt.toISOString(),
    selectedTarget: row.selectedTarget ?? null,
    surface: row.surface,
    traceId: row.traceId,
  };
}

export function createPgOperatorObservabilityCommandStore(
  env: Env,
  input: {
    getDb?: RuntimeDbGetter;
  } = {},
): OperatorObservabilityCommandStore {
  const getDb = input.getDb ?? createRuntimeDbGetter(env);

  return {
    async getRequestObservabilitySeed(requestId) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(requestObservabilityFact)
        .where(eq(requestObservabilityFact.requestId, requestId))
        .limit(1);

      return rows[0] ? toStoredRequestObservabilitySeed(rows[0]) : null;
    },

    async upsertQualityGrades(input) {
      if (input.grades.length === 0) {
        return;
      }

      const db = await getDb();
      await db.transaction(async (tx) => {
        for (const grade of input.grades) {
          await tx
            .insert(qualityGradeProjection)
            .values({
              collection: grade.collection,
              gradeDomain: grade.gradeDomain,
              gradeId: grade.gradeId,
              gradeSource: grade.gradeSource,
              graderVersion: grade.graderVersion,
              modelName: grade.modelName,
              principalType: grade.principalType,
              projectedAt: new Date(grade.projectedAt),
              rationaleSummary: grade.rationaleSummary,
              requestId: grade.requestId,
              requestStartedAt: new Date(grade.requestStartedAt),
              requestedCapability: grade.requestedCapability,
              sampledAt: new Date(grade.sampledAt),
              scoreMilli: grade.scoreMilli,
              selectedTarget: grade.selectedTarget,
              surface: grade.surface,
              traceId: grade.traceId,
              verdict: grade.verdict,
            })
            .onConflictDoUpdate({
              set: {
                collection: grade.collection,
                gradeDomain: grade.gradeDomain,
                gradeSource: grade.gradeSource,
                graderVersion: grade.graderVersion,
                modelName: grade.modelName,
                principalType: grade.principalType,
                projectedAt: new Date(grade.projectedAt),
                rationaleSummary: grade.rationaleSummary,
                requestId: grade.requestId,
                requestStartedAt: new Date(grade.requestStartedAt),
                requestedCapability: grade.requestedCapability,
                sampledAt: new Date(grade.sampledAt),
                scoreMilli: grade.scoreMilli,
                selectedTarget: grade.selectedTarget,
                surface: grade.surface,
                traceId: grade.traceId,
                verdict: grade.verdict,
              },
              target: qualityGradeProjection.gradeId,
            });
        }
      });
    },

    async upsertTraceBacklinks(input) {
      if (input.backlinks.length === 0) {
        return;
      }

      const db = await getDb();
      await db.transaction(async (tx) => {
        for (const backlink of input.backlinks) {
          await tx
            .insert(traceBacklinkProjection)
            .values({
              issueFingerprint: backlink.issueFingerprint,
              issueLink: backlink.issueLink,
              projectedAt: new Date(backlink.projectedAt),
              requestId: backlink.requestId,
              traceId: backlink.traceId,
              traceLink: backlink.traceLink,
            })
            .onConflictDoUpdate({
              set: {
                issueFingerprint: backlink.issueFingerprint,
                issueLink: backlink.issueLink,
                projectedAt: new Date(backlink.projectedAt),
                traceId: backlink.traceId,
                traceLink: backlink.traceLink,
              },
              target: traceBacklinkProjection.requestId,
            });
        }
      });
    },
  };
}
