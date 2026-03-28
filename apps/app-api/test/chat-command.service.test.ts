// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import {
  AppApiRouteError,
  buildChatCommandService,
  SupervisorTransportError,
  type ChatCommandStore,
} from "../src/modules/runtime-command";
import type { SupervisorExecutionClient } from "../src/modules/integration/supervisor";

function createPrincipal(): ResolvedAppPrincipal {
  return {
    principal: {
      type: "public_user",
      principalId: "user_01HQ",
      displayName: "Jane Doe",
      email: "jane@example.edu",
    },
    session: {
      sessionId: "sess_01HQ",
      expiresAt: "2026-03-29T07:00:00.000Z",
    },
    permissions: {
      chat: true,
      operator: false,
    },
    actor: {
      userId: "user_01HQ",
      roles: ["student"],
      departments: [],
      groups: ["students"],
      campusScope: "main",
      snapshot: {
        principal_type: "public_user",
      },
    },
  };
}

function createConversation() {
  return {
    id: "conv_01HQ",
    ownerUserId: "user_01HQ",
    title: "图书馆开放时间",
    createdAt: "2026-03-28T07:59:00.000Z",
    updatedAt: "2026-03-28T07:59:00.000Z",
    messages: [] as Array<{
      id: string;
      conversationId: string;
      role: "user" | "assistant";
      kind: "answer" | "clarification" | "no_answer" | "error" | null;
      text: string;
      createdAt: string;
      requestId: string | null;
      retryable: boolean | null;
    }>,
  };
}

function createDeterministicIdGenerator() {
  let counter = 0;

  return (prefix: string) => {
    counter += 1;
    return `${prefix}_${String(counter).padStart(4, "0")}`;
  };
}

function createStore() {
  const conversation = createConversation();
  const acceptedWrites: unknown[] = [];
  const finalWrites: unknown[] = [];
  const store: ChatCommandStore = {
    acceptRequest: vi.fn(async (input) => {
      acceptedWrites.push(input);
      conversation.updatedAt = input.userMessage.createdAt;
      conversation.messages.push({
        ...input.userMessage,
        kind: null,
        requestId: null,
        retryable: null,
      });
    }),
    finalizeRequest: vi.fn(async (input) => {
      finalWrites.push(input);
      conversation.updatedAt = input.assistantMessage.createdAt;
      conversation.messages.push(input.assistantMessage);
      return structuredClone(conversation);
    }),
    findIdempotentRequest: vi.fn(async () => null),
    getConversationByOwner: vi.fn(async (ownerUserId: string, conversationId: string) => {
      if (ownerUserId !== conversation.ownerUserId || conversationId !== conversation.id) {
        return null;
      }

      return structuredClone(conversation);
    }),
  };

  return {
    acceptedWrites,
    conversation,
    finalWrites,
    store,
  };
}

