import type {
  AnswerResult,
  Conversation,
  RawAnswerResult,
} from "./chat-types";
import { signOutAppSession } from "./auth-client-actions";
import { mapAnswerResult } from "./chat-types";

export class UnauthorizedError extends Error {
  constructor(message = "Sign in required.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

type ConversationsResponse = {
  conversations: Conversation[];
};

type ConversationResponse = {
  conversation: Conversation;
};

type AnswerResponse = {
  answer: {
    conversation: Conversation;
    result: AnswerResult;
  };
};

const DEFAULT_HEADERS = {
  "content-type": "application/json",
};

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...DEFAULT_HEADERS,
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => undefined)) as
    | Record<string, unknown>
    | undefined;

  if (response.status === 401) {
    throw new UnauthorizedError(
      typeof payload?.error === "string" ? payload.error : undefined,
    );
  }

  if (!response.ok || !payload) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}.`,
    );
  }

  return payload as T;
}

export async function listConversationsClient(): Promise<Conversation[]> {
  const payload = await requestJson<ConversationsResponse>("/api/conversations", {
    method: "GET",
  });

  return payload.conversations;
}

export async function createConversationClient(): Promise<Conversation> {
  const payload = await requestJson<ConversationResponse>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({}),
  });

  return payload.conversation;
}

export async function getConversationClient(
  conversationId: string,
): Promise<Conversation> {
  const payload = await requestJson<ConversationResponse>(
    `/api/conversations/${conversationId}`,
    {
      method: "GET",
    },
  );

  return payload.conversation;
}

export async function answerConversationClient(input: {
  conversationId: string;
  prompt: string;
}): Promise<AnswerResponse["answer"]> {
  const payload = await requestJson<{
    answer: {
      conversation: Conversation;
      result: RawAnswerResult;
    };
  }>("/api/answer", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return {
    conversation: payload.answer.conversation,
    result: mapAnswerResult(payload.answer.result),
  };
}

export async function deleteConversationClient(conversationId: string): Promise<void> {
  await requestJson<{ ok: true }>(`/api/conversations/${conversationId}`, {
    method: "DELETE",
  });
}

export async function deleteAllConversationsClient(): Promise<void> {
  await requestJson<{ ok: true }>("/api/conversations", {
    method: "DELETE",
  });
}

export async function startConversationClient(input: {
  prompt: string;
}): Promise<AnswerResponse["answer"]> {
  const conversation = await createConversationClient();

  return answerConversationClient({
    conversationId: conversation.id,
    prompt: input.prompt,
  });
}

export async function signOutClient(): Promise<void> {
  try {
    await signOutAppSession();
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      throw new UnauthorizedError();
    }

    if (error instanceof Error && error.message === "Sign in required.") {
      throw new UnauthorizedError(error.message);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unable to sign out.");
  }
}
