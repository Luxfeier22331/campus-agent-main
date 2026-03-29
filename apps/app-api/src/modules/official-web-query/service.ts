import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";

export interface OfficialWebArtifactRecord {
  artifactType: string;
  byteSize: number | null;
  contentSha256: string;
  objectKey: string;
  recordCount: number | null;
}

export interface OfficialWebSiteRecord {
  displayName: string;
  hostRoots: string[];
  id: string;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  latestCollectorVersion: string | null;
  latestConfigVersion: string | null;
  latestIngestionDispatchStatus: string | null;
  latestRunId: string | null;
  latestRunStatus: string | null;
  projectedAt: string;
  siteId: string;
}

export interface OfficialWebRunRecord {
  artifacts: OfficialWebArtifactRecord[];
  collectorVersion: string | null;
  configVersion: string | null;
  failureCount: number;
  finishedAt: string | null;
  id: string;
  ingestionDispatchRef: string | null;
  ingestionDispatchStatus: string;
  lastHeartbeatAt: string | null;
  projectedAt: string;
  runId: string;
  siteId: string;
  startedAt: string;
  status: string;
  summary: Record<string, unknown> | null;
}

export interface OfficialWebRunListFilters {
  cursor?: string | null;
  ingestionDispatchStatus?: string | null;
  limit?: number | null;
  siteId?: string | null;
  startedAfter?: string | null;
  startedBefore?: string | null;
  status?: string | null;
}

export interface NormalizedOfficialWebRunListFilters {
  cursor: string | null;
  ingestionDispatchStatus: string | null;
  limit: number;
  siteId: string | null;
  startedAfter: string | null;
  startedBefore: string | null;
  status: string | null;
}

export interface OfficialWebQueryStore {
  getRunById(runId: string): Promise<OfficialWebRunRecord | null>;
  getSiteById(siteId: string): Promise<OfficialWebSiteRecord | null>;
  listRecentRunsBySiteId(siteId: string, limit: number): Promise<OfficialWebRunRecord[]>;
  listRuns(filters: NormalizedOfficialWebRunListFilters): Promise<{
    page: {
      nextCursor: string | null;
    };
    runs: OfficialWebRunRecord[];
  }>;
  listSites(): Promise<{
    sites: OfficialWebSiteRecord[];
  }>;
}

export interface OfficialWebQueryService {
  getRunById(input: {
    principal: ResolvedAppPrincipal;
    runId: string;
  }): Promise<OfficialWebRunRecord>;
  getSiteById(input: {
    principal: ResolvedAppPrincipal;
    siteId: string;
  }): Promise<{
    recentRuns: OfficialWebRunRecord[];
    site: OfficialWebSiteRecord;
  }>;
  listRuns(input: {
    filters: OfficialWebRunListFilters;
    principal: ResolvedAppPrincipal;
  }): Promise<{
    page: {
      nextCursor: string | null;
    };
    runs: OfficialWebRunRecord[];
  }>;
  listSites(input: {
    principal: ResolvedAppPrincipal;
  }): Promise<{
    sites: OfficialWebSiteRecord[];
  }>;
}

export interface OfficialWebQueryServiceDependencies {
  store: OfficialWebQueryStore;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_SITE_RECENT_RUN_LIMIT = 10;
const MAX_LIMIT = 100;

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.floor(value), MAX_LIMIT);
}

function normalizeOptionalTimestamp(value: string | null | undefined, field: string): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf())) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be a valid ISO timestamp.`,
      retryable: false,
      status: 400,
    });
  }

  return parsed.toISOString();
}

function ensureOperatorPrincipal(principal: ResolvedAppPrincipal): void {
  if (!principal.permissions.operator) {
    throw new AppApiRouteError({
      code: "forbidden",
      message: "Operator access is not available for this principal.",
      retryable: false,
      status: 403,
    });
  }
}

export function buildOfficialWebQueryService(
  dependencies: OfficialWebQueryServiceDependencies,
): OfficialWebQueryService {
  return {
    async getRunById(input) {
      ensureOperatorPrincipal(input.principal);
      const runId = normalizeOptionalString(input.runId);
      if (!runId) {
        throw new AppApiRouteError({
          code: "run_not_found",
          message: "Official web run not found.",
          retryable: false,
          status: 404,
        });
      }

      const run = await dependencies.store.getRunById(runId);
      if (!run) {
        throw new AppApiRouteError({
          code: "run_not_found",
          message: "Official web run not found.",
          retryable: false,
          status: 404,
        });
      }

      return run;
    },

    async getSiteById(input) {
      ensureOperatorPrincipal(input.principal);
      const siteId = normalizeOptionalString(input.siteId);
      if (!siteId) {
        throw new AppApiRouteError({
          code: "site_not_found",
          message: "Official web site not found.",
          retryable: false,
          status: 404,
        });
      }

      const site = await dependencies.store.getSiteById(siteId);
      if (!site) {
        throw new AppApiRouteError({
          code: "site_not_found",
          message: "Official web site not found.",
          retryable: false,
          status: 404,
        });
      }

      return {
        recentRuns: await dependencies.store.listRecentRunsBySiteId(siteId, DEFAULT_SITE_RECENT_RUN_LIMIT),
        site,
      };
    },

    async listRuns(input) {
      ensureOperatorPrincipal(input.principal);

      return dependencies.store.listRuns({
        cursor: normalizeOptionalString(input.filters.cursor),
        ingestionDispatchStatus: normalizeOptionalString(input.filters.ingestionDispatchStatus),
        limit: normalizeLimit(input.filters.limit),
        siteId: normalizeOptionalString(input.filters.siteId),
        startedAfter: normalizeOptionalTimestamp(input.filters.startedAfter, "startedAfter"),
        startedBefore: normalizeOptionalTimestamp(input.filters.startedBefore, "startedBefore"),
        status: normalizeOptionalString(input.filters.status),
      } satisfies NormalizedOfficialWebRunListFilters);
    },

    async listSites(input) {
      ensureOperatorPrincipal(input.principal);
      return dependencies.store.listSites();
    },
  };
}
