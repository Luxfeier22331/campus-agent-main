// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  buildRequestProjectionProjector,
  type ProjectionOutboxEvent,
  type RequestExecutionProjectionSource,
  type RequestProjectionProjectorStore,
} from "../src/modules/projection";

function createExecutionSource(
  overrides: Partial<RequestExecutionProjectionSource> = {},
): RequestExecutionProjectionSource {
  return {
    answerPreview: "图书馆开放到 22:00。",
    completedAt: "2026-03-28T08:00:01.000Z",
    conversationId: "conv_01HQ",
    diagnostics: null,
    durationMs: 842,
    errorCode: null,
    principalId: "user_01HQ",
    principalLabel: "Jane Doe",
    principalType: "public_user",
    projectedAtHint: "2026-03-28T08:00:02.000Z",
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
    ...overrides,
  };
}

function createPendingEvent(
  overrides: Partial<ProjectionOutboxEvent> = {},
): ProjectionOutboxEvent {
  return {
    attemptCount: 0,
    availableAt: "2026-03-28T08:00:02.000Z",
    eventId: "evt_accepted",
    eventType: "request.completed",
    occurredAt: "2026-03-28T08:00:02.000Z",
    processedAt: null,
    requestId: "req_01HQ",
    ...overrides,
  };
}

describe("request projection projector", () => {
  it("materializes request_execution truth into operator.request_projection and marks events processed", async () => {
    const store: RequestProjectionProjectorStore = {
      getRequestExecution: vi.fn().mockResolvedValue(createExecutionSource()),
      listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
      markEventFailed: vi.fn(),
      markEventProcessed: vi.fn(),
      upsertProjection: vi.fn(),
    };
    const projector = buildRequestProjectionProjector({
      now: () => new Date("2026-03-28T08:00:03.000Z"),
      store,
    });

    const result = await projector.drain();

    expect(result).toEqual({
      failed: 0,
      processed: 1,
    });
    expect(store.upsertProjection).toHaveBeenCalledWith({
      answerPreview: "图书馆开放到 22:00。",
      completedAt: "2026-03-28T08:00:01.000Z",
      conversationId: "conv_01HQ",
      diagnostics: null,
      durationMs: 842,
      errorCode: null,
      principalId: "user_01HQ",
      principalLabel: "Jane Doe",
      principalType: "public_user",
      projectedAt: "2026-03-28T08:00:03.000Z",
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
    });
    expect(store.markEventProcessed).toHaveBeenCalledWith({
      eventId: "evt_accepted",
      processedAt: "2026-03-28T08:00:03.000Z",
    });
    expect(store.markEventFailed).not.toHaveBeenCalled();
  });

  it("records a retryable projector failure when request_execution is missing", async () => {
    const store: RequestProjectionProjectorStore = {
      getRequestExecution: vi.fn().mockResolvedValue(null),
      listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
      markEventFailed: vi.fn(),
      markEventProcessed: vi.fn(),
      upsertProjection: vi.fn(),
    };
    const projector = buildRequestProjectionProjector({
      now: () => new Date("2026-03-28T08:00:03.000Z"),
      store,
    });

    const result = await projector.drain();

    expect(result).toEqual({
      failed: 1,
      processed: 0,
    });
    expect(store.markEventFailed).toHaveBeenCalledWith({
      attemptCount: 1,
      availableAt: "2026-03-28T08:00:08.000Z",
      eventId: "evt_accepted",
      lastError: "Missing request_execution for req_01HQ.",
      processedAt: null,
    });
    expect(store.upsertProjection).not.toHaveBeenCalled();
    expect(store.markEventProcessed).not.toHaveBeenCalled();
  });

  it("carries summary diagnostics from request_execution into operator.request_projection", async () => {
    const store: RequestProjectionProjectorStore = {
      getRequestExecution: vi.fn().mockResolvedValue(
        createExecutionSource({
          diagnostics: {
            clarificationReason: "policy_object_conflict",
            noAnswerReason: null,
            resolvedPolicyDocumentId:
              "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
            resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
            retrievedTitleSummary: [
              "中央民族大学本科学生国家奖学金评审办法",
              "中央民族大学本科学生综合素质测评办法",
            ],
            rewrittenQuery:
              "中央民族大学本科学生国家奖学金评审办法 国奖第九条里对论文和著作怎么要求的？",
          },
        }),
      ),
      listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
      markEventFailed: vi.fn(),
      markEventProcessed: vi.fn(),
      upsertProjection: vi.fn(),
    };
    const projector = buildRequestProjectionProjector({
      now: () => new Date("2026-03-28T08:00:03.000Z"),
      store,
    });

    await projector.drain();

    expect(store.upsertProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostics: {
          clarificationReason: "policy_object_conflict",
          noAnswerReason: null,
          resolvedPolicyDocumentId:
            "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
          resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
          retrievedTitleSummary: [
            "中央民族大学本科学生国家奖学金评审办法",
            "中央民族大学本科学生综合素质测评办法",
          ],
          rewrittenQuery:
            "中央民族大学本科学生国家奖学金评审办法 国奖第九条里对论文和著作怎么要求的？",
        },
      }),
    );
  });

  it("marks terminal projector failures as processed after the retry budget is exhausted", async () => {
    const store: RequestProjectionProjectorStore = {
      getRequestExecution: vi.fn().mockResolvedValue(null),
      listPendingEvents: vi.fn().mockResolvedValue([
        createPendingEvent({
          attemptCount: 4,
          eventId: "evt_terminal",
        }),
      ]),
      markEventFailed: vi.fn(),
      markEventProcessed: vi.fn(),
      upsertProjection: vi.fn(),
    };
    const projector = buildRequestProjectionProjector({
      now: () => new Date("2026-03-28T08:00:03.000Z"),
      store,
    });

    const result = await projector.drain();

    expect(result).toEqual({
      failed: 1,
      processed: 0,
    });
    expect(store.markEventFailed).toHaveBeenCalledWith({
      attemptCount: 5,
      availableAt: "2026-03-28T08:00:03.000Z",
      eventId: "evt_terminal",
      lastError: "Missing request_execution for req_01HQ.",
      processedAt: "2026-03-28T08:00:03.000Z",
    });
    expect(store.markEventProcessed).not.toHaveBeenCalled();
  });
});
