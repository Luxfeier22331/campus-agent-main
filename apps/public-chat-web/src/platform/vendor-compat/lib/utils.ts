import { type ClassValue, clsx } from "clsx";
import { formatISO } from "date-fns";
import { twMerge } from "tailwind-merge";

import { ChatbotError, type ErrorCode } from "@/lib/errors";

import type { DBMessage, Document } from "./db/schema";
import type { ChatMessage } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function sanitizeText(text: string) {
  return text.replace("<has_function_call>", "");
}

function parseErrorCode(payload: unknown): ErrorCode | null {
  if (
    payload &&
    typeof payload === "object" &&
    "code" in payload &&
    typeof payload.code === "string" &&
    payload.code.includes(":")
  ) {
    return payload.code as ErrorCode;
  }

  return null;
}

function parseErrorMessage(payload: unknown, fallback: string) {
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

  if (
    payload &&
    typeof payload === "object" &&
    "cause" in payload &&
    typeof payload.cause === "string"
  ) {
    return payload.cause;
  }

  return fallback;
}

export const fetcher = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    credentials: "same-origin",
  });

  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const errorCode = parseErrorCode(payload);
    if (errorCode) {
      throw new ChatbotError(
        errorCode,
        parseErrorMessage(payload, response.statusText || "Request failed."),
      );
    }

    throw new Error(parseErrorMessage(payload, response.statusText || "Request failed."));
  }

  return payload as T;
};

export async function fetchWithErrorHandlers(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const response = await fetch(input, {
      credentials: "same-origin",
      ...init,
    });
    const payload = await response.json().catch(() => undefined);

    if (!response.ok) {
      const errorCode = parseErrorCode(payload);
      if (errorCode) {
        throw new ChatbotError(
          errorCode,
          parseErrorMessage(payload, response.statusText || "Request failed."),
        );
      }

      throw new Error(parseErrorMessage(payload, response.statusText || "Request failed."));
    }

    return new Response(JSON.stringify(payload), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new ChatbotError("offline:chat");
    }

    throw error;
  }
}

export function getDocumentTimestampByIndex(documents: Document[], index: number) {
  if (!documents.length || index >= documents.length) {
    return new Date();
  }

  return documents[index]?.createdAt ?? new Date();
}

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    metadata: {
      createdAt: formatISO(message.createdAt),
    },
    parts: Array.isArray(message.parts) ? (message.parts as ChatMessage["parts"]) : [],
    role:
      message.role === "assistant" || message.role === "system" || message.role === "user"
        ? message.role
        : "assistant",
  }));
}

export function getTextFromMessage(message: ChatMessage) {
  return message.parts
    .filter(
      (part): part is Extract<ChatMessage["parts"][number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}
