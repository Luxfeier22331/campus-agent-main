export type SessionUser = {
  id: string;
  name: string;
  email: string;
};

export type ChatMessageKind = "answer" | "clarification" | "error";

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  requestId?: string;
  kind?: ChatMessageKind;
  retryable?: boolean;
};

export type Conversation = {
  id: string;
  ownerUserId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type RawAnswerResult =
  | {
      kind: "answer";
      text: string;
      request_id: string;
    }
  | {
      kind: "clarification";
      text: string;
      request_id: string;
    }
  | {
      kind: "error";
      message: string;
      request_id?: string;
      retryable?: boolean;
    };

export type AnswerResult =
  | {
      kind: "answer";
      text: string;
      requestId: string;
    }
  | {
      kind: "clarification";
      text: string;
      requestId: string;
    }
  | {
      kind: "error";
      message: string;
      requestId?: string;
      retryable: boolean;
    };

export function mapAnswerResult(result: RawAnswerResult): AnswerResult {
  if (result.kind === "answer") {
    return {
      kind: "answer",
      text: result.text,
      requestId: result.request_id,
    };
  }

  if (result.kind === "clarification") {
    return {
      kind: "clarification",
      text: result.text,
      requestId: result.request_id,
    };
  }

  return {
    kind: "error",
    message: result.message,
    requestId: result.request_id,
    retryable: result.retryable ?? true,
  };
}