describe("chat command service", () => {
  it("accepts a chat request, calls supervisor with explicit actor, and finalizes a completed answer", async () => {
    const { store, acceptedWrites, finalWrites } = createStore();
    const supervisor: SupervisorExecutionClient = {
      execute: vi.fn().mockResolvedValue({
        answerText: "图书馆开放到 22:00。",
        error: null,
        followUpQuestion: "",
        result: {
          evidence: {
            sources: [{ doc_id: "handbook:library-hours" }],
          },
        },
        status: "completed",
        target: "rag-specialist",
        traceId: "trace_0002",
      }),
    };

    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      store,
      supervisor,
    });

    const response = await service.submit({
      idempotencyKey: "idem-001",
      payload: {
        conversationId: "conv_01HQ",
        prompt: " 图书馆开放到几点？ ",
        requestedCapability: "knowledge",
        requestedScope: {
          collection: "student_handbook",
          corpus: "regulations",
        },
      },
      principal: createPrincipal(),
    });

    expect(supervisor.execute).toHaveBeenCalledWith({
      actor: createPrincipal().actor,
      conversationId: "conv_01HQ",
      requestId: "req_0001",
      requestedCapability: "knowledge",
      requestedScope: {
        collection: "student_handbook",
        corpus: "regulations",
      },
      traceId: "trace_0002",
      userGoal: "图书馆开放到几点？",
    });
    expect(acceptedWrites).toHaveLength(1);
    expect(acceptedWrites[0]).toMatchObject({
      outboxEvent: {
        eventType: "request.accepted",
      },
      requestExecution: {
        actorUserId: "user_01HQ",
        idempotencyKey: "idem-001",
        questionPreview: "图书馆开放到几点？",
        requestId: "req_0001",
        status: "accepted",
        traceId: "trace_0002",
      },
    });
    expect(finalWrites).toHaveLength(1);
    expect(finalWrites[0]).toMatchObject({
      assistantMessage: {
        kind: "answer",
        requestId: "req_0001",
        role: "assistant",
        text: "图书馆开放到 22:00。",
      },
      outboxEvent: {
        eventType: "request.completed",
      },
      requestExecution: {
        answerPreview: "图书馆开放到 22:00。",
        requestId: "req_0001",
        selectedTarget: "rag-specialist",
        sourceDocIds: ["handbook:library-hours"],
        status: "completed",
      },
    });
    expect(response).toMatchObject({
      answer: {
        conversation: {
          id: "conv_01HQ",
          messages: [
            {
              role: "user",
              text: "图书馆开放到几点？",
            },
            {
              kind: "answer",
              role: "assistant",
              text: "图书馆开放到 22:00。",
            },
          ],
        },
        result: {
          kind: "answer",
          requestId: "req_0001",
          text: "图书馆开放到 22:00。",
          traceId: "trace_0002",
        },
      },
      requestId: "req_0001",
      traceId: "trace_0002",
    });
  });

  it("maps clarification and no-answer statuses into chat-visible result kinds", async () => {
    const clarificationStore = createStore();
    const noAnswerStore = createStore();
    const clarificationService = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      store: clarificationStore.store,
      supervisor: {
        execute: vi
          .fn()
          .mockResolvedValue({
            answerText: "",
            error: null,
            followUpQuestion: "你要问哪个校区？",
            result: null,
            status: "needs_clarification",
            target: "rag-specialist",
            traceId: "trace_0002",
          }),
      },
    });
    const noAnswerService = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      store: noAnswerStore.store,
      supervisor: {
        execute: vi.fn().mockResolvedValue({
          answerText: "当前没有足够依据回答这个问题。",
          error: null,
          followUpQuestion: "",
          result: null,
          status: "no_answer",
          target: "rag-specialist",
          traceId: "trace_0002",
        }),
      },
    });

    const clarification = await clarificationService.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "开放时间？",
      },
      principal: createPrincipal(),
    });
    const noAnswer = await noAnswerService.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "这个规定适用于所有学院吗？",
      },
      principal: createPrincipal(),
    });

    expect(clarification.answer.result).toEqual({
      kind: "clarification",
      requestId: "req_0001",
      text: "你要问哪个校区？",
      traceId: "trace_0002",
    });
    expect(clarificationStore.finalWrites[0]).toMatchObject({
      outboxEvent: {
        eventType: "request.needs_clarification",
      },
      requestExecution: {
        status: "needs_clarification",
      },
    });
    expect(noAnswer.answer.result).toEqual({
      kind: "no_answer",
      requestId: "req_0001",
      text: "当前没有足够依据回答这个问题。",
      traceId: "trace_0002",
    });
    expect(noAnswerStore.finalWrites[0]).toMatchObject({
      outboxEvent: {
        eventType: "request.no_answer",
      },
      requestExecution: {
        status: "no_answer",
      },
    });
  });

  it("finalizes a handled execution error when the supervisor transport fails after accept", async () => {
    const { store, finalWrites } = createStore();
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      store,
      supervisor: {
        execute: vi.fn().mockRejectedValue(
          new SupervisorTransportError({
            code: "execution_timeout",
            message: "Supervisor execution timed out.",
            retryable: true,
            status: 504,
          }),
        ),
      },
    });

    const response = await service.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "图书馆开放到几点？",
      },
      principal: createPrincipal(),
    });

    expect(finalWrites[0]).toMatchObject({
      assistantMessage: {
        kind: "error",
        retryable: true,
        text: "Supervisor execution timed out.",
      },
      outboxEvent: {
        eventType: "request.error",
      },
      requestExecution: {
        errorCode: "execution_timeout",
        status: "error",
      },
    });
    expect(response.answer.result).toEqual({
      errorCode: "execution_timeout",
      kind: "error",
      message: "Supervisor execution timed out.",
      requestId: "req_0001",
      retryable: true,
      traceId: "trace_0002",
    });
  });

  it("replays a completed idempotent request and blocks conflicts or in-flight duplicates", async () => {
    const replayConversation = createConversation();
    replayConversation.messages.push(
      {
        conversationId: "conv_01HQ",
        createdAt: "2026-03-28T08:00:00.000Z",
        id: "msg_user",
        kind: null,
        requestId: null,
        retryable: null,
        role: "user",
        text: "图书馆开放到几点？",
      },
      {
        conversationId: "conv_01HQ",
        createdAt: "2026-03-28T08:00:01.000Z",
        id: "msg_answer",
        kind: "answer",
        requestId: "req_prev",
        retryable: null,
        role: "assistant",
        text: "图书馆开放到 22:00。",
      },
    );

    const replayResponse = {
      answer: {
        conversation: replayConversation,
        result: {
          kind: "answer" as const,
          requestId: "req_prev",
          text: "图书馆开放到 22:00。",
          traceId: "trace_prev",
        },
      },
      requestId: "req_prev",
      traceId: "trace_prev",
    };

    const { store } = createStore();
    const findIdempotentRequest = vi
      .fn()
      .mockResolvedValueOnce({
        requestFingerprintSha256: "fingerprint:图书馆开放到几点？",
        response: replayResponse,
        status: "completed",
      })
      .mockResolvedValueOnce({
        requestFingerprintSha256: "fingerprint:图书馆开放到几点？",
        response: replayResponse,
        status: "accepted",
      })
      .mockResolvedValueOnce({
        requestFingerprintSha256: "fingerprint:other",
        response: replayResponse,
        status: "completed",
      });
    store.findIdempotentRequest = findIdempotentRequest;
    const supervisor = {
      execute: vi.fn(),
    } satisfies SupervisorExecutionClient;

    const service = buildChatCommandService({
      computeFingerprint: () => "fingerprint:图书馆开放到几点？",
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      store,
      supervisor,
    });

    const replay = await service.submit({
      idempotencyKey: "idem-001",
      payload: {
        conversationId: "conv_01HQ",
        prompt: "图书馆开放到几点？",
      },
      principal: createPrincipal(),
    });

    expect(replay).toEqual(replayResponse);
    expect(supervisor.execute).not.toHaveBeenCalled();

    await expect(
      service.submit({
        idempotencyKey: "idem-001",
        payload: {
          conversationId: "conv_01HQ",
          prompt: "图书馆开放到几点？",
        },
        principal: createPrincipal(),
      }),
    ).rejects.toMatchObject({
      code: "request_in_progress",
      status: 409,
    });

    await expect(
      service.submit({
        idempotencyKey: "idem-001",
        payload: {
          conversationId: "conv_01HQ",
          prompt: "图书馆开放到几点？",
        },
        principal: createPrincipal(),
      }),
    ).rejects.toMatchObject({
      code: "idempotency_conflict",
      status: 409,
    });
  });

  it("fails closed before accept when the conversation does not belong to the caller", async () => {
    const { store } = createStore();
    store.getConversationByOwner = vi.fn().mockResolvedValue(null);
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      store,
      supervisor: {
        execute: vi.fn(),
      },
    });

    await expect(
      service.submit({
        payload: {
          conversationId: "conv_missing",
          prompt: "图书馆开放到几点？",
        },
        principal: createPrincipal(),
      }),
    ).rejects.toMatchObject({
      code: "conversation_not_found",
      status: 404,
    });
    expect(store.acceptRequest).not.toHaveBeenCalled();
  });
});
