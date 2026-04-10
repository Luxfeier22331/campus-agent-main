import type { UIMessage } from "ai";

export type ArtifactKind = "code" | "image" | "sheet" | "text";

export type MessageMetadata = {
  createdAt: string;
};

export type SuggestionRecord = {
  createdAt: Date | string;
  description?: string | null;
  documentCreatedAt: Date | string;
  documentId: string;
  id: string;
  isResolved: boolean;
  originalText: string;
  suggestedText: string;
  userId: string;
};

type WeatherToolOutput = {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  cityName?: string;
  current_units: {
    time: string;
    interval: string;
    temperature_2m: string;
  };
  current: {
    time: string;
    interval: number;
    temperature_2m: number;
  };
  hourly_units: {
    time: string;
    temperature_2m: string;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
  };
  daily_units: {
    time: string;
    sunrise: string;
    sunset: string;
  };
  daily: {
    time: string[];
    sunrise: string[];
    sunset: string[];
  };
};

type DocumentToolResultRecord = {
  content?: string;
  id: string;
  kind: ArtifactKind;
  title: string;
};

type DocumentToolError = {
  error: unknown;
};

type SuggestionToolResultRecord = {
  id: string;
  kind: ArtifactKind;
  message: string;
  title: string;
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
    input: { kind: ArtifactKind; title: string };
    output: DocumentToolError | DocumentToolResultRecord;
  };
  getWeather: {
    input:
      | { city: string; latitude?: number; longitude?: number }
      | { city?: string; latitude: number; longitude: number };
    output: WeatherToolOutput;
  };
  requestSuggestions: {
    input: { documentId: string };
    output: DocumentToolError | SuggestionToolResultRecord;
  };
  updateDocument: {
    input: { description: string; id: string };
    output: DocumentToolError | DocumentToolResultRecord;
  };
};

type BaseChatMessage = UIMessage<MessageMetadata, CustomUIDataTypes, ChatTools>;

export type ChatMessage = BaseChatMessage & {
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
