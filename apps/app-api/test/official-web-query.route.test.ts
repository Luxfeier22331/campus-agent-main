// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { OfficialWebQueryService } from "../src/modules/official-web-query";

const env = {
  APP_API_NAME: "campus-agent-app-api",
  APP_API_ENVIRONMENT: "test" as const,
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

function createPublicPrincipal(): ResolvedAppPrincipal {
  return {
    actor: {
      campusScope: null,
      departments: [],
      groups: ["public_chat_users"],
      principalId: "user_01HQ",
      principalType: "public_user",
      roles: ["public_user"],
      userId: "user_01HQ",
    },
    permissions: {
      chat: true,
      operator: false,
    },
    principal: {
      displayName: "Jane Doe",
      email: "jane@example.edu",
      principalId: "user_01HQ",
      type: "public_user",
    },
    session: {
      expiresAt: "2026-03-29T07:00:00.000Z",
      sessionId: "sess_01HQ",
    },
  };
}

describe("official web operator query routes", () => {
  it("returns site summaries for operator principals only", async () => {
    const principal = createOperatorPrincipal();
    const service: OfficialWebQueryService = {
      getRunById: vi.fn(),
      getSiteById: vi.fn(),
      listRuns: vi.fn(),
      listSites: vi.fn().mockResolvedValue({
        sites: [
          {
            displayName: "Www Muc Edu Cn",
            hostRoots: ["www.muc.edu.cn"],
            id: "www_muc_edu_cn",
            lastFailureAt: null,
            lastSuccessAt: "2026-03-29T08:17:32.000Z",
            latestCollectorVersion: "official-web-collector@0.1.0",
            latestConfigVersion: "git:abc1234",
            latestIngestionDispatchStatus: "queued",
            latestRunId: "owrun_01HQ",
            latestRunStatus: "completed",
            projectedAt: "2026-03-29T08:17:33.000Z",
            siteId: "www_muc_edu_cn",
          },
        ],
      }),
    };
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      officialWebQueryService: service,
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/operator/official-web/sites"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sites: [
        {
          displayName: "Www Muc Edu Cn",
          hostRoots: ["www.muc.edu.cn"],
          id: "www_muc_edu_cn",
          lastFailureAt: null,
          lastSuccessAt: "2026-03-29T08:17:32.000Z",
          latestCollectorVersion: "official-web-collector@0.1.0",
          latestConfigVersion: "git:abc1234",
          latestIngestionDispatchStatus: "queued",
          latestRunId: "owrun_01HQ",
          latestRunStatus: "completed",
          projectedAt: "2026-03-29T08:17:33.000Z",
          siteId: "www_muc_edu_cn",
        },
      ],
    });
    expect(service.listSites).toHaveBeenCalledWith({
      principal,
    });
  });

  it("returns site detail with recent runs", async () => {
    const principal = createOperatorPrincipal();
    const service: OfficialWebQueryService = {
      getRunById: vi.fn(),
      getSiteById: vi.fn().mockResolvedValue({
        recentRuns: [
          {
            artifacts: [],
            collectorVersion: "official-web-collector@0.1.0",
            configVersion: "git:abc1234",
            failureCount: 0,
            finishedAt: "2026-03-29T08:17:32.000Z",
            id: "owrun_01HQ",
            ingestionDispatchRef: null,
            ingestionDispatchStatus: "queued",
            lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
            projectedAt: "2026-03-29T08:17:33.000Z",
            runId: "owrun_01HQ",
            siteId: "www_muc_edu_cn",
            startedAt: "2026-03-29T08:00:01.000Z",
            status: "completed",
            summary: {
              failureCount: 0,
            },
          },
        ],
        site: {
          displayName: "Www Muc Edu Cn",
          hostRoots: ["www.muc.edu.cn"],
          id: "www_muc_edu_cn",
          lastFailureAt: null,
          lastSuccessAt: "2026-03-29T08:17:32.000Z",
          latestCollectorVersion: "official-web-collector@0.1.0",
          latestConfigVersion: "git:abc1234",
          latestIngestionDispatchStatus: "queued",
          latestRunId: "owrun_01HQ",
          latestRunStatus: "completed",
          projectedAt: "2026-03-29T08:17:33.000Z",
          siteId: "www_muc_edu_cn",
        },
      }),
      listRuns: vi.fn(),
      listSites: vi.fn(),
    };
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      officialWebQueryService: service,
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/operator/official-web/sites/www_muc_edu_cn"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recentRuns: [
        expect.objectContaining({
          id: "owrun_01HQ",
          runId: "owrun_01HQ",
        }),
      ],
      site: expect.objectContaining({
        id: "www_muc_edu_cn",
        siteId: "www_muc_edu_cn",
      }),
    });
  });

  it("returns crawl run list filters and fails closed for missing or non-operator principals", async () => {
    const principal = createOperatorPrincipal();
    const service: OfficialWebQueryService = {
      getRunById: vi.fn(),
      getSiteById: vi.fn(),
      listRuns: vi.fn().mockResolvedValue({
        page: {
          nextCursor: "cursor_02",
        },
        runs: [
          {
            artifacts: [],
            collectorVersion: "official-web-collector@0.1.0",
            configVersion: "git:abc1234",
            failureCount: 0,
            finishedAt: "2026-03-29T08:17:32.000Z",
            id: "owrun_01HQ",
            ingestionDispatchRef: null,
            ingestionDispatchStatus: "queued",
            lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
            projectedAt: "2026-03-29T08:17:33.000Z",
            runId: "owrun_01HQ",
            siteId: "www_muc_edu_cn",
            startedAt: "2026-03-29T08:00:01.000Z",
            status: "completed",
            summary: {
              failureCount: 0,
            },
          },
        ],
      }),
      listSites: vi.fn(),
    };
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      officialWebQueryService: service,
    });

    const response = await app.fetch(
      new Request(
        "https://app-api.internal/api/operator/official-web/runs?siteId=www_muc_edu_cn&status=completed&ingestionDispatchStatus=queued&limit=10",
      ),
    );

    expect(response.status).toBe(200);
    expect(service.listRuns).toHaveBeenCalledWith({
      filters: {
        cursor: null,
        ingestionDispatchStatus: "queued",
        limit: 10,
        siteId: "www_muc_edu_cn",
        startedAfter: null,
        startedBefore: null,
        status: "completed",
      },
      principal,
    });

    const anonymous = await createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(null),
      officialWebQueryService: service,
    }).fetch(new Request("https://app-api.internal/api/operator/official-web/runs"));
    expect(anonymous.status).toBe(401);

    const forbidden = await createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(createPublicPrincipal()),
      officialWebQueryService: service,
    }).fetch(new Request("https://app-api.internal/api/operator/official-web/runs"));
    expect(forbidden.status).toBe(403);
  });

  it("returns one crawl run detail projection", async () => {
    const principal = createOperatorPrincipal();
    const service: OfficialWebQueryService = {
      getRunById: vi.fn().mockResolvedValue({
        artifacts: [
          {
            artifactType: "crawl_run_manifest",
            contentSha256: "abc123",
            objectKey: "official_web/www_muc_edu_cn/runs/owrun_01HQ/crawl-run.json",
            recordCount: 1,
          },
        ],
        collectorVersion: "official-web-collector@0.1.0",
        configVersion: "git:abc1234",
        failureCount: 0,
        finishedAt: "2026-03-29T08:17:32.000Z",
        id: "owrun_01HQ",
        ingestionDispatchRef: null,
        ingestionDispatchStatus: "queued",
        lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
        projectedAt: "2026-03-29T08:17:33.000Z",
        runId: "owrun_01HQ",
        siteId: "www_muc_edu_cn",
        startedAt: "2026-03-29T08:00:01.000Z",
        status: "completed",
        summary: {
          failureCount: 0,
        },
      }),
      getSiteById: vi.fn(),
      listRuns: vi.fn(),
      listSites: vi.fn(),
    };
    const app = createApp(env, {
      getPrincipal: vi.fn().mockResolvedValue(principal),
      officialWebQueryService: service,
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/operator/official-web/runs/owrun_01HQ"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: expect.objectContaining({
        id: "owrun_01HQ",
        runId: "owrun_01HQ",
        siteId: "www_muc_edu_cn",
      }),
    });
  });
});
