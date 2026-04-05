export interface SessionPrincipal {
  principal: {
    type: "campus_member" | "student" | "staff" | "faculty" | "operator";
    principalId: string;
    displayName: string;
    email: string | null;
  };
  session: {
    sessionId: string;
    expiresAt: string;
  } | null;
  permissions: {
    chat: boolean;
    operator: boolean;
  };
}

export type ChatMessageKind = "answer" | "clarification" | "no_answer" | "error";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  kind: ChatMessageKind | null;
  text: string;
  createdAt: string;
  requestId: string | null;
  retryable: boolean | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[];
}

export type ChatCommandResult =
  | {
      kind: "answer" | "clarification" | "no_answer";
      requestId: string;
      text: string;
      traceId: string;
    }
  | {
      errorCode: string;
      kind: "error";
      message: string;
      requestId: string;
      retryable: boolean;
      traceId: string;
    };

export interface ChatAnswerPayload {
  conversation: ConversationDetail;
  result: ChatCommandResult;
}
