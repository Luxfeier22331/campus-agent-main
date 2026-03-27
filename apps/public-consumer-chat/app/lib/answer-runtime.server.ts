import { randomUUID } from "node:crypto";

import type { PublicChatServerEnv } from "./env.server";
import type { RawAnswerResult } from "./chat-types";

const ANSWER_ENDPOINT = "/api/v1/answer";
const DEFAULT_SCOPE = {
  corpus: "regulations",
  collection: "student_handbook",
} as const;

const buildMockResult = (prompt: string): RawAnswerResult => {
  const normalized = prompt.trim().toLowerCase();
  const requestId = `req-${randomUUID().slice(0, 8)}`;

  if (normalized.length < 18) {
    return {
      kind: "clarification",
      text: "Please add the campus, role, or policy detail you care about so I can narrow the answer.",
      request_id: requestId,
    };
  }

  if (normalized.includes("error")) {
    return {
      kind: "error",
      message: "The public answer path is unavailable right now.",
      request_id: requestId,
    };
  }

  return {
    kind: "answer",
    text: "Here is the best handbook-grounded answer I can give from the current public consumer app seam.",
    request_id: requestId,
  };
};

export async function requestPublicAnswer(input: {
  env: PublicChatServerEnv;
  conversationId: string;
  prompt: string;
}): Promise<RawAnswerResult> {
  const { env, conversationId, prompt } = input;
  const upstreamRequestId = randomUUID();

  if (env.publicChatMode === "mock") {
    return buildMockResult(prompt);
  }

  if (!env.answerBaseUrl) {
    return {
      kind: "error",
      message: "SUPERVISOR_API_BASE_URL is required in live mode.",
      request_id: `req-${randomUUID().slice(0, 8)}`,
      retryable: false,
    };
  }

  try {
    const response = await fetch(new URL(ANSWER_ENDPOINT, env.answerBaseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.answerBearerToken
          ? {
              authorization: `Bearer ${env.answerBearerToken}`,
            }
          : {}),
      },
      body: JSON.stringify({
        user_goal: prompt,
        conversation_id: conversationId,
        request_id: upstreamRequestId,
        requested_scope: DEFAULT_SCOPE,
      }),
    });

    const requestId = response.headers.get("x-request-id") ?? undefined;
    const parsed = (await response.json().catch(() => undefined)) as
      | Record<string, unknown>
      | undefined;

    if (!parsed) {
      return {
        kind: "error",
        message: "The public answer path returned an invalid payload.",
        request_id: requestId ?? upstreamRequestId,
      };
    }

    const traceId =
      typeof parsed.trace_id === "string" && parsed.trace_id
        ? parsed.trace_id
        : undefined;

    if (!response.ok) {
      const errorPayload =
        parsed.error && typeof parsed.error === "object"
          ? (parsed.error as Record<string, unknown>)
          : undefined;
      const errorMessage =
        typeof errorPayload?.message === "string"
          ? errorPayload.message
          : "The public answer path returned an invalid payload.";
      const retryable =
        typeof errorPayload?.retryable === "boolean"
          ? errorPayload.retryable
          : undefined;

      return {
        kind: "error",
        message: errorMessage,
        request_id: traceId ?? requestId ?? upstreamRequestId,
        retryable,
      };
    }

    if (parsed.kind === "answer" && typeof parsed.text === "string") {
      return {
        kind: "answer",
        text: parsed.text,
        request_id: String(parsed.request_id ?? traceId ?? requestId ?? upstreamRequestId),
      };
    }

    if (parsed.kind === "clarification" && typeof parsed.text === "string") {
      return {
        kind: "clarification",
        text: parsed.text,
        request_id: String(parsed.request_id ?? traceId ?? requestId ?? upstreamRequestId),
      };
    }

    if (parsed.status === "needs_clarification" && typeof parsed.follow_up_question === "string") {
      return {
        kind: "clarification",
        text: parsed.follow_up_question,
        request_id: String(traceId ?? requestId ?? upstreamRequestId),
      };
    }

    if (parsed.status === "completed" && typeof parsed.answer_text === "string") {
      return {
        kind: "answer",
        text: parsed.answer_text,
        request_id: String(traceId ?? requestId ?? upstreamRequestId),
      };
    }

    const responseError =
      parsed.error && typeof parsed.error === "object"
        ? (parsed.error as Record<string, unknown>)
        : undefined;

    if (parsed.status === "no_answer") {
      return {
        kind: "error",
        message:
          typeof responseError?.message === "string"
            ? responseError.message
            : "No grounded answer is available yet.",
        request_id: String(traceId ?? requestId ?? upstreamRequestId),
        retryable:
          typeof responseError?.retryable === "boolean"
            ? responseError.retryable
            : false,
      };
    }

    if (parsed.status === "error") {
      return {
        kind: "error",
        message:
          typeof responseError?.message === "string"
            ? responseError.message
            : "The public answer path returned an application error.",
        request_id: String(traceId ?? requestId ?? upstreamRequestId),
        retryable:
          typeof responseError?.retryable === "boolean"
            ? responseError.retryable
            : true,
      };
    }

    if (typeof responseError?.message === "string") {
      return {
        kind: "error",
        message: responseError.message,
        request_id: String(traceId ?? requestId ?? upstreamRequestId),
        retryable:
          typeof responseError.retryable === "boolean"
            ? responseError.retryable
            : undefined,
      };
    }

    if (typeof parsed.message === "string") {
      return {
        kind: "error",
        message: parsed.message,
        request_id: String(parsed.request_id ?? traceId ?? requestId ?? upstreamRequestId),
      };
    }

    return {
      kind: "error",
      message: "The public answer path returned an invalid payload.",
      request_id: traceId ?? requestId ?? upstreamRequestId,
    };
  } catch (error) {
    return {
      kind: "error",
      message:
        error instanceof Error
          ? `The public answer path is unavailable right now. ${error.message}`
          : "The public answer path is unavailable right now.",
      request_id: `req-${randomUUID().slice(0, 8)}`,
    };
  }
}
