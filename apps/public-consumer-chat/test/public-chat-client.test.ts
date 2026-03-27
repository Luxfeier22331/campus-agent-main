import type { Conversation } from "../app/lib/chat-types";
import {
  deleteAllConversationsClient,
  deleteConversationClient,
  UnauthorizedError,
  startConversationClient,
} from "../app/lib/public-chat-client";

const baseConversation = (overrides?: Partial<Conversation>): Conversation => ({
  id: "conv-1",
  ownerUserId: "user-1",
  title: "New conversation",
  createdAt: "2026-03-26T00:00:00.000Z",
  updatedAt: "2026-03-26T00:00:00.000Z",
  messages: [],
  ...overrides,
});

describe("public chat client", () => {
  it("creates a conversation and answers the first prompt for /chat", async () => {
    const createdConversation = baseConversation();
    const answeredConversation = baseConversation({
      title: "图书馆开放到几点？",
      messages: [
        {
          id: "msg-user",
          conversationId: "conv-1",
          role: "user",
          text: "图书馆开放到几点？",
          createdAt: "2026-03-26T00:00:01.000Z",
        },
        {
          id: "msg-assistant",
          conversationId: "conv-1",
          role: "assistant",
          kind: "answer",
          text: "图书馆开放到晚上十点。",
          requestId: "req-1",
          createdAt: "2026-03-26T00:00:02.000Z",
        },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ conversation: createdConversation }), {
            status: 201,
            headers: {
              "content-type": "application/json",
            },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              answer: {
                conversation: answeredConversation,
                result: {
                  kind: "answer",
                  text: "图书馆开放到晚上十点。",
                  request_id: "req-1",
                },
              },
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            },
          ),
        ),
    );

    const result = await startConversationClient({
      prompt: "图书馆开放到几点？",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/conversations",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/answer",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          conversationId: "conv-1",
          prompt: "图书馆开放到几点？",
        }),
      }),
    );
    expect(result.conversation).toEqual(answeredConversation);
    expect(result.result).toEqual({
      kind: "answer",
      text: "图书馆开放到晚上十点。",
      requestId: "req-1",
    });
  });

  it("surfaces unauthorized failures from the first /chat step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    );

    await expect(
      startConversationClient({
        prompt: "图书馆开放到几点？",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("deletes a single owned conversation through the same-site app seam", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    );

    await deleteConversationClient("conv-1");

    expect(fetch).toHaveBeenCalledWith(
      "/api/conversations/conv-1",
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
      }),
    );
  });

  it("deletes all owned conversations through the same-site app seam", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    );

    await deleteAllConversationsClient();

    expect(fetch).toHaveBeenCalledWith(
      "/api/conversations",
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
      }),
    );
  });
});
