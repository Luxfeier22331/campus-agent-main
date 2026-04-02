// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createWorkerRuntime } from "../src/index";
import {
  buildOfficialWebCommandService,
  type OfficialWebArtifactRecord,
  type OfficialWebCommandStore,
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
  type OfficialWebQueryStore,
  type OfficialWebRunRecord,
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
      campusScope: "main",
      departments: ["ops"],
      groups: ["panel"],
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
    async getRunBySchedulerKey(siteId, schedulerRunKey) {
      for (const run of state.runs.values()) {
        if (run.siteId === siteId && run.schedulerRunKey === schedulerRunKey) {
          return { ...run };
        }
      }

      return null;
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
    lastHeartbeatAt: run.lastHeartbeatAt,
    runId: run.runId,
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
        lastHeartbeatAt: projection.lastHeartbeatAt,
        projectedAt: projection.projectedAt,
        runId: projection.runId,
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
        store: createMemoryQueryStore(state),
      }),
      requestProjector: {
        drain: vi.fn().mockResolvedValue({
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
        runId: "owrun_01HQ",
        status: "completed",
      }),
    });

    const siteResponse = await runtime.fetch(
      new Request("https://app-api.internal/api/operator/official-web/sites/www_muc_edu_cn"),
    );
    expect(siteResponse.status).toBe(200);
    await expect(siteResponse.json()).resolves.toEqual({
      recentRuns: [
        expect.objectContaining({
          ingestionDispatchStatus: "dispatched",
          runId: "owrun_01HQ",
        }),
      ],
      site: expect.objectContaining({
        latestIngestionDispatchStatus: "dispatched",
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
});
