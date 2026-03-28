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
});
