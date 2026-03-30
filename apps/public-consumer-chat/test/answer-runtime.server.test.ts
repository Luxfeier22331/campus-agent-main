// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { requestPublicAnswer } from "../app/lib/answer-runtime.server";
import type { PublicChatServerEnv } from "../app/lib/env.server";

const baseEnv: PublicChatServerEnv = {
  nodeEnv: "test",
  publicChatMode: "mock",
  appBaseUrl: "http://127.0.0.1:3000",
  databaseUrl: "postgres://postgres:secret@example.com:5432/postgres",
  databaseSslMode: "require",
  betterAuthSecret: "dev-secret-dev-secret-dev-secret",
  authSchema: "app_auth",
  chatSchema: "chat",
  ingestionRegistrySchema: "ingestion_registry",
};

const curriculumScope = {
  corpus: "curriculum",
  collection: "curriculum_plan",
} as const;

describe("answer runtime availability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a non-retryable error when live mode is missing SUPERVISOR_API_BASE_URL", async () => {
    const result = await requestPublicAnswer({
      env: {
        ...baseEnv,
        publicChatMode: "live",
      },
      conversationId: "conv-1",
      prompt: "图书馆开放到几点？",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected error result.");
    }
    expect(result.message).toBe("SUPERVISOR_API_BASE_URL is required in live mode.");
    expect(result.retryable).toBe(false);
    expect(result.request_id).toMatch(/^req-/);
  });

  it("maps upstream transport failures into a stable availability error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8000")),
    );

    const result = await requestPublicAnswer({
      env: {
        ...baseEnv,
        publicChatMode: "live",
        answerBaseUrl: "http://127.0.0.1:8000",
        answerBearerToken: "local-dev-token",
        answerScope: curriculumScope,
      },
      conversationId: "conv-1",
      prompt: "图书馆开放到几点？",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected error result.");
    }
    expect(result.message).toContain("The public answer path is unavailable right now.");
    expect(result.message).toContain("connect ECONNREFUSED");
    expect(result.request_id).toMatch(/^req-/);
  });

  it("returns a non-retryable error when live mode is missing an explicit answer scope", async () => {
    const result = await requestPublicAnswer({
      env: {
        ...baseEnv,
        publicChatMode: "live",
        answerBaseUrl: "http://127.0.0.1:8000",
      },
      conversationId: "conv-1",
      prompt: "培养方案要求是什么？",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected error result.");
    }
    expect(result.message).toBe(
      "PUBLIC_CONSUMER_CHAT_SCOPE_CORPUS and PUBLIC_CONSUMER_CHAT_SCOPE_COLLECTION are required in live mode.",
    );
    expect(result.retryable).toBe(false);
  });

  it("maps invalid live payloads into a request-correlated error state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false }), {
          status: 502,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req-upstream-1",
          },
        }),
      ),
    );

    const result = await requestPublicAnswer({
      env: {
        ...baseEnv,
        publicChatMode: "live",
        answerBaseUrl: "http://127.0.0.1:8000",
        answerScope: curriculumScope,
      },
      conversationId: "conv-1",
      prompt: "图书馆开放到几点？",
    });

    expect(result).toEqual({
      kind: "error",
      message: "The public answer path returned an invalid payload.",
      request_id: "req-upstream-1",
    });
  });

  it("maps supervisor api error payloads into app-level error states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "invalid_request",
              message: "requested_scope must be an object",
              retryable: false,
            },
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    const result = await requestPublicAnswer({
      env: {
        ...baseEnv,
        publicChatMode: "live",
        answerBaseUrl: "http://127.0.0.1:8000",
        answerScope: curriculumScope,
      },
      conversationId: "conv-1",
      prompt: "图书馆开放到几点？",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected error result.");
    }
    expect(result.message).toBe("requested_scope must be an object");
    expect(result.retryable).toBe(false);
    expect(result.request_id).toBeTruthy();
  });

  it("maps supervisor completed responses into answer state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            target: "rag-specialist",
            status: "completed",
            answer_text: "图书馆开放到晚上十点。",
            confidence: "high",
            trace_id: "trace-123",
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

    const result = await requestPublicAnswer({
      env: {
        ...baseEnv,
        publicChatMode: "live",
        answerBaseUrl: "http://127.0.0.1:8000",
        answerScope: curriculumScope,
      },
      conversationId: "conv-1",
      prompt: "图书馆开放到几点？",
    });

    expect(result).toEqual({
      kind: "answer",
      text: "图书馆开放到晚上十点。",
      request_id: "trace-123",
    });
  });

  it("maps supervisor clarification responses into clarification state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            target: "rag-specialist",
            status: "needs_clarification",
            follow_up_question: "你想问哪个校区的图书馆？",
            confidence: "medium",
            trace_id: "trace-456",
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

    const result = await requestPublicAnswer({
      env: {
        ...baseEnv,
        publicChatMode: "live",
        answerBaseUrl: "http://127.0.0.1:8000",
        answerScope: curriculumScope,
      },
      conversationId: "conv-1",
      prompt: "图书馆开放到几点？",
    });

    expect(result).toEqual({
      kind: "clarification",
      text: "你想问哪个校区的图书馆？",
      request_id: "trace-456",
    });
  });

  it("maps supervisor no_answer responses into a non-retryable app error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            target: "rag-specialist",
            status: "no_answer",
            answer_text: "",
            follow_up_question: "",
            confidence: "low",
            error: null,
            trace_id: "trace-789",
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

    const result = await requestPublicAnswer({
      env: {
        ...baseEnv,
        publicChatMode: "live",
        answerBaseUrl: "http://127.0.0.1:8000",
        answerScope: curriculumScope,
      },
      conversationId: "conv-1",
      prompt: "图书馆开放到几点？",
    });

    expect(result).toEqual({
      kind: "error",
      message: "No grounded answer is available yet.",
      request_id: "trace-789",
      retryable: false,
    });
  });
});
