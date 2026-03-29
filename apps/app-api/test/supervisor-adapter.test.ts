// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SupervisorTransportError,
  createSupervisorExecutionClient,
} from "../src/modules/integration/supervisor";

describe("supervisor execution adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends snake_case execution payload and maps the typed response", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          answer_text: "图书馆开放到 22:00。",
          error: null,
          follow_up_question: "",
          result: {
            evidence: {
              sources: [{ doc_id: "handbook:library-hours" }],
            },
          },
          status: "completed",
          target: "rag-specialist",
          trace_id: "trace_01HQ",
        }),
        { status: 200 },
      ),
    );
    const client = createSupervisorExecutionClient(
      {
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      },
      { fetchImplementation },
    );

    const result = await client.execute({
      actor: {
        campusScope: "main",
        departments: [],
        groups: ["students"],
        roles: ["student"],
        snapshot: {
          principal_type: "public_user",
        },
        userId: "user_01HQ",
      },
      conversationId: "conv_01HQ",
      requestId: "req_01HQ",
      requestedCapability: "knowledge",
      requestedScope: {
        collection: "student_handbook",
        corpus: "regulations",
      },
      traceHeaders: {
        baggage: "sentry-environment=test",
        sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
      },
      traceId: "trace_01HQ",
      userGoal: "图书馆开放到几点？",
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://supervisor.internal/api/v1/answer",
      expect.objectContaining({
        headers: {
          baggage: "sentry-environment=test",
          "content-type": "application/json",
          "sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
          "x-trace-id": "trace_01HQ",
          "x-worker-origin-auth": "shared-secret",
        },
        method: "POST",
      }),
    );
    expect(JSON.parse(fetchImplementation.mock.calls[0]![1]!.body as string)).toEqual({
      actor: {
        campus_scope: "main",
        departments: [],
        groups: ["students"],
        roles: ["student"],
        snapshot: {
          principal_type: "public_user",
        },
        user_id: "user_01HQ",
      },
      conversation_id: "conv_01HQ",
      request_id: "req_01HQ",
      requested_capability: "knowledge",
      requested_scope: {
        collection: "student_handbook",
        corpus: "regulations",
      },
      user_goal: "图书馆开放到几点？",
    });
    expect(result).toEqual({
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
      traceId: "trace_01HQ",
    });
  });

  it("raises a typed transport error for non-200 upstream responses", async () => {
    const client = createSupervisorExecutionClient(
      {
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      },
      {
        fetchImplementation: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "unauthorized",
                message: "Invalid shared secret.",
                retryable: false,
              },
            }),
            { status: 502 },
          ),
        ),
      },
    );

    await expect(
      client.execute({
        actor: {
          campusScope: "main",
          departments: [],
          groups: ["students"],
          roles: ["student"],
          snapshot: {
            principal_type: "public_user",
          },
          userId: "user_01HQ",
        },
        conversationId: "conv_01HQ",
        requestId: "req_01HQ",
        traceId: "trace_01HQ",
        userGoal: "图书馆开放到几点？",
      }),
    ).rejects.toBeInstanceOf(SupervisorTransportError);
  });

  it("raises execution_timeout when the supervisor call exceeds the timeout budget", async () => {
    vi.useFakeTimers();
    const client = createSupervisorExecutionClient(
      {
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
        SUPERVISOR_API_TIMEOUT_MS: "25",
      },
      {
        fetchImplementation: vi.fn().mockImplementation(
          () => new Promise<Response>(() => undefined),
        ),
      },
    );

    const pending = client.execute({
      actor: {
        campusScope: "main",
        departments: [],
        groups: ["students"],
        roles: ["student"],
        snapshot: {
          principal_type: "public_user",
        },
        userId: "user_01HQ",
      },
      conversationId: "conv_01HQ",
      requestId: "req_01HQ",
      traceId: "trace_01HQ",
      userGoal: "图书馆开放到几点？",
    });

    const assertion = expect(pending).rejects.toMatchObject({
      code: "execution_timeout",
      retryable: true,
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("raises supervisor_invalid_response when the upstream body is not valid json", async () => {
    const client = createSupervisorExecutionClient(
      {
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
      },
      {
        fetchImplementation: vi.fn().mockResolvedValue(
          new Response("not-json", {
            headers: {
              "content-type": "application/json",
            },
            status: 200,
          }),
        ),
      },
    );

    await expect(
      client.execute({
        actor: {
          campusScope: "main",
          departments: [],
          groups: ["students"],
          roles: ["student"],
          snapshot: {
            principal_type: "public_user",
          },
          userId: "user_01HQ",
        },
        conversationId: "conv_01HQ",
        requestId: "req_01HQ",
        traceId: "trace_01HQ",
        userGoal: "图书馆开放到几点？",
      }),
    ).rejects.toMatchObject({
      code: "supervisor_invalid_response",
      retryable: true,
      status: 502,
    });
  });
});
