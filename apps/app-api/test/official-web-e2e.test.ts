// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createWorkerRuntime } from "../src/index";
import {
  buildOfficialWebCommandService,
  type OfficialWebArtifactRecord,
  type OfficialWebCommandStore,
  type StoredOfficialWebPageFreshnessState,
  type StoredOfficialWebRun,
} from "../src/modules/official-web-command";
import {
  buildOfficialWebProjectionProjector,
  type OfficialWebProjectionProjectorStore,
  type OfficialWebRunOutboxEvent,
  type OfficialWebRunProjectionMaterialization,
  type OfficialWebRunProjectionSource,
  type OfficialWebSiteProjectionMaterialization,
  type OfficialWebSiteProjectionSource,
} from "../src/modules/official-web-projection";
import {
  buildOfficialWebQueryService,
  type OfficialWebPageChangeRecord,
  type OfficialWebQueryStore,
  type OfficialWebRunRecord,
  type OfficialWebSiteFreshnessSummary,
  type OfficialWebSiteRecord,
} from "../src/modules/official-web-query";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { RequestProjectionProjector } from "../src/modules/projection";

interface MemoryOutboxEvent extends OfficialWebRunOutboxEvent {
  lastError: string | null;
}

interface MemoryState {
  artifactsByRunId: Map<string, OfficialWebArtifactRecord[]>;
  outboxEvents: MemoryOutboxEvent[];
  pageChanges: OfficialWebPageChangeRecord[];
  pageFreshnessByUrl: Map<string, StoredOfficialWebPageFreshnessState>;
  runProjections: Map<string, OfficialWebRunRecord>;
  runs: Map<string, StoredOfficialWebRun>;
  siteProjections: Map<string, OfficialWebSiteRecord>;
}

const env = {
  APP_API_NAME: "campus-agent-app-api",
  APP_API_ENVIRONMENT: "test" as const,
  APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: "trusted-collector-token",
  BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
  PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
  SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
  SUPERVISOR_API_SHARED_SECRET: "shared-secret",
  APP_API_DB: {
    connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
  },
};

function createOperatorPrincipal(): ResolvedAppPrincipal {
  return {
    actor: {
      departments: ["ops"],
      principalId: "ops@example.com",
      principalType: "operator",
      roles: ["operator"],
      userId: "ops@example.com",
    },
    permissions: {
      chat: false,
      operator: true,
    },
    principal: {
      displayName: "Ops Team",
      email: "ops@example.com",
      principalId: "ops@example.com",
      type: "operator",
    },
    session: null,
  };
}

function createMemoryState(): MemoryState {
  return {
    artifactsByRunId: new Map(),
    outboxEvents: [],
    pageChanges: [],
    pageFreshnessByUrl: new Map(),
    runProjections: new Map(),
    runs: new Map(),
    siteProjections: new Map(),
  };
}

