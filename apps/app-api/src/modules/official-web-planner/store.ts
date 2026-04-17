import { and, asc, desc, eq, inArray, lte, not } from "drizzle-orm";

import type { Env } from "../../config";
import { withRuntimeDatabase } from "../../db/runtime";
import { pageFreshness } from "../../db/schema";
import type { OfficialWebPlannerPageCandidate, OfficialWebPlannerStore, NormalizedOfficialWebPlannerFilters } from "./service";
import type { OfficialWebFetchDisposition } from "../official-web-command";

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toPlannerPageCandidate(
  row: typeof pageFreshness.$inferSelect,
): OfficialWebPlannerPageCandidate {
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

function buildPlannerCadenceCondition(filters: NormalizedOfficialWebPlannerFilters) {
  if (filters.runIntent === "repair") {
    return inArray(pageFreshness.lastFetchDisposition, ["fetch_failed"]);
  }

  if (filters.runIntent === "hot") {
    return inArray(pageFreshness.cadenceClass, ["listing_hot", "detail_recent"]);
  }

  return eq(pageFreshness.cadenceClass, "baseline_static");
}

function resolveFetchLimit(filters: NormalizedOfficialWebPlannerFilters): number {
  const hostCount = Math.max(filters.hostFilter.length, 1);
  return Math.max(filters.maxTotalPages * 4, filters.maxPagesPerHost * hostCount * 2);
}

export function createPgOfficialWebPlannerStore(env: Env): OfficialWebPlannerStore {
  return {
    async listDuePages(filters) {
      return withRuntimeDatabase(env, async (db) => {
        const conditions = [
          eq(pageFreshness.siteId, filters.siteId),
          lte(pageFreshness.nextEligibleFetchAt, new Date(filters.now)),
          not(eq(pageFreshness.lastFetchDisposition, "deleted")),
          buildPlannerCadenceCondition(filters),
        ];

        if (filters.hostFilter.length > 0) {
          conditions.push(inArray(pageFreshness.host, filters.hostFilter));
        }

        const rows = await db
          .select()
          .from(pageFreshness)
          .where(and(...conditions))
          .orderBy(
            desc(pageFreshness.priorityScore),
            asc(pageFreshness.nextEligibleFetchAt),
            desc(pageFreshness.lastChangedAt),
            asc(pageFreshness.normalizedCanonicalUrl),
          )
          .limit(resolveFetchLimit(filters));

        const selected: OfficialWebPlannerPageCandidate[] = [];
        const remainingByHost = new Map<string, number>();

        for (const row of rows) {
          if (selected.length >= filters.maxTotalPages) {
            break;
          }

          const remaining = remainingByHost.get(row.host) ?? filters.maxPagesPerHost;
          if (remaining < 1) {
            continue;
          }

          remainingByHost.set(row.host, remaining - 1);
          selected.push(toPlannerPageCandidate(row));
        }

        return selected;
      });
    },
  };
}
