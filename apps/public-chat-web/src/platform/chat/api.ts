import type {
	ChatAnswerPayload,
	ConversationDetail,
	ConversationSummary,
	SessionPrincipal,
} from "./api-types";

export class UnauthorizedError extends Error {
	constructor(message = "请先登录。") {
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

	return statusText || "请求失败。";
}

export type ChatRequestStreamEventName =
	| "request.accepted"
	| "execution.queued"
	| "execution.running"
	| "request.completed"
	| "request.failed"
	| "request.cancelled";

export interface ChatRequestStreamEvent {
	data: {
		answer?: ChatAnswerPayload;
		error?: {
			code: string;
			message: string;
			retryable?: boolean;
		};
		occurredAt: string;
		requestId: string;
		status: string;
		traceId: string;
	};
	event: ChatRequestStreamEventName;
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

function parseSseBlock(block: string): ChatRequestStreamEvent | null {
	let event: ChatRequestStreamEventName | null = null;
	const dataLines: string[] = [];

	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) {
			const eventName = line.slice("event:".length).trim();
			if (
				eventName === "request.accepted" ||
				eventName === "execution.queued" ||
				eventName === "execution.running" ||
				eventName === "request.completed" ||
				eventName === "request.failed" ||
				eventName === "request.cancelled"
			) {
				event = eventName;
			}
			continue;
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}

	if (!event || dataLines.length === 0) {
		return null;
	}

	return {
		data: JSON.parse(dataLines.join("\n")) as ChatRequestStreamEvent["data"],
		event,
	};
}

async function* parseProductSse(response: Response): AsyncIterable<ChatRequestStreamEvent> {
	if (!response.body) {
		throw new Error("Lifecycle stream response body is empty.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) {
				break;
			}

			buffer += decoder.decode(chunk.value, { stream: true });
			let boundary = buffer.search(/\r?\n\r?\n/);
			while (boundary >= 0) {
				const block = buffer.slice(0, boundary);
				const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
				buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
				const parsed = parseSseBlock(block);
				if (parsed) {
					yield parsed;
				}
				boundary = buffer.search(/\r?\n\r?\n/);
			}
		}

		buffer += decoder.decode();
		const parsed = parseSseBlock(buffer.trim());
		if (parsed) {
			yield parsed;
		}
	} finally {
		reader.releaseLock();
	}
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

export async function deleteTrailingMessages(
	conversationId: string,
	messageId: string,
): Promise<void> {
	await requestJson<void>({
		method: "DELETE",
		path: `/api/chat/conversations/${conversationId}/messages/${messageId}/trailing`,
	});
}

export async function submitChatRequest(input: {
	conversationId?: string;
	prompt: string;
}): Promise<ChatAnswerPayload> {
	const body = input.conversationId?.trim()
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

export async function* submitChatRequestStream(input: {
	conversationId?: string;
	prompt: string;
	signal?: AbortSignal;
}): AsyncIterable<ChatRequestStreamEvent> {
	const body = input.conversationId?.trim()
		? {
				conversationId: input.conversationId,
				prompt: input.prompt.trim(),
			}
		: {
				prompt: input.prompt.trim(),
			};

	const response = await fetch("/api/chat/requests/stream", {
		body: JSON.stringify(body),
		credentials: "same-origin",
		headers: {
			accept: "text/event-stream",
			"content-type": "application/json",
			"idempotency-key": createIdempotencyKey(),
		},
		method: "POST",
		signal: input.signal,
	});

	if (response.status === 401) {
		const payload = await response.json().catch(() => undefined);
		throw new UnauthorizedError(parseErrorMessage(payload, response.statusText));
	}

	if (!response.ok) {
		const contentType = response.headers.get("content-type") ?? "";
		const payload = contentType.includes("application/json")
			? await response.json().catch(() => undefined)
			: await response.text().catch(() => undefined);
		throw new Error(parseErrorMessage(payload, response.statusText));
	}

	for await (const event of parseProductSse(response)) {
		yield event;
	}
}
