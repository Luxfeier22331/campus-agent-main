// @vitest-environment node

import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { ChatMessage } from "../src/modules/chat";
import {
  AppApiRouteError,
  buildChatCommandService,
  DRAFT_CONVERSATION_TITLE,
  SupervisorTransportError,
  deriveSafetyIdentifier,
  type ChatConversationStore,
  type ChatCommandStore,
  type FinalizeRequestWrite,
} from "../src/modules/runtime-command";
import type { SupervisorExecutionClient } from "../src/modules/integration/supervisor";
import type { AppTelemetry } from "../src/modules/telemetry";

const CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family";
const CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program";
const CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester";

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
    sessionSlots: [] as Array<{
      confirmed: boolean;
      name: string;
      updatedAt: string;
      value: string;
    }>,
    messages: [] as ChatMessage[],
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
    deleteConversationByOwner: vi.fn(),
    deleteConversationsByOwner: vi.fn(),
    deleteTrailingMessagesFromMessageByOwner: vi.fn(),
    getConversationByOwner: vi.fn(async (ownerUserId: string, conversationId: string) => {
      if (ownerUserId !== conversation.ownerUserId || conversationId !== conversation.id) {
        return null;
      }

      return structuredClone(conversation);
    }),
    getConversationDetailByOwner: vi.fn(),
    listConversationSummariesPageByOwner: vi.fn(),
    listConversationSummariesByOwner: vi.fn(),
  };

  return {
    conversation,
    store,
  };
}

function createCommandStore(input?: {
  conversation?: ReturnType<typeof createConversation>;
}) {
  const conversation = input?.conversation ?? createConversation();
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
        structuredParts: [],
      });
    }),
    finalizeRequest: vi.fn(async (input: FinalizeRequestWrite) => {
      finalWrites.push(input);
      conversation.updatedAt = input.assistantMessage.createdAt;
      if (input.sessionSlots) {
        const nextSlots = input.sessionSlots.map((slot: FinalizeRequestWrite["sessionSlots"][number]) => ({
          ...slot,
        }));
        conversation.sessionSlots = nextSlots;
      }
      conversation.messages.push(input.assistantMessage);
      return structuredClone(conversation);
    }),
    findIdempotentRequest: vi.fn(async () => null),
    getAbuseControlState: vi.fn(async () => ({
      activeThrottleUntil: null,
      requestCountLastMinute: 0,
      requestCountLastTenMinutes: 0,
      shouldThrottle: false,
      throttleReason: null,
    })),
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
    recordQualitySampledGrade: vi.fn(),
    recordRequestAccepted: vi.fn(),
    recordRequestFinalized: vi.fn(),
    recordRequestTransportError: vi.fn(),
  };
}

