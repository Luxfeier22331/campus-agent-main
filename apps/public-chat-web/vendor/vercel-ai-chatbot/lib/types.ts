import type { UIMessage } from "ai";

export type ArtifactKind = "code" | "image" | "sheet" | "text";

export type MessageMetadata = {
  createdAt: string;
};

export type SuggestionRecord = {
  createdAt: string;
  description?: string | null;
  documentCreatedAt: string;
  documentId: string;
  id: string;
  isResolved: boolean;
  originalText: string;
  suggestedText: string;
  userId: string;
};

export type CustomUIDataTypes = {
  "chat-title": string;
  appendMessage: string;
  clear: null;
  codeDelta: string;
  finish: null;
  id: string;
  imageDelta: string;
  kind: ArtifactKind;
  sheetDelta: string;
  suggestion: SuggestionRecord;
  textDelta: string;
  title: string;
};

export type ChatTools = {
  createDocument: {
    input: { kind?: ArtifactKind; title?: string };
    output: { error?: unknown; id?: string; kind?: ArtifactKind; title?: string } | undefined;
  };
  getWeather: {
    input: { location?: string };
    output: unknown;
  };
  requestSuggestions: {
    input: { documentId?: string };
    output: { error?: unknown } | { id?: string; kind?: ArtifactKind; title?: string } | undefined;
  };
  updateDocument: {
    input: { description?: string; id?: string };
    output: { error?: unknown; id?: string; kind?: ArtifactKind; title?: string } | undefined;
  };
};

export type ChatMessage = UIMessage<MessageMetadata, CustomUIDataTypes, ChatTools> & {
  kind?: "answer" | "clarification" | "error" | "no_answer" | "user";
  requestId?: string | null;
  retryable?: boolean;
};

export type ChatMessagePart = ChatMessage["parts"][number];

export type Attachment = {
  contentType: string;
  name: string;
  url: string;
};
