import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedPanelDataProvider } from "../src/panel/data-provider";

function createJsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status: 200,
  });
}

describe("protected panel data provider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps request list filters onto the protected same-site runtime seam", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createJsonResponse({
        page: {
          nextCursor: "cursor_02",
        },
        requests: [
          {
            answerPreview: "图书馆开放到 22:00。",
            completedAt: "2026-03-28T08:00:01.000Z",
            conversationId: "conv_01HQ",
            durationMs: 812,
            errorCode: null,
            principalId: "user_01HQ",
            principalLabel: "Jane Doe",
            principalType: "public_user",
            projectedAt: "2026-03-28T08:00:02.000Z",
            questionPreview: "图书馆开放到几点？",
            requestId: "req_01HQ",
            requestedCapability: "knowledge",
            requestedScope: {
              collection: "student_handbook",
              corpus: "regulations",
            },
            selectedTarget: "rag-specialist",
            sourceDocIds: ["handbook:library-hours"],
            startedAt: "2026-03-28T08:00:00.000Z",
            status: "completed",
            surface: "public_chat_web",
            traceId: "trace_01HQ",
          },
        ],
      }),
    );

    const response = await protectedPanelDataProvider.getList("requests", {
      filter: {
        status: "completed",
        surface: "public_chat_web",
      },
      meta: undefined,
      pagination: {
        page: 1,
        perPage: 20,
      },
      signal: undefined,
      sort: {
        field: "startedAt",
        order: "DESC",
      },
    });

    expect(response.data[0]).toMatchObject({
      id: "req_01HQ",
      requestId: "req_01HQ",
      status: "completed",
    });
    expect(response.pageInfo).toEqual({
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/requests?limit=20&status=completed&surface=public_chat_web",
      expect.objectContaining({
        headers: {
          accept: "application/json",
        },
        method: "GET",
      }),
    );
  });

  it("uses the stored cursor for sequential next-page navigation only", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({
          page: {
            nextCursor: "cursor_02",
          },
          requests: [
            {
              answerPreview: "图书馆开放到 22:00。",
              completedAt: "2026-03-28T08:00:01.000Z",
              conversationId: "conv_01HQ",
              durationMs: 812,
              errorCode: null,
              principalId: "user_01HQ",
              principalLabel: "Jane Doe",
              principalType: "public_user",
              projectedAt: "2026-03-28T08:00:02.000Z",
              questionPreview: "图书馆开放到几点？",
              requestId: "req_01HQ",
              requestedCapability: "knowledge",
              requestedScope: null,
              selectedTarget: "rag-specialist",
              sourceDocIds: [],
              startedAt: "2026-03-28T08:00:00.000Z",
              status: "completed",
              surface: "public_chat_web",
              traceId: "trace_01HQ",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          page: {
            nextCursor: null,
          },
          requests: [
            {
              answerPreview: null,
              completedAt: null,
              conversationId: "conv_01HQ",
              durationMs: null,
              errorCode: null,
              principalId: "user_01HQ",
              principalLabel: "Jane Doe",
              principalType: "public_user",
              projectedAt: "2026-03-28T08:05:02.000Z",
              questionPreview: "宿舍门禁时间？",
              requestId: "req_02HQ",
              requestedCapability: "knowledge",
              requestedScope: null,
              selectedTarget: "rag-specialist",
              sourceDocIds: [],
              startedAt: "2026-03-28T08:05:00.000Z",
              status: "accepted",
              surface: "public_chat_web",
              traceId: "trace_02HQ",
            },
          ],
        }),
      );

    await protectedPanelDataProvider.getList("requests", {
      filter: {
        status: "completed",
      },
      meta: undefined,
      pagination: {
        page: 1,
        perPage: 20,
      },
      signal: undefined,
      sort: {
        field: "startedAt",
        order: "DESC",
      },
    });

    const secondPage = await protectedPanelDataProvider.getList("requests", {
      filter: {
        status: "completed",
      },
      meta: undefined,
      pagination: {
        page: 2,
        perPage: 20,
      },
      signal: undefined,
      sort: {
        field: "startedAt",
        order: "DESC",
      },
    });

    expect(secondPage.pageInfo).toEqual({
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/requests?limit=20&status=completed&cursor=cursor_02",
      expect.objectContaining({
        headers: {
          accept: "application/json",
        },
        method: "GET",
      }),
    );

    await expect(
      protectedPanelDataProvider.getList("requests", {
        filter: {
          status: "completed",
        },
        meta: undefined,
        pagination: {
          page: 3,
          perPage: 20,
        },
        signal: undefined,
        sort: {
          field: "startedAt",
          order: "DESC",
        },
      }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it("loads request detail and fails closed on unavailable cursor pages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createJsonResponse({
        request: {
          answerPreview: "图书馆开放到 22:00。",
          completedAt: "2026-03-28T08:00:01.000Z",
          conversationId: "conv_01HQ",
          diagnostics: {
            clarificationReason: null,
            noAnswerReason: "resolved_policy_clause_not_found",
            resolvedPolicyDocumentId:
              "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
            resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
            retrievedTitleSummary: ["中央民族大学本科学生国家奖学金评审办法"],
            rewrittenQuery:
              "中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
          },
          durationMs: 812,
          errorCode: null,
          principalId: "user_01HQ",
          principalLabel: "Jane Doe",
          principalType: "public_user",
          projectedAt: "2026-03-28T08:00:02.000Z",
          questionPreview: "图书馆开放到几点？",
          requestId: "req_01HQ",
          requestedCapability: "knowledge",
          requestedScope: null,
          selectedTarget: "rag-specialist",
          sourceDocIds: [],
          startedAt: "2026-03-28T08:00:00.000Z",
          status: "completed",
          surface: "public_chat_web",
          traceId: "trace_01HQ",
        },
      }),
    );

    await expect(
      protectedPanelDataProvider.getOne("requests", {
        id: "req_01HQ",
        meta: undefined,
        signal: undefined,
      }),
    ).resolves.toMatchObject({
      data: {
        diagnostics: {
          noAnswerReason: "resolved_policy_clause_not_found",
          resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
        },
        id: "req_01HQ",
      },
    });

    await expect(
      protectedPanelDataProvider.getList("requests", {
        filter: {},
        meta: undefined,
        pagination: {
          page: 2,
          perPage: 20,
        },
        signal: undefined,
        sort: {
          field: "startedAt",
          order: "DESC",
        },
      }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it("maps official web run filters onto the protected same-site runtime seam", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createJsonResponse({
        page: {
          nextCursor: "cursor_ow_02",
        },
        runs: [
          {
            artifacts: [],
            collectorVersion: "official-web-collector@0.1.0",
            configVersion: "git:abc1234",
            failureCount: 0,
            finishedAt: "2026-03-29T08:17:32.000Z",
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
    );

    const response = await protectedPanelDataProvider.getList("officialWebRuns", {
      filter: {
        ingestionDispatchStatus: "queued",
        siteId: "www_muc_edu_cn",
        status: "completed",
      },
      meta: undefined,
      pagination: {
        page: 1,
        perPage: 20,
      },
      signal: undefined,
      sort: {
        field: "startedAt",
        order: "DESC",
      },
    });

    expect(response.data[0]).toMatchObject({
      id: "owrun_01HQ",
      runId: "owrun_01HQ",
      status: "completed",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/official-web/runs?limit=20&siteId=www_muc_edu_cn&status=completed&ingestionDispatchStatus=queued",
      expect.objectContaining({
        headers: {
          accept: "application/json",
        },
        method: "GET",
      }),
    );
  });

  it("loads official web site detail and recent runs from the runtime seam", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createJsonResponse({
        recentRuns: [
          {
            artifacts: [],
            collectorVersion: "official-web-collector@0.1.0",
            configVersion: "git:abc1234",
            failureCount: 0,
            finishedAt: "2026-03-29T08:17:32.000Z",
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
    );

    await expect(
      protectedPanelDataProvider.getOne("officialWebSites", {
        id: "www_muc_edu_cn",
        meta: undefined,
        signal: undefined,
      }),
    ).resolves.toMatchObject({
      data: {
        id: "www_muc_edu_cn",
        recentRuns: [
          expect.objectContaining({
            id: "owrun_01HQ",
          }),
        ],
        siteId: "www_muc_edu_cn",
      },
    });
  });
});
