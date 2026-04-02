// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import {
  AppApiRouteError,
  buildChatCommandService,
  DRAFT_CONVERSATION_TITLE,
  SupervisorTransportError,
  type ChatConversationStore,
  type ChatCommandStore,
} from "../src/modules/runtime-command";
import type { SupervisorExecutionClient } from "../src/modules/integration/supervisor";
import type { AppTelemetry } from "../src/modules/telemetry";

function createAuthorization() {
  return {
    applicabilityScope: "undergraduate",
    approvalState: "not_required",
    entitlementGroups: ["students"],
    entitlementSnapshotId: "entitlements-2026-03-29",
    ownershipScopes: ["conversation:user_01HQ"],
    principalId: "user_01HQ",
    projectionSource: "campus_identity" as const,
    retrievalFilter: {
      aclGroups: ["students"],
      campusScope: "main",
      entitlementGroups: ["students"],
      policyProjectionVersion: "phase1-authorization-projection-v1",
      visibilityLevel: "public",
      visibilityScope: "main",
    },
    visibilityScope: "main",
  };
}

function createPrincipal(): ResolvedAppPrincipal {
  return {
    principal: {
      type: "student",
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
    authorization: createAuthorization(),
    actor: {
      userId: "user_01HQ",
      principalId: "user_01HQ",
      principalType: "student",
      roles: ["student"],
      departments: [],
      groups: ["students"],
      campusScope: "main",
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
  const counters = new Map<string, number>();

  return (prefix: string) => {
    const nextValue = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, nextValue);
    return `${prefix}_${String(nextValue).padStart(4, "0")}`;
  };
}

function createConversationStore(input?: {
  conversation?: ReturnType<typeof createConversation>;
}) {
  const conversation = input?.conversation ?? createConversation();
  const store: ChatConversationStore = {
    createConversationDraft: vi.fn(),
    getConversationByOwner: vi.fn(async (ownerUserId: string, conversationId: string) => {
      if (ownerUserId !== conversation.ownerUserId || conversationId !== conversation.id) {
        return null;
      }

      return structuredClone(conversation);
    }),
    getConversationDetailByOwner: vi.fn(),
    listConversationSummariesByOwner: vi.fn(),
  };

  return {
    conversation,
    store,
  };
}

function createCommandStore() {
  const conversation = createConversation();
  const acceptedWrites: unknown[] = [];
  const finalWrites: unknown[] = [];
  const store: ChatCommandStore = {
    acceptRequest: vi.fn(async (input) => {
      acceptedWrites.push(input);
      if (input.conversationSeed) {
        conversation.id = input.conversationSeed.id;
        conversation.ownerUserId = input.conversationSeed.ownerUserId;
        conversation.createdAt = input.conversationSeed.createdAt;
      }
      conversation.title = input.conversationTitle;
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
  };

  return {
    acceptedWrites,
    conversation,
    finalWrites,
    store,
  };
}

function createTelemetryMock(): AppTelemetry {
  return {
    captureException: vi.fn(),
    configureChatRequestScope: vi.fn(),
    configureHttpRequestScope: vi.fn(),
    getTraceHeaders: vi.fn().mockReturnValue({
      baggage: "sentry-environment=test",
      sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
    }),
    markHttpResponseStatus: vi.fn(),
    recordProjectionDrain: vi.fn(),
    recordProjectionEnqueued: vi.fn(),
    recordRequestAccepted: vi.fn(),
    recordRequestFinalized: vi.fn(),
    recordRequestTransportError: vi.fn(),
  };
}

describe("chat command service", () => {
  it("accepts a chat request, calls supervisor with explicit actor, and finalizes a completed answer", async () => {
    const { store, acceptedWrites, finalWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const telemetry = createTelemetryMock();
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
        selectedTarget: "rag-specialist",
        status: "completed",
        traceId: "trace_0002",
      }),
    };

    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store,
      supervisor,
      telemetry,
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
      conversationId: "conv_01HQ",
      context: {
        actor: createPrincipal().actor,
        authorization: createPrincipal().authorization,
        profileMemory: {
          items: [],
        },
        session: {
          confirmedSlots: [],
          turnCount: 0,
        },
      },
      requestId: "req_0001",
      requestedCapability: "knowledge",
      requestedScope: {
        collection: "student_handbook",
        corpus: "regulations",
      },
      traceHeaders: {
        baggage: "sentry-environment=test",
        sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
      },
      traceId: "trace_0001",
      userGoal: "图书馆开放到几点？",
    });
    expect(telemetry.configureChatRequestScope).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req_0001",
        requestedCapability: "knowledge",
        traceId: "trace_0001",
      }),
    );
    expect(acceptedWrites).toHaveLength(1);
    expect(acceptedWrites[0]).toMatchObject({
      outboxEvent: {
        eventType: "request.accepted",
      },
      requestExecution: {
        applicabilityScope: "undergraduate",
        actorPrincipalId: "user_01HQ",
        actorUserId: "user_01HQ",
        entitlementGroups: ["students"],
        entitlementSnapshotId: "entitlements-2026-03-29",
        idempotencyKey: "idem-001",
        principalLabel: "Jane Doe",
        principalType: "student",
        questionPreview: "图书馆开放到几点？",
        requestId: "req_0001",
        status: "accepted",
        traceId: "trace_0001",
        visibilityScope: "main",
      },
    });
    expect(
      (acceptedWrites[0] as { requestExecution: Record<string, unknown> }).requestExecution,
    ).not.toHaveProperty("actorSnapshot");
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
        applicabilityScope: "undergraduate",
        actorPrincipalId: "user_01HQ",
        entitlementGroups: ["students"],
        entitlementSnapshotId: "entitlements-2026-03-29",
        requestId: "req_0001",
        selectedTarget: "rag-specialist",
        sourceDocIds: ["handbook:library-hours"],
        status: "completed",
        visibilityScope: "main",
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
    expect(telemetry.recordRequestAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_01HQ",
        requestId: "req_0001",
        traceId: "trace_0001",
      }),
    );
    expect(telemetry.recordProjectionEnqueued).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        projectionStage: "accepted",
        requestId: "req_0001",
      }),
    );
    expect(telemetry.recordProjectionEnqueued).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        projectionStage: "finalized",
        requestId: "req_0001",
      }),
    );
    expect(telemetry.recordRequestFinalized).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req_0001",
        selectedTarget: "rag-specialist",
        sourceDocIds: ["handbook:library-hours"],
        status: "completed",
      }),
    );
    expect(telemetry.recordRequestTransportError).not.toHaveBeenCalled();
  });

  it("maps clarification and no-answer statuses into chat-visible result kinds", async () => {
    const clarificationStore = createCommandStore();
    const noAnswerStore = createCommandStore();
    const clarificationConversationStore = createConversationStore();
    const noAnswerConversationStore = createConversationStore();
    const clarificationService = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore: clarificationConversationStore.store,
      store: clarificationStore.store,
      supervisor: {
        execute: vi
          .fn()
          .mockResolvedValue({
            answerText: "",
            error: null,
            followUpQuestion: "你要问哪个校区？",
            result: null,
            selectedTarget: "rag-specialist",
            status: "needs_clarification",
            traceId: "trace_0002",
          }),
      },
    });
    const noAnswerService = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore: noAnswerConversationStore.store,
      store: noAnswerStore.store,
      supervisor: {
        execute: vi.fn().mockResolvedValue({
          answerText: "当前没有足够依据回答这个问题。",
          error: null,
          followUpQuestion: "",
          result: null,
          selectedTarget: "rag-specialist",
          status: "no_answer",
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

  it("extracts summary diagnostics from rag results into runtime projection writes", async () => {
    const { store, finalWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store,
      supervisor: {
        execute: vi.fn().mockResolvedValue({
          answerText:
            "在《中央民族大学本科学生国家奖学金评审办法》中，当前未检索到足够依据支持回答这个问题；请确认是否有更具体的条款表述。",
          error: null,
          followUpQuestion: "",
          result: {
            diagnostics: {
              clarification_reason: "",
              no_answer_reason: "resolved_policy_clause_not_found",
              resolved_policy_document_id:
                "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
              resolved_policy_title: "中央民族大学本科学生国家奖学金评审办法",
              retrieved_title_summary: ["中央民族大学本科学生国家奖学金评审办法"],
              rewritten_query:
                "中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
            },
            evidence: {
              sources: [
                {
                  doc_id: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                },
              ],
            },
          },
          selectedTarget: "rag-specialist",
          status: "no_answer",
          traceId: "trace_0002",
        }),
      },
    });

    await service.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
      },
      principal: createPrincipal(),
    });

    expect(finalWrites[0]).toMatchObject({
      outboxEvent: {
        payload: {
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
        },
      },
      requestExecution: {
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
      },
    });
  });

  it("maps approval_required and rejected into chat-visible errors while preserving runtime statuses", async () => {
    const approvalStore = createCommandStore();
    const rejectedStore = createCommandStore();
    const approvalTelemetry = createTelemetryMock();
    const rejectedTelemetry = createTelemetryMock();
    const approvalService = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore: createConversationStore().store,
      store: approvalStore.store,
      supervisor: {
        execute: vi.fn().mockResolvedValue({
          answerText: "该请求涉及需要人工确认的操作，必须先经过审批。",
          error: null,
          followUpQuestion: "",
          result: null,
          selectedTarget: null,
          status: "approval_required",
          traceId: "trace_0002",
        }),
      },
      telemetry: approvalTelemetry,
    });
    const rejectedService = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore: createConversationStore().store,
      store: rejectedStore.store,
      supervisor: {
        execute: vi.fn().mockResolvedValue({
          answerText: "",
          error: {
            code: "request_rejected",
            message: "request was rejected by supervisor policy",
            retryable: false,
          },
          followUpQuestion: "",
          result: null,
          selectedTarget: null,
          status: "rejected",
          traceId: "trace_0002",
        }),
      },
      telemetry: rejectedTelemetry,
    });

    const approvalRequired = await approvalService.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "帮我提交奖学金申请",
      },
      principal: createPrincipal(),
    });
    const rejected = await rejectedService.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "直接替我发邮件给教务处",
      },
      principal: createPrincipal(),
    });

    expect(approvalRequired.answer.result).toEqual({
      errorCode: "approval_required",
      kind: "error",
      message: "该请求涉及需要人工确认的操作，必须先经过审批。",
      requestId: "req_0001",
      retryable: false,
      traceId: "trace_0002",
    });
    expect(approvalStore.finalWrites[0]).toMatchObject({
      outboxEvent: {
        eventType: "request.approval_required",
      },
      requestExecution: {
        selectedTarget: null,
        status: "approval_required",
      },
    });
    expect(approvalTelemetry.recordRequestFinalized).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req_0001",
        selectedTarget: null,
        status: "approval_required",
      }),
    );

    expect(rejected.answer.result).toEqual({
      errorCode: "request_rejected",
      kind: "error",
      message: "request was rejected by supervisor policy",
      requestId: "req_0001",
      retryable: false,
      traceId: "trace_0002",
    });
    expect(rejectedStore.finalWrites[0]).toMatchObject({
      outboxEvent: {
        eventType: "request.rejected",
      },
      requestExecution: {
        errorCode: "request_rejected",
        selectedTarget: null,
        status: "rejected",
      },
    });
    expect(rejectedTelemetry.recordRequestFinalized).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req_0001",
        selectedTarget: null,
        status: "rejected",
      }),
    );
  });

  it("finalizes a handled execution error when the supervisor transport fails after accept", async () => {
    const { store, finalWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const telemetry = createTelemetryMock();
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store,
      telemetry,
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
      traceId: "trace_0001",
    });
    expect(telemetry.recordRequestTransportError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "execution_timeout",
        requestId: "req_0001",
        retryable: true,
      }),
    );
    expect(telemetry.recordRequestFinalized).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req_0001",
        status: "error",
      }),
    );
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

    const { store } = createCommandStore();
    const { store: conversationStore } = createConversationStore({
      conversation: replayConversation,
    });
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
      conversationStore,
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
    const { store } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    conversationStore.getConversationByOwner = vi.fn().mockResolvedValue(null);
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
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

  it("creates a conversation lazily on the first chat request when conversationId is omitted", async () => {
    const { store, acceptedWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const supervisor: SupervisorExecutionClient = {
      execute: vi.fn().mockResolvedValue({
        answerText: "图书馆开放到 22:00。",
        error: null,
        followUpQuestion: "",
        result: {
          evidence: {
            sources: [],
          },
        },
        selectedTarget: "rag-specialist",
        status: "completed",
        traceId: "trace_0001",
      }),
    };
    const service = buildChatCommandService({
      computeFingerprint: (input) =>
        `fingerprint:${input.conversationDiscriminator}:${input.prompt}`,
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store,
      supervisor,
    });

    const response = await service.submit({
      idempotencyKey: "idem-001",
      payload: {
        prompt: "图书馆开放到几点？",
      },
      principal: createPrincipal(),
    });

    expect(conversationStore.getConversationByOwner).not.toHaveBeenCalled();
    expect(acceptedWrites[0]).toMatchObject({
      conversationSeed: {
        id: "conv_0001",
        ownerUserId: "user_01HQ",
        title: "图书馆开放到几点？",
      },
      requestExecution: {
        conversationId: "conv_0001",
      },
    });
    expect(store.findIdempotentRequest).toHaveBeenCalledWith({
      actorUserId: "user_01HQ",
      idempotencyKey: "idem-001",
    });
    expect(supervisor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_0001",
      }),
    );
    expect(response.answer.conversation).toMatchObject({
      id: "conv_0001",
      title: "图书馆开放到几点？",
    });
  });

  it("uses a stable new-conversation fingerprint scope for idempotent first-turn retries", async () => {
    const { store } = createCommandStore();
    store.findIdempotentRequest = vi.fn().mockResolvedValue({
      requestFingerprintSha256: "fingerprint:__new__:图书馆开放到几点？",
      response: {
        answer: {
          conversation: {
            createdAt: "2026-03-28T08:00:00.000Z",
            id: "conv_0001",
            messages: [],
            title: DRAFT_CONVERSATION_TITLE,
            updatedAt: "2026-03-28T08:00:00.000Z",
          },
          result: {
            kind: "answer",
            requestId: "req_prev",
            text: "图书馆开放到 22:00。",
            traceId: "trace_prev",
          },
        },
        requestId: "req_prev",
        traceId: "trace_prev",
      },
      status: "completed",
    });
    const service = buildChatCommandService({
      computeFingerprint: (input) =>
        `fingerprint:${input.conversationDiscriminator}:${input.prompt}`,
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore: createConversationStore().store,
      store,
      supervisor: {
        execute: vi.fn(),
      },
    });

    const response = await service.submit({
      idempotencyKey: "idem-001",
      payload: {
        prompt: "图书馆开放到几点？",
      },
      principal: createPrincipal(),
    });

    expect(response.requestId).toBe("req_prev");
    expect(store.acceptRequest).not.toHaveBeenCalled();
  });
});