function createMemoryCommandStore(state: MemoryState): OfficialWebCommandStore {
  return {
    async acceptRun(input) {
      state.runs.set(input.run.runId, { ...input.run });
      state.outboxEvents.push({
        ...input.outboxEvent,
        lastError: input.outboxEvent.lastError,
      });
      return { ...input.run };
    },
    async appendHeartbeat(input) {
      state.runs.set(input.run.runId, { ...input.run });
      return { ...input.run };
    },
    async finalizeRun(input) {
      state.runs.set(input.run.runId, { ...input.run });
      state.artifactsByRunId.set(input.run.runId, input.artifacts.map((artifact) => ({ ...artifact })));
      for (const observation of input.observations) {
        state.pageChanges.push({
          changeStatus: observation.changeStatus,
          fetchDisposition: observation.fetchDisposition,
          host: observation.host,
          httpStatus: observation.httpStatus,
          id: observation.observationId,
          lastChangeReason: observation.lastChangeReason,
          normalizedCanonicalUrl: observation.normalizedCanonicalUrl,
          observedAt: observation.observedAt,
          pageFamily: observation.pageFamily,
          pageTitleNormalized: observation.pageTitleNormalized,
          rawAssetId: observation.rawAssetId,
          rawVersionId: observation.rawVersionId,
          runId: observation.runId,
        });
        state.pageFreshnessByUrl.set(`${observation.siteId}::${observation.normalizedCanonicalUrl}`, {
          cadenceClass: observation.cadenceClass,
          contentType: observation.contentType,
          discoveredFromUrl: observation.discoveredFromUrl,
          discoveryMethod: observation.discoveryMethod,
          etag: observation.etag,
          host: observation.host,
          lastChangeReason: observation.lastChangeReason,
          lastChangedAt: observation.freshness.lastChangedAt,
          lastFetchDisposition: observation.fetchDisposition,
          lastHttpStatus: observation.httpStatus,
          lastModified: observation.lastModified,
          lastNotModifiedAt: observation.freshness.lastNotModifiedAt,
          lastSeenAt: observation.observedAt,
          lastSuccessfulRunId: observation.freshness.lastSuccessfulRunId,
          mainContentHash: observation.freshness.mainContentHash,
          nextEligibleFetchAt: observation.nextEligibleFetchAt,
          normalizedCanonicalUrl: observation.normalizedCanonicalUrl,
          pageFamily: observation.pageFamily,
          pageTitleNormalized: observation.pageTitleNormalized,
          priorityScore: observation.priorityScore,
          responseBodyHash: observation.freshness.responseBodyHash,
          siteId: observation.siteId,
        });
      }
      state.outboxEvents.push({
        ...input.outboxEvent,
        lastError: input.outboxEvent.lastError,
      });
      return { ...input.run };
    },
    async getRunById(runId) {
      const run = state.runs.get(runId);
      return run ? { ...run } : null;
    },
    async getRunBySchedulerKey(siteId, schedulerRunKey, runIntent) {
      for (const run of state.runs.values()) {
        if (
          run.siteId === siteId &&
          run.schedulerRunKey === schedulerRunKey &&
          run.runIntent === runIntent
        ) {
          return { ...run };
        }
      }

      return null;
    },
    async listPageFreshnessStates(siteId, normalizedCanonicalUrls) {
      return normalizedCanonicalUrls
        .map((url) => state.pageFreshnessByUrl.get(`${siteId}::${url}`))
        .filter((item): item is StoredOfficialWebPageFreshnessState => Boolean(item))
        .map((item) => ({ ...item }));
    },
  };
}

function toRunProjectionSource(
  run: StoredOfficialWebRun,
  artifacts: OfficialWebArtifactRecord[],
): OfficialWebRunProjectionSource {
  return {
    artifacts: artifacts.map((artifact) => ({ ...artifact })),
    collectorVersion: run.collectorVersion,
    configVersion: run.configVersion,
    crawlPolicyVersion: run.crawlPolicyVersion,
    failureCount:
      typeof run.summary?.failureCount === "number"
        ? (run.summary.failureCount as number)
        : 0,
    finishedAt: run.finishedAt,
    hostSet: [...run.hostSet],
    ingestionDispatchRef: run.ingestionDispatchRef,
    ingestionDispatchStatus: run.ingestionDispatchStatus,
    ingestionExecutionErrorCode: run.ingestionExecutionErrorCode,
    ingestionExecutionErrorMessage: run.ingestionExecutionErrorMessage,
    ingestionExecutionRef: run.ingestionExecutionRef,
    ingestionExecutionStatus: run.ingestionExecutionStatus,
    ingestionExecutionUpdatedAt: run.ingestionExecutionUpdatedAt,
    lastHeartbeatAt: run.lastHeartbeatAt,
    runId: run.runId,
    runIntent: run.runIntent,
    schedulerRunKey: run.schedulerRunKey,
    seedSet: [...run.seedSet],
    siteId: run.siteId,
    startedAt: run.startedAt,
    status: run.status,
    summary: run.summary,
    triggerType: run.triggerType,
  };
}