describe("chat command service", () => {
  it("derives safety identifier from principal first, then app-owned session id, else null", () => {
    const principal = createPrincipal();
    const secret = "phase-h-safety-secret";

    expect(deriveSafetyIdentifier(principal, secret)).toBe(
      createHmac("sha256", secret).update("principal:user_01HQ").digest("hex"),
    );

    expect(
      deriveSafetyIdentifier(
        {
          ...principal,
          principal: {
            ...principal.principal,
            principalId: "",
          },
        },
        secret,
      ),
    ).toBe(createHmac("sha256", secret).update("session:sess_01HQ").digest("hex"));

    expect(
      deriveSafetyIdentifier(
        {
          ...principal,
          principal: {
            ...principal.principal,
            principalId: "",
          },
          session: null,
        },
        secret,
      ),
    ).toBeNull();
  });

  it("accepts a chat request, calls supervisor with explicit actor, and finalizes a completed answer", async () => {
    const { store, acceptedWrites, finalWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const telemetry = createTelemetryMock();
    const safetySecret = "phase-h-safety-secret";
    const expectedSafetyIdentifier = createHmac("sha256", safetySecret)
      .update("principal:user_01HQ")
      .digest("hex");
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
      deriveSafetyIdentifier: (principal) => deriveSafetyIdentifier(principal, safetySecret),
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
      surface: "public_chat_web",
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
      safetyIdentifier: expectedSafetyIdentifier,
      surface: "public_chat_web",
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
        safetyIdentifier: expectedSafetyIdentifier,
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
        safetyIdentifier: expectedSafetyIdentifier,
        status: "accepted",
        traceId: "trace_0001",
        visibilityScope: "main",
      },
      requestObservabilityFact: {
        requestId: "req_0001",
        safetyIdentifier: expectedSafetyIdentifier,
      },
    });
    expect(
      (acceptedWrites[0] as { requestExecution: Record<string, unknown> }).requestExecution,
    ).not.toHaveProperty("actorSnapshot");
    expect(
      (acceptedWrites[0] as { requestExecution: Record<string, unknown> }).requestExecution,
    ).not.toHaveProperty("actorGroups");
    expect(
      (acceptedWrites[0] as { requestExecution: Record<string, unknown> }).requestExecution,
    ).not.toHaveProperty("actorCampusScope");
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
        safetyIdentifier: expectedSafetyIdentifier,
        selectedTarget: "rag-specialist",
        sourceDocIds: ["handbook:library-hours"],
        status: "completed",
        visibilityScope: "main",
      },
      requestObservabilityFact: {
        requestId: "req_0001",
        safetyIdentifier: expectedSafetyIdentifier,
      },
    });
    expect(
      (finalWrites[0] as { requestExecution: Record<string, unknown> }).requestExecution,
    ).not.toHaveProperty("actorGroups");
    expect(
      (finalWrites[0] as { requestExecution: Record<string, unknown> }).requestExecution,
    ).not.toHaveProperty("actorCampusScope");
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
        safetyIdentifier: expectedSafetyIdentifier,
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
        safetyIdentifier: expectedSafetyIdentifier,
        selectedTarget: "rag-specialist",
        sourceDocIds: ["handbook:library-hours"],
        status: "completed",
      }),
    );
    expect(telemetry.recordRequestTransportError).not.toHaveBeenCalled();
  });

  it("persists navigation place cards into assistant structured parts", async () => {
    const { store, finalWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const supervisor: SupervisorExecutionClient = {
      execute: vi.fn().mockResolvedValue({
        answerText: "图书馆在海淀校区主教学区西侧，靠近校医院。",
        error: null,
        followUpQuestion: "",
        result: {
          matched_alias: "图书馆",
          place_card: {
            access_note: "访客请先完成入校登记。",
            campus_area: "主教学区西侧",
            coordinate_reference_system: "EPSG:4326",
            location_description: "海淀校区主教学区西侧，靠近校医院。",
            place: {
              campus_area: "主教学区西侧",
              campus_scope: "haidian",
              display_name: "图书馆",
              entity_type: "building",
              place_id: "muc.haidian.library",
            },
            point_geometry: {
              latitude: 39.96162,
              longitude: 116.31551,
            },
            source_refs: ["seed:campus_navigation/place_catalog.v1"],
          },
          query_text: "图书馆在哪里",
          resolved_place: {
            campus_area: "主教学区西侧",
            campus_scope: "haidian",
            display_name: "图书馆",
            entity_type: "building",
            place_id: "muc.haidian.library",
          },
        },
        selectedTarget: "navigation-specialist",
        status: "completed",
        traceId: "trace_0002",
      }),
    };

    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-04-11T09:00:00.000Z"),
      conversationStore,
      store,
      supervisor,
    });

    const response = await service.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "图书馆在哪里",
      },
      principal: createPrincipal(),
      surface: "public_chat_web",
    });

    expect(finalWrites[0]).toMatchObject({
      assistantMessage: {
        kind: "answer",
        structuredParts: [
          {
            placeCard: {
              coordinateReferenceSystem: "EPSG:4326",
              displayName: "图书馆",
              entityType: "building",
              placeId: "muc.haidian.library",
            },
            type: "place_card",
          },
        ],
      },
    });
    expect(response.answer.conversation.messages.at(-1)).toMatchObject({
      structuredParts: [
        {
          placeCard: {
            displayName: "图书馆",
            entityType: "building",
            placeId: "muc.haidian.library",
          },
          type: "place_card",
        },
      ],
    });
  });

  it("persists navigation place cards even when point geometry is absent", async () => {
    const { store, finalWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const supervisor: SupervisorExecutionClient = {
      execute: vi.fn().mockResolvedValue({
        answerText: "民族博物馆在海淀校区西侧，靠近图书馆。",
        error: null,
        followUpQuestion: "",
        result: {
          matched_alias: "民族博物馆",
          place_card: {
            campus_area: "海淀校区西侧",
            location_description: "海淀校区西侧，靠近图书馆。",
            place: {
              campus_area: "海淀校区西侧",
              campus_scope: "haidian",
              display_name: "民族博物馆",
              entity_type: "building",
              place_id: "muc.haidian.museum",
            },
            source_refs: [
              "seed:campus_navigation/place_catalog.v1",
              "https://www.muc.edu.cn/xxgk1/xydt.htm",
            ],
          },
          query_text: "民族博物馆在哪里",
          resolved_place: {
            campus_area: "海淀校区西侧",
            campus_scope: "haidian",
            display_name: "民族博物馆",
            entity_type: "building",
            place_id: "muc.haidian.museum",
          },
        },
        selectedTarget: "navigation-specialist",
        status: "completed",
        traceId: "trace_0003",
      }),
    };

    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-04-11T10:00:00.000Z"),
      conversationStore,
      store,
      supervisor,
    });

    await service.submit({
      payload: {
        conversationId: "conv_02HQ",
        prompt: "民族博物馆在哪里",
      },
      principal: createPrincipal(),
      surface: "public_chat_web",
    });

    expect(finalWrites[0]).toMatchObject({
      assistantMessage: {
        structuredParts: [
          {
            placeCard: {
              displayName: "民族博物馆",
              placeId: "muc.haidian.museum",
              pointGeometry: null,
            },
            type: "place_card",
          },
        ],
      },
    });
  });

  it("normalizes supervisor traceId in finalized responses when upstream payload omits it", async () => {
    const { store, finalWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store,
      supervisor: {
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
          traceId: "",
        }),
      },
    });

    const response = await service.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "图书馆开放到几点？",
      },
      principal: createPrincipal(),
      surface: "eval_benchmark",
    });

    expect(response.traceId).toBe("trace_0001");
    expect(response.answer.result.traceId).toBe("trace_0001");
    expect(response.supervisor).toMatchObject({
      status: "completed",
      traceId: "trace_0001",
    });
    expect(finalWrites[0]).toMatchObject({
      requestExecution: {
        surface: "eval_benchmark",
        traceId: "trace_0001",
      },
      requestObservabilityFact: {
        surface: "eval_benchmark",
        traceId: "trace_0001",
      },
    });
  });

  it("passes eval_benchmark surface through to the supervisor client", async () => {
    const { store } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
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
    });

    await service.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "图书馆开放到几点？",
      },
      principal: createPrincipal(),
      surface: "eval_benchmark",
    });

    expect(supervisor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req_0001",
        surface: "eval_benchmark",
      }),
    );
  });

  it("writes curriculum follow-up session slots from resolved curriculum completion and replays them into the next supervisor request", async () => {
    const conversation = {
      ...createConversation(),
      title: "培养方案",
    };
    const commandStore = createCommandStore({ conversation });
    const { store: conversationStore } = createConversationStore({ conversation });
    const supervisor: SupervisorExecutionClient = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({
          answerText: "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。",
          error: null,
          followUpQuestion: "",
          result: {
            diagnostics: {
              resolved_program_family_title: "民族班",
              resolved_entity_type: "program",
              rewritten_query: "法学民族实验班培养方案里第四学期有什么课",
              session_program_family: "民族实验班",
              session_program: "法学民族实验班",
              session_semester: "第四学期",
            },
            evidence: {
              sources: [{ doc_id: "curriculum:法学（民族实验班）本科人才培养方案" }],
            },
          },
          selectedTarget: "rag-specialist",
          status: "completed",
          traceId: "trace_0002",
        })
        .mockResolvedValueOnce({
          answerText: "第二学期有中国法制史。",
          error: null,
          followUpQuestion: "",
          result: {
            diagnostics: {
              resolved_program_family_title: "民族班",
              resolved_entity_type: "program",
              rewritten_query: "法学民族实验班培养方案里第二学期有什么课",
              session_program_family: "民族实验班",
              session_program: "法学民族实验班",
              session_semester: "第二学期",
            },
            evidence: {
              sources: [{ doc_id: "curriculum:法学（民族实验班）本科人才培养方案" }],
            },
          },
          selectedTarget: "rag-specialist",
          status: "completed",
          traceId: "trace_0004",
        }),
    };
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store: commandStore.store,
      supervisor,
    });

    await service.submit({
      payload: {
        conversationId: conversation.id,
        prompt: "法学民族班培养方案里大二下有什么课",
        requestedScope: {
          collection: "curriculum_plan",
          corpus: "curriculum",
        },
      },
      principal: createPrincipal(),
    });

    expect(commandStore.finalWrites[0]).toMatchObject({
      sessionSlots: [
        {
          confirmed: true,
          name: CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
          value: "民族实验班",
        },
        {
          confirmed: true,
          name: CURRICULUM_PROGRAM_SLOT_NAME,
          value: "法学民族实验班",
        },
        {
          confirmed: true,
          name: CURRICULUM_SEMESTER_SLOT_NAME,
          value: "第四学期",
        },
      ],
    });

    await service.submit({
      payload: {
        conversationId: conversation.id,
        prompt: "那大一下呢",
        requestedScope: {
          collection: "curriculum_plan",
          corpus: "curriculum",
        },
      },
      principal: createPrincipal(),
    });

    expect(commandStore.finalWrites[1]).toMatchObject({
      sessionSlots: [
        {
          confirmed: true,
          name: CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
          value: "民族实验班",
        },
        {
          confirmed: true,
          name: CURRICULUM_PROGRAM_SLOT_NAME,
          value: "法学民族实验班",
        },
        {
          confirmed: true,
          name: CURRICULUM_SEMESTER_SLOT_NAME,
          value: "第二学期",
        },
      ],
    });

    expect(supervisor.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        context: expect.objectContaining({
          session: {
            confirmedSlots: [
              { confirmed: true, name: CURRICULUM_PROGRAM_FAMILY_SLOT_NAME, value: "民族实验班" },
              { confirmed: true, name: CURRICULUM_PROGRAM_SLOT_NAME, value: "法学民族实验班" },
              { confirmed: true, name: CURRICULUM_SEMESTER_SLOT_NAME, value: "第四学期" },
            ],
            turnCount: 2,
          },
        }),
      }),
    );
  });

  it("does not write curriculum follow-up session slots for clarification responses", async () => {
    const commandStore = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store: commandStore.store,
      supervisor: {
        execute: vi.fn().mockResolvedValue({
          answerText: "",
          error: null,
          followUpQuestion: "你想看哪个民族班？",
          result: {
            diagnostics: {
              clarification_reason: "curriculum_program_conflict",
              candidate_title_summary: [
                "法学（民族实验班）本科人才培养方案",
                "信息与计算科学（民族实验班）本科人才培养方案",
              ],
            },
          },
          selectedTarget: "rag-specialist",
          status: "needs_clarification",
          traceId: "trace_0002",
        }),
      },
    });

    await service.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "民族班培养方案里大二下有什么课",
        requestedScope: {
          collection: "curriculum_plan",
          corpus: "curriculum",
        },
      },
      principal: createPrincipal(),
    });

    expect(commandStore.finalWrites[0]).toMatchObject({
      sessionSlots: [],
    });
  });

  it("does not write curriculum follow-up session slots for completed program-family membership answers", async () => {
    const commandStore = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store: commandStore.store,
      supervisor: {
        execute: vi.fn().mockResolvedValue({
          answerText: "民大的民族班有法学、信息与计算科学、计算机科学与技术。",
          error: null,
          followUpQuestion: "",
          result: {
            diagnostics: {
              resolved_program_family_title: "民族班",
              resolved_entity_type: "program_family_membership",
              rewritten_query: "民族班有哪些",
            },
            evidence: {
              sources: [{ doc_id: "curriculum:program-family-membership" }],
            },
          },
          selectedTarget: "rag-specialist",
          status: "completed",
          traceId: "trace_0002",
        }),
      },
    });

    await service.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "民族班有哪些",
        requestedScope: {
          collection: "curriculum_plan",
          corpus: "curriculum",
        },
      },
      principal: createPrincipal(),
    });

    expect(commandStore.finalWrites[0]).toMatchObject({
      sessionSlots: [],
    });
  });

  it("does not write curriculum follow-up session slots for completed course-family answers", async () => {
    const commandStore = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store: commandStore.store,
      supervisor: {
        execute: vi.fn().mockResolvedValue({
          answerText:
            "思想政治理论课包括习近平新时代中国特色社会主义思想概论、马克思主义基本原理、中华民族共同体概论等课程。",
          error: null,
          followUpQuestion: "",
          result: {
            diagnostics: {
              resolved_course_family_title: "思修课",
              resolved_entity_type: "course_family_membership",
              rewritten_query: "思修课包括哪些课",
            },
            evidence: {
              sources: [{ doc_id: "curriculum:中央民族大学通识课程思想政治理论课教学计划" }],
            },
          },
          selectedTarget: "rag-specialist",
          status: "completed",
          traceId: "trace_0002",
        }),
      },
    });

    await service.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "思修课包括哪些课",
        requestedScope: {
          collection: "curriculum_plan",
          corpus: "curriculum",
        },
      },
      principal: createPrincipal(),
    });

    expect(commandStore.finalWrites[0]).toMatchObject({
      sessionSlots: [],
    });
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
            policyReason: null,
            resolvedPolicyDocumentId:
              "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
            resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
            retrievedTitleSummary: ["中央民族大学本科学生国家奖学金评审办法"],
            rewrittenQuery:
              "中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
            scopeClass: null,
            semanticOutcome: null,
          },
        },
      },
      requestExecution: {
        diagnostics: {
          clarificationReason: null,
          noAnswerReason: "resolved_policy_clause_not_found",
          policyReason: null,
          resolvedPolicyDocumentId:
            "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
          resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
          retrievedTitleSummary: ["中央民族大学本科学生国家奖学金评审办法"],
          rewrittenQuery:
            "中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
          scopeClass: null,
          semanticOutcome: null,
        },
      },
    });
  });

  it("writes request-scoped observability facts on accept and finalize", async () => {
    const { store, acceptedWrites, finalWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store,
      supervisor: {
        execute: vi.fn().mockResolvedValue({
          answerText: "图书馆开放到 22:00。",
          error: null,
          followUpQuestion: "",
          observability: {
            aclAnomalyCode: null,
            aclDecision: "allowed",
            cachedInputTokens: 0,
            candidateCount: 4,
            citationCount: 2,
            citationExpected: true,
            citationMissing: false,
            estimatedCostMicrousd: 3810,
            failClosed: false,
            inputTokens: 812,
            modelName: "gpt-5.2-mini",
            modelProvider: "openai",
            outputTokens: 229,
            refusalClass: null,
            retrievedSourceCount: 2,
            retrievalAttempted: true,
          },
          result: {
            evidence: {
              sources: [
                { doc_id: "handbook:library-hours" },
                { doc_id: "handbook:holiday-hours" },
              ],
            },
          },
          selectedTarget: "rag-specialist",
          status: "completed",
          traceId: "trace_0002",
        }),
      },
    });

    await service.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "图书馆开放到几点？",
      },
      principal: createPrincipal(),
    });

    expect(acceptedWrites[0]).toMatchObject({
      requestObservabilityFact: {
        aclAnomalyCode: null,
        aclDecision: null,
        candidateCount: null,
        citationCount: null,
        citationExpected: null,
        citationMissing: null,
        collection: null,
        conversationId: "conv_01HQ",
        emptyRecall: null,
        entitlementSnapshotId: "entitlements-2026-03-29",
        estimatedCostMicrousd: null,
        failClosed: null,
        inputTokens: null,
        modelName: null,
        modelProvider: null,
        outputTokens: null,
        policyProjectionVersion: "phase1-authorization-projection-v1",
        principalType: "student",
        requestId: "req_0001",
        requestedCapability: "knowledge",
        requestedScopeSummary: null,
        resolvedScopeSummary: null,
        retrievalAttempted: null,
        selectedTarget: null,
        status: "accepted",
        traceAvailable: true,
        traceId: "trace_0001",
      },
    });
    expect(finalWrites[0]).toMatchObject({
      requestObservabilityFact: {
        aclAnomalyCode: null,
        aclDecision: "allowed",
        cachedInputTokens: 0,
        candidateCount: 4,
        citationCount: 2,
        citationExpected: true,
        citationMissing: false,
        collection: null,
        emptyRecall: false,
        estimatedCostMicrousd: 3810,
        failClosed: false,
        inputTokens: 812,
        modelName: "gpt-5.2-mini",
        modelProvider: "openai",
        outputTokens: 229,
        principalType: "student",
        requestId: "req_0001",
        requestedScopeSummary: null,
        resolvedScopeSummary: null,
        retrievedSourceCount: 2,
        retrievalAttempted: true,
        selectedTarget: "rag-specialist",
        status: "completed",
        traceAvailable: true,
        traceId: "trace_0002",
      },
    });
  });

  it("keeps requested scope empty and records resolved curriculum scope when supervisor selects the serving surface", async () => {
    const { store, acceptedWrites, finalWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const service = buildChatCommandService({
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store,
      supervisor: {
        execute: vi.fn().mockResolvedValue({
          answerText: "民族学本科人才培养方案总学分要求以培养方案正文为准。",
          error: null,
          followUpQuestion: "",
          observability: {
            aclAnomalyCode: null,
            aclDecision: "allowed",
            cachedInputTokens: 0,
            candidateCount: 1,
            citationCount: 1,
            citationExpected: true,
            citationMissing: false,
            estimatedCostMicrousd: 1234,
            failClosed: false,
            inputTokens: 256,
            modelName: "gpt-5.2-mini",
            modelProvider: "openai",
            outputTokens: 64,
            refusalClass: null,
            resolvedScopeCollection: "curriculum_plan",
            resolvedScopeCorpus: "curriculum",
            retrievedSourceCount: 1,
            retrievalAttempted: true,
          },
          result: {
            evidence: {
              sources: [{ doc_id: "curriculum:民族学本科人才培养方案" }],
            },
          },
          selectedTarget: "rag-specialist",
          status: "completed",
          traceId: "trace_0002",
        }),
      },
    });

    await service.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "民族学本科人才培养方案总学分要求是多少？",
      },
      principal: createPrincipal(),
    });

    expect(acceptedWrites[0]).toMatchObject({
      requestExecution: {
        requestedScope: null,
      },
      requestObservabilityFact: {
        collection: null,
        requestedScopeSummary: null,
        resolvedScopeSummary: null,
      },
    });
    expect(finalWrites[0]).toMatchObject({
      requestExecution: {
        requestedScope: null,
        resolvedScope: {
          collection: "curriculum_plan",
          corpus: "curriculum",
        },
      },
      requestObservabilityFact: {
        collection: "curriculum_plan",
        requestedScopeSummary: null,
        resolvedScopeSummary: "curriculum/curriculum_plan",
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

  it("rejects after durable accept when the same safety identifier enters the abuse throttle window", async () => {
    const { store, acceptedWrites, finalWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    const telemetry = createTelemetryMock();
    const safetySecret = "phase-i-safety-secret";
    const expectedSafetyIdentifier = createHmac("sha256", safetySecret)
      .update("principal:user_01HQ")
      .digest("hex");
    const getAbuseControlState = vi.fn().mockResolvedValue({
      activeThrottleUntil: "2026-03-28T08:05:00.000Z",
      requestCountLastMinute: 9,
      requestCountLastTenMinutes: 9,
      shouldThrottle: true,
      throttleReason: "requests_per_minute",
    });
    const supervisor: SupervisorExecutionClient = {
      execute: vi.fn(),
    };
    const service = buildChatCommandService({
      deriveSafetyIdentifier: (principal) => deriveSafetyIdentifier(principal, safetySecret),
      generateId: createDeterministicIdGenerator(),
      now: () => new Date("2026-03-28T08:00:00.000Z"),
      conversationStore,
      store: {
        ...store,
        getAbuseControlState,
      } as ChatCommandStore,
      supervisor,
      telemetry,
    });

    const response = await service.submit({
      payload: {
        conversationId: "conv_01HQ",
        prompt: "连续快速提问的第九次请求",
      },
      principal: createPrincipal(),
    });

    expect(acceptedWrites).toHaveLength(1);
    expect(getAbuseControlState).toHaveBeenCalledWith({
      now: "2026-03-28T08:00:00.000Z",
      safetyIdentifier: expectedSafetyIdentifier,
      surface: "public_chat_web",
    });
    expect(supervisor.execute).not.toHaveBeenCalled();
    expect(response.answer.result).toEqual({
      errorCode: "rate_limit_exceeded",
      kind: "error",
      message: "Too many requests. Please wait a few minutes and try again.",
      requestId: "req_0001",
      retryable: false,
      traceId: "trace_0001",
    });
    expect(finalWrites[0]).toMatchObject({
      outboxEvent: {
        eventType: "request.rejected",
      },
      requestExecution: {
        errorCode: "rate_limit_exceeded",
        safetyIdentifier: expectedSafetyIdentifier,
        status: "rejected",
      },
      requestObservabilityFact: {
        errorCode: "rate_limit_exceeded",
        failClosed: true,
        safetyIdentifier: expectedSafetyIdentifier,
        status: "rejected",
      },
    });
    expect(telemetry.recordRequestFinalized).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "rate_limit_exceeded",
        requestId: "req_0001",
        safetyIdentifier: expectedSafetyIdentifier,
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
        structuredParts: [],
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
        structuredParts: [],
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

  it("creates a first-turn conversation with the caller-provided conversation id", async () => {
    const { store, acceptedWrites } = createCommandStore();
    const { store: conversationStore } = createConversationStore();
    conversationStore.getConversationByOwner = vi.fn().mockResolvedValue(null);
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
      payload: {
        conversationId: "conv_client_0001",
        prompt: "图书馆开放到几点？",
      },
      principal: createPrincipal(),
    });

    expect(conversationStore.getConversationByOwner).toHaveBeenCalledWith(
      "user_01HQ",
      "conv_client_0001",
    );
    expect(acceptedWrites[0]).toMatchObject({
      conversationSeed: {
        id: "conv_client_0001",
        ownerUserId: "user_01HQ",
        title: "图书馆开放到几点？",
      },
      requestExecution: {
        conversationId: "conv_client_0001",
      },
    });
    expect(supervisor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_client_0001",
      }),
    );
    expect(response.answer.conversation).toMatchObject({
      id: "conv_client_0001",
      title: "图书馆开放到几点？",
    });
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
