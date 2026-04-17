import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteTrailingMessages,
  UnauthorizedError,
  createDraftConversation,
  getConversationDetail,
  getSessionPrincipal,
  listConversations,
  submitChatRequest,
} from "../src/platform/chat/api";

describe("public chat app-api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits a first-turn request without conversationId and returns the canonical conversation", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            answer: {
              conversation: {
                createdAt: "2026-03-28T08:00:00.000Z",
                id: "conv_01HQ",
                messages: [],
                title: "图书馆开放时间",
                updatedAt: "2026-03-28T08:00:01.000Z",
              },
              result: {
                kind: "answer",
                requestId: "req_01HQ",
                text: "图书馆开放到 22:00。",
                traceId: "trace_01HQ",
              },
            },
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        ),
      );

    const result = await submitChatRequest({
      prompt: "图书馆开放到几点？",
    });

    expect(result.conversation.id).toBe("conv_01HQ");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/chat/requests",
      expect.objectContaining({
        body: JSON.stringify({
          prompt: "图书馆开放到几点？",
        }),
        headers: expect.objectContaining({
          "content-type": "application/json",
          "idempotency-key": expect.any(String),
        }),
        method: "POST",
      }),
    );
  });

  it("maps chat app-api routes and unauthorized responses consistently", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            principal: {
              displayName: "Jane Doe",
              email: "jane@example.edu",
              principalId: "user_01HQ",
              type: "campus_member",
            },
            permissions: {
              chat: true,
              operator: false,
            },
            session: {
              expiresAt: "2026-03-29T07:00:00.000Z",
              sessionId: "sess_01HQ",
            },
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversations: [
              {
                createdAt: "2026-03-28T08:00:00.000Z",
                id: "conv_01HQ",
                messages: [],
                title: "图书馆开放时间",
                updatedAt: "2026-03-28T08:01:00.000Z",
              },
            ],
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-03-28T08:00:00.000Z",
              id: "conv_02HQ",
              messages: [],
              title: "New conversation",
              updatedAt: "2026-03-28T08:00:00.000Z",
            },
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 201,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-03-28T08:00:00.000Z",
              id: "conv_01HQ",
              messages: [],
              title: "图书馆开放时间",
              updatedAt: "2026-03-28T08:01:00.000Z",
            },
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "session_required",
              message: "Sign in required.",
            },
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 401,
          },
        ),
      );

    await expect(getSessionPrincipal()).resolves.toMatchObject({
      principal: {
        principalId: "user_01HQ",
      },
    });
    await expect(listConversations()).resolves.toHaveLength(1);
    await expect(createDraftConversation()).resolves.toMatchObject({
      id: "conv_02HQ",
      title: "New conversation",
    });
    await expect(getConversationDetail("conv_01HQ")).resolves.toMatchObject({
      id: "conv_01HQ",
    });
    await expect(getConversationDetail("conv_missing")).rejects.toBeInstanceOf(UnauthorizedError);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/me",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/chat/conversations",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/chat/conversations",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "/api/chat/conversations/conv_01HQ",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("deletes trailing messages from a conversation through the shared app-api route", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    await expect(deleteTrailingMessages("conv_01HQ", "msg_01HQ")).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/chat/conversations/conv_01HQ/messages/msg_01HQ/trailing",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });
});