function createMemoryProjectionStore(state: MemoryState): OfficialWebProjectionProjectorStore {
  return {
    async getRunProjectionSource(runId) {
      const run = state.runs.get(runId);
      if (!run) {
        return null;
      }

      return toRunProjectionSource(run, state.artifactsByRunId.get(runId) ?? []);
    },
    async getSiteProjectionSource(siteId) {
      const runs = [...state.runs.values()]
        .filter((run) => run.siteId === siteId)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
      const latest = runs[0];
      if (!latest) {
        return null;
      }

      return {
        displayName: "Www Muc Edu Cn",
        hostRoots: [...latest.hostSet],
        lastFailureAt: null,
        lastSuccessAt: latest.finishedAt,
        latestCollectorVersion: latest.collectorVersion,
        latestConfigVersion: latest.configVersion,
        latestIngestionDispatchStatus: latest.ingestionDispatchStatus,
        latestIngestionExecutionErrorCode: latest.ingestionExecutionErrorCode,
        latestIngestionExecutionStatus: latest.ingestionExecutionStatus,
        latestIngestionExecutionUpdatedAt: latest.ingestionExecutionUpdatedAt,
        latestRunId: latest.runId,
        latestRunStatus: latest.status,
        siteId: latest.siteId,
      } satisfies OfficialWebSiteProjectionSource;
    },
    async listPendingEvents(limit, now) {
      return state.outboxEvents
        .filter((event) => !event.processedAt && new Date(event.availableAt) <= now)
        .slice(0, limit)
        .map((event) => ({ ...event }));
    },
    async markEventFailed(input) {
      const event = state.outboxEvents.find((candidate) => candidate.eventId === input.eventId);
      if (!event) {
        return;
      }

      event.attemptCount = input.attemptCount;
      event.availableAt = input.availableAt;
      event.lastError = input.lastError;
      event.processedAt = input.processedAt;
    },
    async markEventProcessed(input) {
      const event = state.outboxEvents.find((candidate) => candidate.eventId === input.eventId);
      if (!event) {
        return;
      }

      event.attemptCount = 1;
      event.lastError = null;
      event.processedAt = input.processedAt;
    },
    async markTimedOutRunsAsAbandoned() {
      return 0;
    },
    async updateRunDispatchStatus(input) {
      const run = state.runs.get(input.runId);
      if (!run) {
        return;
      }

      state.runs.set(input.runId, {
        ...run,
        ingestionDispatchRef: input.dispatchRef,
        ingestionDispatchStatus: input.status,
        ingestionDispatchedAt: input.dispatchedAt,
      });
    },
    async updateRunExecutionStatus(input) {
      const run = state.runs.get(input.runId);
      if (!run) {
        return false;
      }

      state.runs.set(input.runId, {
        ...run,
        ingestionExecutionErrorCode: input.errorCode,
        ingestionExecutionErrorMessage: input.errorMessage,
        ingestionExecutionRef: input.executionRef,
        ingestionExecutionStatus: input.status,
        ingestionExecutionUpdatedAt: input.updatedAt,
      });
      return true;
    },
    async upsertRunProjection(projection: OfficialWebRunProjectionMaterialization) {
      state.runProjections.set(projection.runId, {
        artifacts: projection.artifacts.map((artifact) => ({ ...artifact })),
        collectorVersion: projection.collectorVersion,
        configVersion: projection.configVersion,
        failureCount: projection.failureCount,
        finishedAt: projection.finishedAt,
        id: projection.runId,
        ingestionDispatchRef: projection.ingestionDispatchRef,
        ingestionDispatchStatus: projection.ingestionDispatchStatus,
        ingestionExecutionErrorCode: projection.ingestionExecutionErrorCode,
        ingestionExecutionErrorMessage: projection.ingestionExecutionErrorMessage,
        ingestionExecutionRef: projection.ingestionExecutionRef,
        ingestionExecutionStatus: projection.ingestionExecutionStatus,
        ingestionExecutionUpdatedAt: projection.ingestionExecutionUpdatedAt,
        lastHeartbeatAt: projection.lastHeartbeatAt,
        projectedAt: projection.projectedAt,
        runId: projection.runId,
        runIntent: projection.runIntent,
        siteId: projection.siteId,
        startedAt: projection.startedAt,
        status: projection.status,
        summary: projection.summary,
      });
    },
    async upsertSiteProjection(projection: OfficialWebSiteProjectionMaterialization) {
      state.siteProjections.set(projection.siteId, {
        displayName: projection.displayName,
        hostRoots: [...projection.hostRoots],
        id: projection.siteId,
        lastFailureAt: projection.lastFailureAt,
        lastSuccessAt: projection.lastSuccessAt,
        latestCollectorVersion: projection.latestCollectorVersion,
        latestConfigVersion: projection.latestConfigVersion,
        latestIngestionDispatchStatus: projection.latestIngestionDispatchStatus,
        latestIngestionExecutionErrorCode: projection.latestIngestionExecutionErrorCode,
        latestIngestionExecutionStatus: projection.latestIngestionExecutionStatus,
        latestIngestionExecutionUpdatedAt: projection.latestIngestionExecutionUpdatedAt,
        latestRunId: projection.latestRunId,
        latestRunStatus: projection.latestRunStatus,
        projectedAt: projection.projectedAt,
        siteId: projection.siteId,
      });
    },
  };
}

