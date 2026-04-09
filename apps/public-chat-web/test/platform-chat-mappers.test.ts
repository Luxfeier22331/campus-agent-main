import { describe, expect, it } from "vitest";

import {
  mapChatAnswerPayload,
  mapConversationDetail,
  mapSessionPrincipal,
} from "../src/platform/chat/mappers";

describe("platform chat mappers", () => {
  it("maps the app-api-backed session principal into shell session shape", () => {
    expect(
      mapSessionPrincipal({
        permissions: {
          chat: true,
          operator: false,
        },
        principal: {
          displayName: "Test Student",
          email: "student@example.edu",
          principalId: "user_123",
          type: "student",
        },
        session: {
          expiresAt: "2026-04-07T00:00:00.000Z",
          sessionId: "sess_123",
        },
      }),
    ).toEqual({
      canChat: true,
      displayName: "Test Student",
      email: "student@example.edu",
      principalId: "user_123",
      principalType: "student",
    });
  });

  it("maps conversation detail and preserves user messages as shell user kind", () => {
    expect(
      mapConversationDetail({
        createdAt: "2026-04-06T09:10:00.000Z",
        id: "conv_123",
        messages: [
          {
            conversationId: "conv_123",
            createdAt: "2026-04-06T09:10:00.000Z",
            id: "msg_user",
            kind: null,
            requestId: null,
            retryable: null,
            role: "user",
            text: "法学民族班培养方案里大二下有什么课？",
          },
          {
            conversationId: "conv_123",
            createdAt: "2026-04-06T09:10:02.000Z",
            id: "msg_assistant",
            kind: "clarification",
            requestId: "req_123",
            retryable: false,
            role: "assistant",
            text: "请补充具体专业或培养方案名称。",
          },
        ],
        title: "民族班课程",
        updatedAt: "2026-04-06T09:10:02.000Z",
      }),
    ).toEqual({
      createdAt: "2026-04-06T09:10:00.000Z",
      id: "conv_123",
      messages: [
        {
          createdAt: "2026-04-06T09:10:00.000Z",
          id: "msg_user",
          kind: "user",
          requestId: null,
          retryable: false,
          role: "user",
          text: "法学民族班培养方案里大二下有什么课？",
        },
        {
          createdAt: "2026-04-06T09:10:02.000Z",
          id: "msg_assistant",
          kind: "clarification",
          requestId: "req_123",
          retryable: false,
          role: "assistant",
          text: "请补充具体专业或培养方案名称。",
        },
      ],
      title: "民族班课程",
      updatedAt: "2026-04-06T09:10:02.000Z",
    });
  });

  it("maps chat request outcomes into shell request outcome shape", () => {
    expect(
      mapChatAnswerPayload({
        conversation: {
          createdAt: "2026-04-06T09:10:00.000Z",
          id: "conv_123",
          messages: [],
          title: "民族班课程",
          updatedAt: "2026-04-06T09:10:02.000Z",
        },
        result: {
          kind: "answer",
          requestId: "req_456",
          text: "第四学期课程如下。",
          traceId: "trace_456",
        },
      }),
    ).toEqual({
      conversation: {
        createdAt: "2026-04-06T09:10:00.000Z",
        id: "conv_123",
        messages: [],
        title: "民族班课程",
        updatedAt: "2026-04-06T09:10:02.000Z",
      },
      requestId: "req_456",
      resultKind: "answer",
      traceId: "trace_456",
    });
  });
});
