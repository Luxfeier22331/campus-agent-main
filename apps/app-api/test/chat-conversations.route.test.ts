// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { AppApiRouteError } from "../src/http";
import type {
  ChatConversationResponse,
  ChatConversationService,
  ChatConversationSummaryResponse,
} from "../src/modules/chat";

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

function createCampusPrincipal() {
  return {
    actor: {
      departments: [],
      principalId: "user_01HQ",
      principalType: "campus_member",
      roles: ["campus_member"],
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
      type: "campus_member" as const,
    },
    session: {
      expiresAt: "2026-03-29T07:00:00.000Z",
      sessionId: "sess_01HQ",
    },
  };
}

function createConversationService() {
  const conversations: ChatConversationSummaryResponse[] = [
    {
      createdAt: "2026-03-28T08:00:00.000Z",
      id: "conv_01HQ",
      title: "图书馆开放时间",
      updatedAt: "2026-03-28T08:01:00.000Z",
    },
  ];
  const conversation: ChatConversationResponse = {
    createdAt: "2026-03-28T08:00:00.000Z",
    id: "conv_01HQ",
    messages: [
      {
        conversationId: "conv_01HQ",
        createdAt: "2026-03-28T08:00:30.000Z",
        id: "msg_01HQ",
        kind: null,
        requestId: null,
        retryable: null,
        role: "user",
        text: "图书馆开放到几点？",
      },
    ],
    title: "图书馆开放时间",
    updatedAt: "2026-03-28T08:01:00.000Z",
  };

  const deleteTrailingMessages = vi.fn().mockResolvedValue({ deleted: true });
  const service: ChatConversationService & {
    deleteTrailingMessages: typeof deleteTrailingMessages;
  } = {
    createDraft: vi.fn().mockResolvedValue({ conversation }),
    deleteAll: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteById: vi.fn().mockResolvedValue({ deleted: true }),
    deleteTrailingMessages,
    getById: vi.fn().mockResolvedValue({ conversation }),
    listHistoryPage: vi.fn().mockResolvedValue({
      chats: [
        {
          createdAt: "2026-03-28T08:00:00.000Z",
          id: "conv_01HQ",
          title: "图书馆开放时间",
          updatedAt: "2026-03-28T08:01:00.000Z",
          visibility: "private",
        },
      ],
      hasMore: false,
    }),
    list: vi.fn().mockResolvedValue({ conversations }),
  };

  return {
    conversation,
    conversations,
    deleteTrailingMessages,
    service,
  };
}

describe("chat conversation routes", () => {
  it("lists current user conversations through the shared chat service", async () => {
    const { service, conversations } = createConversationService();
    const app = createApp(env, {
      chatConversationService: service,
      getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
    });

    const response = await app.fetch(new Request("https://app-api.internal/api/chat/conversations"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ conversations });
    expect(service.list).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        principal: expect.objectContaining({
          principalId: "user_01HQ",
        }),
      }),
    });
  });

  it("creates a draft conversation without requiring a separate request body contract", async () => {
    const { service, conversation } = createConversationService();
    const app = createApp(env, {
      chatConversationService: service,
      getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/chat/conversations", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ conversation });
    expect(service.createDraft).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        principal: expect.objectContaining({
          principalId: "user_01HQ",
        }),
      }),
    });
  });

  it("returns conversation detail for the current user", async () => {
    const { service, conversation } = createConversationService();
    const app = createApp(env, {
      chatConversationService: service,
      getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/chat/conversations/conv_01HQ"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ conversation });
    expect(service.getById).toHaveBeenCalledWith({
      conversationId: "conv_01HQ",
      principal: expect.objectContaining({
        principal: expect.objectContaining({
          principalId: "user_01HQ",
        }),
      }),
    });
  });

  it("serves vendor-compatible paginated history through /api/history", async () => {
    const { service } = createConversationService();
    const app = createApp(env, {
      chatConversationService: service,
      getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/history?limit=20"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      chats: [
        {
          createdAt: "2026-03-28T08:00:00.000Z",
          id: "conv_01HQ",
          title: "图书馆开放时间",
          updatedAt: "2026-03-28T08:01:00.000Z",
          visibility: "private",
        },
      ],
      hasMore: false,
    });
    expect(service.listHistoryPage).toHaveBeenCalledWith({
      endingBeforeConversationId: null,
      limit: 20,
      principal: expect.objectContaining({
        principal: expect.objectContaining({
          principalId: "user_01HQ",
        }),
      }),
    });
  });

  it("deletes a single chat through the vendor-compatible /api/chat?id= route", async () => {
    const { service } = createConversationService();
    const app = createApp(env, {
      chatConversationService: service,
      getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/chat?id=conv_01HQ", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(service.deleteById).toHaveBeenCalledWith({
      conversationId: "conv_01HQ",
      principal: expect.objectContaining({
        principal: expect.objectContaining({
          principalId: "user_01HQ",
        }),
      }),
    });
  });

  it("deletes all chats through the vendor-compatible /api/history route", async () => {
    const { service } = createConversationService();
    const app = createApp(env, {
      chatConversationService: service,
      getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/history", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deletedCount: 1 });
    expect(service.deleteAll).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        principal: expect.objectContaining({
          principalId: "user_01HQ",
        }),
      }),
    });
  });

  it("deletes trailing messages from an owned conversation through the chat edit route", async () => {
    const { service, deleteTrailingMessages } = createConversationService();
    const app = createApp(env, {
      chatConversationService: service,
      getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
    });

    const response = await app.fetch(
      new Request(
        "https://app-api.internal/api/chat/conversations/conv_01HQ/messages/msg_01HQ/trailing",
        {
          method: "DELETE",
        },
      ),
    );

    expect(response.status).toBe(204);
    expect(deleteTrailingMessages).toHaveBeenCalledWith({
      conversationId: "conv_01HQ",
      messageId: "msg_01HQ",
      principal: expect.objectContaining({
        principal: expect.objectContaining({
          principalId: "user_01HQ",
        }),
      }),
    });
  });

  it("fails closed when no session principal is available on chat conversation routes", async () => {
    const { service } = createConversationService();
    const app = createApp(env, {
      chatConversationService: service,
      getPrincipal: vi.fn().mockResolvedValue(null),
    });

    const response = await app.fetch(new Request("https://app-api.internal/api/chat/conversations"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "session_required",
        details: null,
        message: "Sign in required.",
        requestId: null,
        retryable: false,
        traceId: null,
      },
    });
  });

  it("maps chat service ownership errors onto the shared error envelope", async () => {
    const { service } = createConversationService();
    service.getById = vi.fn().mockRejectedValue(
      new AppApiRouteError({
        code: "conversation_not_found",
        message: "Conversation not found.",
        retryable: false,
        status: 404,
      }),
    );
    const app = createApp(env, {
      chatConversationService: service,
      getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/chat/conversations/conv_missing"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "conversation_not_found",
        details: null,
        message: "Conversation not found.",
        requestId: null,
        retryable: false,
        traceId: null,
      },
    });
  });
});
