import type { ChatMessage, Conversation } from "../app/lib/chat-types";
import {
  formatChatMessageRole,
  getConversationPreview,
  groupConversationsByRecency,
  getRetryPromptForMessage,
  upsertConversationHistory,
} from "../app/lib/chat-ui";

const baseConversation = (overrides?: Partial<Conversation>): Conversation => ({
  id: "conv-1",
  ownerUserId: "user-1",
  title: "Library hours",
  createdAt: "2026-03-26T00:00:00.000Z",
  updatedAt: "2026-03-26T00:00:00.000Z",
  messages: [],
  ...overrides,
});

const baseMessage = (overrides?: Partial<ChatMessage>): ChatMessage => ({
  id: "msg-1",
  conversationId: "conv-1",
  role: "assistant",
  text: "Need more detail.",
  createdAt: "2026-03-26T00:00:00.000Z",
  ...overrides,
});

describe("chat ui helpers", () => {
  it("moves the updated conversation to the front of history", () => {
    const older = baseConversation({ id: "conv-older" });
    const latest = baseConversation({ id: "conv-latest" });

    expect(upsertConversationHistory([older, latest], latest).map((item) => item.id)).toEqual([
      "conv-latest",
      "conv-older",
    ]);
  });

  it("formats assistant clarification and error states as first-class thread roles", () => {
    expect(formatChatMessageRole(baseMessage({ kind: "clarification" }))).toBe(
      "assistant · clarification",
    );
    expect(formatChatMessageRole(baseMessage({ kind: "error" }))).toBe("assistant · error");
    expect(formatChatMessageRole(baseMessage({ role: "user", kind: undefined }))).toBe("user");
  });

  it("finds the previous user prompt for retryable error messages", () => {
    const messages: ChatMessage[] = [
      baseMessage({
        id: "msg-user",
        role: "user",
        text: "图书馆开放到几点？",
      }),
      baseMessage({
        id: "msg-error",
        kind: "error",
        retryable: true,
        requestId: "req-1",
        text: "The public answer path is unavailable right now.",
      }),
    ];

    expect(getRetryPromptForMessage(messages, "msg-error")).toBe("图书馆开放到几点？");
    expect(
      getRetryPromptForMessage(
        [
          messages[0],
          {
            ...messages[1],
            id: "msg-not-retryable",
            retryable: false,
          },
        ],
        "msg-not-retryable",
      ),
    ).toBeNull();
  });

  it("groups conversation history by recency labels used by the sidebar", () => {
    const referenceNow = new Date("2026-03-26T12:00:00.000Z");
    const conversations = [
      baseConversation({
        id: "today",
        updatedAt: "2026-03-26T07:00:00.000Z",
      }),
      baseConversation({
        id: "yesterday",
        updatedAt: "2026-03-25T07:00:00.000Z",
      }),
      baseConversation({
        id: "last-week",
        updatedAt: "2026-03-22T07:00:00.000Z",
      }),
      baseConversation({
        id: "older",
        updatedAt: "2026-02-18T07:00:00.000Z",
      }),
    ];

    expect(groupConversationsByRecency(conversations, referenceNow)).toEqual([
      {
        label: "Today",
        conversations: [conversations[0]],
      },
      {
        label: "Yesterday",
        conversations: [conversations[1]],
      },
      {
        label: "Previous 7 days",
        conversations: [conversations[2]],
      },
      {
        label: "Older",
        conversations: [conversations[3]],
      },
    ]);
  });

  it("builds sidebar preview text from the latest message when present", () => {
    expect(
      getConversationPreview(
        baseConversation({
          title: "Need help with course registration",
          messages: [
            baseMessage({
              id: "msg-user",
              role: "user",
              text: "How do I drop a class after the deadline?",
            }),
            baseMessage({
              id: "msg-answer",
              kind: "answer",
              text: "Contact your academic advisor and submit a late add/drop request.",
            }),
          ],
        }),
      ),
    ).toBe("Contact your academic advisor and submit a late add/drop request.");

    expect(getConversationPreview(baseConversation())).toBe("Library hours");
  });
});