function createMemoryQueryStore(state: MemoryState): OfficialWebQueryStore {
  return {
    async getRunById(runId) {
      const run = state.runProjections.get(runId);
      return run ? { ...run, artifacts: run.artifacts.map((artifact) => ({ ...artifact })) } : null;
    },
    async getSiteById(siteId) {
      const site = state.siteProjections.get(siteId);
      return site ? { ...site, hostRoots: [...site.hostRoots] } : null;
    },
    async getSiteFreshnessSummary(input): Promise<OfficialWebSiteFreshnessSummary> {
      const now = new Date(input.now).valueOf();
      const changedSince = now - 24 * 60 * 60 * 1000;
      const rows = [...state.pageFreshnessByUrl.values()].filter((row) => row.siteId === input.siteId);

      return {
        changedLast24h: rows.filter(
          (row) => row.lastChangedAt && new Date(row.lastChangedAt).valueOf() >= changedSince,
        ).length,
        deletedPages: rows.filter((row) => row.lastFetchDisposition === "deleted").length,
        duePages: rows.filter(
          (row) =>
            row.lastFetchDisposition !== "deleted" &&
            new Date(row.nextEligibleFetchAt).valueOf() <= now,
        ).length,
        failedFetchPages: rows.filter((row) => row.lastFetchDisposition === "fetch_failed").length,
        hotPages: rows.filter(
          (row) =>
            row.lastFetchDisposition !== "deleted" &&
            (row.cadenceClass === "listing_hot" || row.cadenceClass === "detail_recent"),
        ).length,
        repairPages: rows.filter(
          (row) =>
            row.lastFetchDisposition !== "deleted" &&
            (row.cadenceClass === "repair" || row.lastFetchDisposition === "fetch_failed"),
        ).length,
        totalPages: rows.length,
      };
    },
    async listSiteFreshnessBacklog(input) {
      const rows = [...state.pageFreshnessByUrl.values()]
        .filter((row) => row.siteId === input.siteId)
        .map((row) => ({
          cadenceClass: row.cadenceClass,
          host: row.host,
          lastChangeReason: row.lastChangeReason,
          lastChangedAt: row.lastChangedAt,
          lastFetchDisposition: row.lastFetchDisposition,
          lastHttpStatus: row.lastHttpStatus,
          lastSeenAt: row.lastSeenAt,
          nextEligibleFetchAt: row.nextEligibleFetchAt,
          normalizedCanonicalUrl: row.normalizedCanonicalUrl,
          pageFamily: row.pageFamily,
          pageTitleNormalized: row.pageTitleNormalized,
          priorityScore: row.priorityScore,
          siteId: row.siteId,
        }))
        .slice(0, input.limit);

      return {
        deletedPages: rows.filter((row) => row.lastFetchDisposition === "deleted"),
        duePages: rows.filter(
          (row) =>
            row.lastFetchDisposition !== "deleted" &&
            new Date(row.nextEligibleFetchAt).valueOf() <= new Date(input.now).valueOf(),
        ),
        failedFetchPages: rows.filter((row) => row.lastFetchDisposition === "fetch_failed"),
        hotPages: rows.filter(
          (row) =>
            row.lastFetchDisposition !== "deleted" &&
            (row.cadenceClass === "listing_hot" || row.cadenceClass === "detail_recent"),
        ),
      };
    },
    async listPageChangesByRunId(runId) {
      return state.pageChanges
        .filter(
          (change) =>
            change.runId === runId &&
            change.changeStatus !== "not_modified",
        )
        .map((change) => ({ ...change }));
    },
    async listRecentPageChangesBySiteId(siteId) {
      const urls = new Set(
        [...state.pageFreshnessByUrl.values()]
          .filter((item) => item.siteId === siteId)
          .map((item) => item.normalizedCanonicalUrl),
      );
      return state.pageChanges
        .filter(
          (change) =>
            urls.has(change.normalizedCanonicalUrl) &&
            change.changeStatus !== "not_modified",
        )
        .map((change) => ({ ...change }));
    },
    async listRecentRunsBySiteId(siteId) {
      return [...state.runProjections.values()]
        .filter((run) => run.siteId === siteId)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .map((run) => ({ ...run, artifacts: run.artifacts.map((artifact) => ({ ...artifact })) }));
    },
    async listRuns() {
      return {
        page: {
          nextCursor: null,
        },
        runs: [...state.runProjections.values()].map((run) => ({
          ...run,
          artifacts: run.artifacts.map((artifact) => ({ ...artifact })),
        })),
      };
    },
    async listSites() {
      return {
        sites: [...state.siteProjections.values()].map((site) => ({
          ...site,
          hostRoots: [...site.hostRoots],
        })),
      };
    },
  };
}

