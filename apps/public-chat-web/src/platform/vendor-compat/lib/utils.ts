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

function parseErrorMessage(payload: unknown, defaultMessage: string) {
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

	return defaultMessage;
}

async function parseJsonResponse(response: Response, invalidJsonMessage: string): Promise<unknown> {
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.includes("application/json")) {
		throw new Error("Vendor compat fetch returned a non-JSON response.");
	}
	try {
		return await response.json();
	} catch (error) {
		throw new Error(invalidJsonMessage, { cause: error });
	}
}

export const fetcher = async <T>(url: string): Promise<T> => {
	const response = await fetch(url, {
		credentials: "same-origin",
	});

	if (!response.ok) {
		const payload = await parseJsonResponse(
			response,
			"Vendor compat fetcher returned invalid JSON error payload.",
		);
		const errorCode = parseErrorCode(payload);
		if (errorCode) {
			throw new ChatbotError(
				errorCode,
				parseErrorMessage(payload, response.statusText || "Request failed."),
			);
		}

		throw new Error(parseErrorMessage(payload, response.statusText || "Request failed."));
	}

	return (await parseJsonResponse(response, "Vendor compat fetcher returned invalid JSON.")) as T;
};

export async function fetchWithErrorHandlers(input: RequestInfo | URL, init?: RequestInit) {
	let response: Response;
	try {
		response = await fetch(input, {
			credentials: "same-origin",
			...init,
		});
	} catch (error) {
		if (typeof navigator !== "undefined" && !navigator.onLine) {
			throw new ChatbotError("offline:chat");
		}
		throw error;
	}

	if (!response.ok) {
		const payload = await parseJsonResponse(
			response,
			"Vendor compat fetch returned invalid JSON error payload.",
		);
		const errorCode = parseErrorCode(payload);
		if (errorCode) {
			throw new ChatbotError(
				errorCode,
				parseErrorMessage(payload, response.statusText || "Request failed."),
			);
		}

		throw new Error(parseErrorMessage(payload, response.statusText || "Request failed."));
	}
	const payload = await parseJsonResponse(response, "Vendor compat fetch returned invalid JSON.");

	return new Response(JSON.stringify(payload), {
		headers: response.headers,
		status: response.status,
		statusText: response.statusText,
	});
}

export function getDocumentTimestampByIndex(documents: Document[], index: number) {
	if (documents.length === 0 || index >= documents.length) {
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
