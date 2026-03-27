// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { Conversation } from "../app/lib/chat-types";
import {
  ConversationOwnershipError,
  UnauthorizedAppAccessError,
  loadChatConversationPageData,
  loadChatIndexPageData,
} from "../app/lib/chat-boundary.server";

const exampleConversation: Conversation = {
  id: "conv-1",
  ownerUserId: "user-1",
  title: "Library hours",
  createdAt: "2026-03-26T00:00:00.000Z",
  updatedAt: "2026-03-26T00:00:00.000Z",
  messages: [],
};

describe("chat boundary server helpers", () => {
  it("loads chat index data for the authenticated app user", async () => {
    const repository = {
      listByOwner: vi.fn().mockResolvedValue([exampleConversation]),
      getByOwner: vi.fn(),
    };

    const data = await loadChatIndexPageData({
      getUser: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "student@example.com",
        name: "Student",
      }),
      repository,
      request: new Request("http://example.com/chat"),
    });

    expect(repository.listByOwner).toHaveBeenCalledWith("user-1");
    expect(data.user.id).toBe("user-1");
    expect(data.conversations).toEqual([exampleConversation]);
  });

  it("rejects chat index access when no app session exists", async () => {
    await expect(
      loadChatIndexPageData({
        getUser: vi.fn().mockResolvedValue(null),
        repository: {
          listByOwner: vi.fn(),
          getByOwner: vi.fn(),
        },
        request: new Request("http://example.com/chat"),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedAppAccessError);
  });

  it("loads conversation detail with ownership-scoped history", async () => {
    const repository = {
      listByOwner: vi.fn().mockResolvedValue([exampleConversation]),
      getByOwner: vi.fn().mockResolvedValue(exampleConversation),
    };

    const data = await loadChatConversationPageData({
      conversationId: "conv-1",
      getUser: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "student@example.com",
        name: "Student",
      }),
      repository,
      request: new Request("http://example.com/chat/conv-1"),
    });

    expect(repository.getByOwner).toHaveBeenCalledWith("user-1", "conv-1");
    expect(data.conversation.id).toBe("conv-1");
    expect(data.conversations).toEqual([exampleConversation]);
  });

  it("treats a missing owned conversation as an ownership failure", async () => {
    await expect(
      loadChatConversationPageData({
        conversationId: "conv-404",
        getUser: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "student@example.com",
          name: "Student",
        }),
        repository: {
          listByOwner: vi.fn().mockResolvedValue([]),
          getByOwner: vi.fn().mockResolvedValue(null),
        },
        request: new Request("http://example.com/chat/conv-404"),
      }),
    ).rejects.toBeInstanceOf(ConversationOwnershipError);
  });
});
