import { and, desc, eq, gt, lt, or } from "drizzle-orm";

import { decodeBase64UrlJson, encodeBase64UrlJson } from "../../base64url";
import type { Env } from "../../config";
import { createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { officialWebRunProjection, officialWebSiteProjection } from "../../db/schema";
import type {
  NormalizedOfficialWebRunListFilters,
  OfficialWebQueryStore,
  OfficialWebRunRecord,
  OfficialWebSiteRecord,
} from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

interface OfficialWebRunCursor {
  runId: string;
  startedAt: string;
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function encodeCursor(input: OfficialWebRunCursor): string {
  return encodeBase64UrlJson(input);
}

function decodeCursor(cursor: string): OfficialWebRunCursor | null {
  try {
    const parsed = decodeBase64UrlJson<Partial<OfficialWebRunCursor>>(cursor);
    if (
      typeof parsed.runId !== "string" ||
      !parsed.runId ||
      typeof parsed.startedAt !== "string" ||
      !parsed.startedAt
    ) {
      return null;
    }

    return {
      runId: parsed.runId,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

function toRunRecord(row: typeof officialWebRunProjection.$inferSelect): OfficialWebRunRecord {
  return {
    artifacts: row.artifactsJson ?? [],
    collectorVersion: row.collectorVersion ?? null,
    configVersion: row.configVersion ?? null,
    failureCount: row.failureCount,
    finishedAt: toIsoString(row.finishedAt),
    id: row.runId,
    ingestionDispatchRef: row.ingestionDispatchRef ?? null,
    ingestionDispatchStatus: row.ingestionDispatchStatus,
    lastHeartbeatAt: toIsoString(row.lastHeartbeatAt),
    projectedAt: row.projectedAt.toISOString(),
    runId: row.runId,
    siteId: row.siteId,
    startedAt: row.startedAt.toISOString(),
    status: row.status,
    summary: row.summaryJson ?? null,
  };
}

function toSiteRecord(row: typeof officialWebSiteProjection.$inferSelect): OfficialWebSiteRecord {
  return {
    displayName: row.displayName,
    hostRoots: row.hostRootsJson ?? [],
    id: row.siteId,
    lastFailureAt: toIsoString(row.lastFailureAt),
    lastSuccessAt: toIsoString(row.lastSuccessAt),
    latestCollectorVersion: row.latestCollectorVersion ?? null,
    latestConfigVersion: row.latestConfigVersion ?? null,
    latestIngestionDispatchStatus: row.latestIngestionDispatchStatus ?? null,
    latestRunId: row.latestRunId ?? null,
    latestRunStatus: row.latestRunStatus ?? null,
    projectedAt: row.projectedAt.toISOString(),
    siteId: row.siteId,
  };
}

export function createPgOfficialWebQueryStore(
  env: Env,
  input: {
    getDb?: RuntimeDbGetter;
  } = {},
): OfficialWebQueryStore {
  const getDb = input.getDb ?? createRuntimeDbGetter(env);

  return {
    async getRunById(runId) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(officialWebRunProjection)
        .where(eq(officialWebRunProjection.runId, runId))
        .limit(1);

      return rows[0] ? toRunRecord(rows[0]) : null;
    },

    async getSiteById(siteId) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(officialWebSiteProjection)
        .where(eq(officialWebSiteProjection.siteId, siteId))
        .limit(1);

      return rows[0] ? toSiteRecord(rows[0]) : null;
    },

    async listRecentRunsBySiteId(siteId, limit) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(officialWebRunProjection)
        .where(eq(officialWebRunProjection.siteId, siteId))
        .orderBy(desc(officialWebRunProjection.startedAt), desc(officialWebRunProjection.runId))
        .limit(limit);

      return rows.map(toRunRecord);
    },

    async listRuns(filters) {
      const db = await getDb();
      const conditions = [];

      if (filters.siteId) {
        conditions.push(eq(officialWebRunProjection.siteId, filters.siteId));
      }
      if (filters.status) {
        conditions.push(eq(officialWebRunProjection.status, filters.status));
      }
      if (filters.ingestionDispatchStatus) {
        conditions.push(
          eq(officialWebRunProjection.ingestionDispatchStatus, filters.ingestionDispatchStatus),
        );
      }
      if (filters.startedAfter) {
        conditions.push(gt(officialWebRunProjection.startedAt, new Date(filters.startedAfter)));
      }
      if (filters.startedBefore) {
        conditions.push(lt(officialWebRunProjection.startedAt, new Date(filters.startedBefore)));
      }
      if (filters.cursor) {
        const cursor = decodeCursor(filters.cursor);
        if (cursor) {
          conditions.push(
            or(
              lt(officialWebRunProjection.startedAt, new Date(cursor.startedAt)),
              and(
                eq(officialWebRunProjection.startedAt, new Date(cursor.startedAt)),
                lt(officialWebRunProjection.runId, cursor.runId),
              ),
            )!,
          );
        }
      }

      const baseQuery =
        conditions.length > 0
          ? db.select().from(officialWebRunProjection).where(and(...conditions))
          : db.select().from(officialWebRunProjection);
      const rows = await baseQuery
        .orderBy(desc(officialWebRunProjection.startedAt), desc(officialWebRunProjection.runId))
        .limit(filters.limit + 1);

      const items = rows.slice(0, filters.limit).map(toRunRecord);
      const nextRow = rows[filters.limit];

      return {
        page: {
          nextCursor: nextRow
            ? encodeCursor({
                runId: nextRow.runId,
                startedAt: nextRow.startedAt.toISOString(),
              })
            : null,
        },
        runs: items,
      };
    },

    async listSites() {
      const db = await getDb();
      const rows = await db
        .select()
        .from(officialWebSiteProjection)
        .orderBy(desc(officialWebSiteProjection.projectedAt), officialWebSiteProjection.siteId);

      return {
        sites: rows.map(toSiteRecord),
      };
    },
  };
}