describe("official web app-api e2e", () => {
  it("runs collector start/heartbeat/finalize through scheduled dispatch and exposes operator-visible dispatched projections", async () => {
    const state = createMemoryState();
    const handoffPublisher = {
      publish: vi.fn().mockResolvedValue({
        dispatchRef: "dispatch_01HQ",
      }),
    };
    const runtime = createWorkerRuntime(env, {
      getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
      officialWebCommandService: buildOfficialWebCommandService({
        generateId: vi
          .fn()
          .mockReturnValueOnce("owrun_01HQ")
          .mockReturnValueOnce("owevt_accepted_01HQ")
          .mockReturnValueOnce("owhb_01HQ")
          .mockReturnValueOnce("owevt_completed_01HQ"),
        now: () => new Date("2026-03-29T08:00:01.000Z"),
        store: createMemoryCommandStore(state),
      }),
      officialWebProjector: buildOfficialWebProjectionProjector({
        handoffPublisher,
        now: () => new Date("2026-03-29T08:17:33.000Z"),
        store: createMemoryProjectionStore(state),
      }),
      officialWebQueryService: buildOfficialWebQueryService({
        now: () => new Date("2026-03-29T14:30:00.000Z"),
        store: createMemoryQueryStore(state),
      }),
      requestProjector: {
        drain: vi.fn().mockResolvedValue({
          failed: 0,
          processed: 0,
        }),
        drainRequest: vi.fn().mockResolvedValue({
          failed: 0,
          processed: 0,
        }),
      } satisfies RequestProjectionProjector,
    });

    const start = await runtime.fetch(
      new Request("https://app-api.internal/api/official-web/runs", {
        body: JSON.stringify({
          collectorVersion: "official-web-collector@0.1.0",
          configVersion: "git:abc1234",
          crawlPolicyVersion: "2026-03-29",
          hostSet: ["www.muc.edu.cn"],
          runIntent: "baseline",
          schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
          seedSet: ["https://www.muc.edu.cn/"],
          siteId: "www_muc_edu_cn",
          startedAt: "2026-03-29T08:00:01.000Z",
          triggerType: "scheduled",
        }),
        headers: {
          authorization: "Bearer trusted-collector-token",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(start.status).toBe(200);

    const heartbeat = await runtime.fetch(
      new Request("https://app-api.internal/api/official-web/runs/owrun_01HQ/heartbeats", {
        body: JSON.stringify({
          counts: {
            artifactUploads: 6,
            failures: 0,
            pagesNormalized: 310,
            urlsDiscovered: 420,
            urlsFetched: 390,
          },
          observedAt: "2026-03-29T08:05:00.000Z",
          sequence: 1,
        }),
        headers: {
          authorization: "Bearer trusted-collector-token",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(heartbeat.status).toBe(200);

    const finalize = await runtime.fetch(
      new Request("https://app-api.internal/api/official-web/runs/owrun_01HQ/finalize", {
        body: JSON.stringify({
          artifacts: [
            {
              artifactType: "crawl_run_manifest",
              contentSha256: "abc123",
              objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/crawl-run.json",
              recordCount: 1,
            },
            {
              artifactType: "source_truth_bundle",
              contentSha256: "def456",
              objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/source-truth.tar",
              recordCount: 310,
            },
          ],
          finishedAt: "2026-03-29T08:17:32.000Z",
          pageObservations: [
            {
              contentType: "text/html",
              discoveredFromUrl: null,
              discoveryMethod: "seed",
              disposition: "fetched",
              etag: "etag-1",
              finalUrl: "https://www.muc.edu.cn/admissions",
              host: "www.muc.edu.cn",
              httpStatus: 200,
              lastModified: "Sat, 29 Mar 2026 08:00:00 GMT",
              mainContentHash: "main-1",
              normalizedCanonicalUrl: "https://www.muc.edu.cn/admissions",
              observedAt: "2026-03-29T08:17:32.000Z",
              pageFamily: "article_detail",
              pageTitleNormalized: "Admissions",
              rawAssetId: "raw_01",
              rawVersionId: "rawv_01",
              requestedUrl: "https://www.muc.edu.cn/admissions",
              responseBodyHash: "body-1",
            },
          ],
          summary: {
            failureCount: 0,
            pagesNormalized: 310,
            urlsDiscovered: 420,
            urlsFetched: 390,
          },
          terminalStatus: "completed",
        }),
        headers: {
          authorization: "Bearer trusted-collector-token",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(finalize.status).toBe(200);

    await runtime.scheduled();

    const runResponse = await runtime.fetch(
      new Request("https://app-api.internal/api/operator/official-web/runs/owrun_01HQ"),
    );
    expect(runResponse.status).toBe(200);
    await expect(runResponse.json()).resolves.toEqual({
      run: {
        pageChangeSummary: expect.objectContaining({
          newPages: 1,
        }),
        pageChanges: [
          expect.objectContaining({
            normalizedCanonicalUrl: "https://www.muc.edu.cn/admissions",
          }),
        ],
        run: expect.objectContaining({
          artifacts: [
            expect.objectContaining({
              artifactType: "crawl_run_manifest",
            }),
            expect.objectContaining({
              artifactType: "source_truth_bundle",
            }),
          ],
          ingestionDispatchRef: "dispatch_01HQ",
          ingestionDispatchStatus: "dispatched",
          ingestionExecutionStatus: "pending",
          runId: "owrun_01HQ",
          status: "completed",
        }),
      },
    });

    const siteResponse = await runtime.fetch(
      new Request("https://app-api.internal/api/operator/official-web/sites/www_muc_edu_cn"),
    );
    expect(siteResponse.status).toBe(200);
    await expect(siteResponse.json()).resolves.toEqual({
      freshnessBacklog: {
        deletedPages: [],
        duePages: [
          expect.objectContaining({
            normalizedCanonicalUrl: "https://www.muc.edu.cn/admissions",
          }),
        ],
        failedFetchPages: [],
        hotPages: [
          expect.objectContaining({
            cadenceClass: "detail_recent",
            normalizedCanonicalUrl: "https://www.muc.edu.cn/admissions",
          }),
        ],
      },
      freshnessSummary: expect.objectContaining({
        totalPages: 1,
      }),
      recentPageChanges: [
        expect.objectContaining({
          normalizedCanonicalUrl: "https://www.muc.edu.cn/admissions",
        }),
      ],
      recentRuns: [
        expect.objectContaining({
          ingestionDispatchStatus: "dispatched",
          ingestionExecutionStatus: "pending",
          runId: "owrun_01HQ",
        }),
      ],
      site: expect.objectContaining({
        latestIngestionDispatchStatus: "dispatched",
        latestIngestionExecutionStatus: "pending",
        latestRunId: "owrun_01HQ",
        siteId: "www_muc_edu_cn",
      }),
    });
    expect(handoffPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "owevt_completed_01HQ",
        runId: "owrun_01HQ",
        siteId: "www_muc_edu_cn",
      }),
    );
  });

  it("projects not_modified runs into operator-visible summaries without creating recent page changes", async () => {
    const state = createMemoryState();
    state.pageFreshnessByUrl.set("muc_public::https://www.muc.edu.cn/news/notice.htm", {
      cadenceClass: "detail_recent",
      contentType: "text/html",
      discoveredFromUrl: "https://www.muc.edu.cn/news/",
      discoveryMethod: "listing_link",
      etag: "\"etag-prev\"",
      host: "www.muc.edu.cn",
      lastChangeReason: "main_content_changed",
      lastChangedAt: "2026-03-29T07:00:00.000Z",
      lastFetchDisposition: "fetched",
      lastHttpStatus: 200,
      lastModified: "Sat, 29 Mar 2026 07:00:00 GMT",
      lastNotModifiedAt: null,
      lastSeenAt: "2026-03-29T07:00:00.000Z",
      lastSuccessfulRunId: "owrun_prev",
      mainContentHash: "main-prev",
      nextEligibleFetchAt: "2026-03-29T13:00:00.000Z",
      normalizedCanonicalUrl: "https://www.muc.edu.cn/news/notice.htm",
      pageFamily: "article_detail",
      pageTitleNormalized: "Notice",
      priorityScore: 75,
      responseBodyHash: "body-prev",
      siteId: "muc_public",
    });

    const handoffPublisher = {
      publish: vi.fn().mockResolvedValue({
        dispatchRef: "dispatch_not_modified",
      }),
    };
    const runtime = createWorkerRuntime(env, {
      getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
      officialWebCommandService: buildOfficialWebCommandService({
        generateId: vi
          .fn()
          .mockReturnValueOnce("owrun_not_modified")
          .mockReturnValueOnce("owevt_accepted_not_modified")
          .mockReturnValueOnce("owevt_completed_not_modified"),
        now: () => new Date("2026-03-29T09:00:00.000Z"),
        store: createMemoryCommandStore(state),
      }),
      officialWebProjector: buildOfficialWebProjectionProjector({
        handoffPublisher,
        now: () => new Date("2026-03-29T09:00:01.000Z"),
        store: createMemoryProjectionStore(state),
      }),
      officialWebQueryService: buildOfficialWebQueryService({
        now: () => new Date("2026-03-29T15:30:00.000Z"),
        store: createMemoryQueryStore(state),
      }),
      requestProjector: {
        drain: vi.fn().mockResolvedValue({
          failed: 0,
          processed: 0,
        }),
        drainRequest: vi.fn().mockResolvedValue({
          failed: 0,
          processed: 0,
        }),
      } satisfies RequestProjectionProjector,
    });

    const start = await runtime.fetch(
      new Request("https://app-api.internal/api/official-web/runs", {
        body: JSON.stringify({
          collectorVersion: "official-web-collector@0.1.0",
          configVersion: "git:abc1234",
          crawlPolicyVersion: "2026-03-29",
          hostSet: ["www.muc.edu.cn"],
          runIntent: "hot",
          schedulerRunKey: "cron-2026-03-29T09:00:00.000Z",
          seedSet: ["https://www.muc.edu.cn/"],
          siteId: "muc_public",
          startedAt: "2026-03-29T09:00:00.000Z",
          triggerType: "scheduled",
        }),
        headers: {
          authorization: "Bearer trusted-collector-token",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(start.status).toBe(200);

    const finalize = await runtime.fetch(
      new Request("https://app-api.internal/api/official-web/runs/owrun_not_modified/finalize", {
        body: JSON.stringify({
          artifacts: [],
          finishedAt: "2026-03-29T09:00:00.000Z",
          pageObservations: [
            {
              contentType: "text/html",
              discoveredFromUrl: "https://www.muc.edu.cn/news/",
              discoveryMethod: "listing_link",
              disposition: "not_modified",
              etag: "\"etag-prev\"",
              finalUrl: "https://www.muc.edu.cn/news/notice.htm",
              host: "www.muc.edu.cn",
              httpStatus: 304,
              lastModified: "Sat, 29 Mar 2026 07:00:00 GMT",
              mainContentHash: "main-prev",
              normalizedCanonicalUrl: "https://www.muc.edu.cn/news/notice.htm",
              observedAt: "2026-03-29T09:00:00.000Z",
              pageFamily: "article_detail",
              pageTitleNormalized: "Notice",
              rawAssetId: null,
              rawVersionId: null,
              requestedUrl: "https://www.muc.edu.cn/news/notice.htm",
              responseBodyHash: "body-prev",
            },
          ],
          summary: {
            failureCount: 0,
            pagesNormalized: 1,
            urlsDiscovered: 1,
            urlsFetched: 1,
          },
          terminalStatus: "completed",
        }),
        headers: {
          authorization: "Bearer trusted-collector-token",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(finalize.status).toBe(200);

    await runtime.scheduled();

    expect(
      state.pageFreshnessByUrl.get("muc_public::https://www.muc.edu.cn/news/notice.htm"),
    ).toMatchObject({
      lastChangeReason: "conditional_not_modified",
      lastChangedAt: "2026-03-29T07:00:00.000Z",
      lastFetchDisposition: "not_modified",
      lastNotModifiedAt: "2026-03-29T09:00:00.000Z",
      lastSuccessfulRunId: "owrun_not_modified",
    });

    const runResponse = await runtime.fetch(
      new Request("https://app-api.internal/api/operator/official-web/runs/owrun_not_modified"),
    );
    expect(runResponse.status).toBe(200);
    await expect(runResponse.json()).resolves.toEqual({
      run: {
        pageChangeSummary: expect.objectContaining({
          changedPages: 0,
          deletedPages: 0,
          failedFetchPages: 0,
          newPages: 0,
          notModifiedPages: 1,
        }),
        pageChanges: [],
        run: expect.objectContaining({
          ingestionDispatchRef: "dispatch_not_modified",
          ingestionDispatchStatus: "dispatched",
          ingestionExecutionStatus: "pending",
          runId: "owrun_not_modified",
          siteId: "muc_public",
          status: "completed",
        }),
      },
    });

    const siteResponse = await runtime.fetch(
      new Request("https://app-api.internal/api/operator/official-web/sites/muc_public"),
    );
    expect(siteResponse.status).toBe(200);
    await expect(siteResponse.json()).resolves.toEqual({
      freshnessBacklog: {
        deletedPages: [],
        duePages: [
          expect.objectContaining({
            lastFetchDisposition: "not_modified",
            normalizedCanonicalUrl: "https://www.muc.edu.cn/news/notice.htm",
          }),
        ],
        failedFetchPages: [],
        hotPages: [
          expect.objectContaining({
            lastFetchDisposition: "not_modified",
            normalizedCanonicalUrl: "https://www.muc.edu.cn/news/notice.htm",
          }),
        ],
      },
      freshnessSummary: expect.objectContaining({
        changedLast24h: 1,
        duePages: 1,
        hotPages: 1,
        totalPages: 1,
      }),
      recentPageChanges: [],
      recentRuns: [
        expect.objectContaining({
          runId: "owrun_not_modified",
          siteId: "muc_public",
        }),
      ],
      site: expect.objectContaining({
        latestIngestionDispatchStatus: "dispatched",
        latestIngestionExecutionStatus: "pending",
        latestRunId: "owrun_not_modified",
        siteId: "muc_public",
      }),
    });
  });
});
