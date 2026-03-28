import type {
  ChatAnswerPayload,
  ConversationDetail,
  ConversationSummary,
  SessionPrincipal,
} from "./types";

export class UnauthorizedError extends Error {
  constructor(message = "Sign in required.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseErrorMessage(payload: unknown, statusText: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  return statusText || "Request failed.";
}

async function requestJson<T>(input: {
  body?: BodyInit | null;
  headers?: HeadersInit;
  method?: string;
  path: string;
}): Promise<T> {
  const response = await fetch(input.path, {
    body: input.body,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(input.headers ?? {}),
    },
    method: input.method ?? "GET",
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => undefined)
    : await response.text().catch(() => undefined);

  if (response.status === 401) {
    throw new UnauthorizedError(parseErrorMessage(payload, response.statusText));
  }

  if (!response.ok) {
    throw new Error(parseErrorMessage(payload, response.statusText));
  }

  return payload as T;
}

export async function getSessionPrincipal(): Promise<SessionPrincipal> {
  return requestJson<SessionPrincipal>({
    method: "GET",
    path: "/api/me",
  });
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const payload = await requestJson<{ conversations: ConversationSummary[] }>({
    method: "GET",
    path: "/api/chat/conversations",
  });

  return payload.conversations;
}

export async function createDraftConversation(): Promise<ConversationDetail> {
  const payload = await requestJson<{ conversation: ConversationDetail }>({
    method: "POST",
    path: "/api/chat/conversations",
  });

  return payload.conversation;
}

export async function getConversationDetail(conversationId: string): Promise<ConversationDetail> {
  const payload = await requestJson<{ conversation: ConversationDetail }>({
    method: "GET",
    path: `/api/chat/conversations/${conversationId}`,
  });

  return payload.conversation;
}

export async function submitChatRequest(input: {
  conversationId?: string;
  prompt: string;
}): Promise<ChatAnswerPayload> {
  const body =
    input.conversationId && input.conversationId.trim()
      ? {
          conversationId: input.conversationId,
          prompt: input.prompt.trim(),
        }
      : {
          prompt: input.prompt.trim(),
        };

  const payload = await requestJson<{ answer: ChatAnswerPayload }>({
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "idempotency-key": createIdempotencyKey(),
    },
    method: "POST",
    path: "/api/chat/requests",
  });

  return payload.answer;
}
