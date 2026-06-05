import type {
	ChatAnswerPayload,
	ChatMessageFeedback,
	ChatMessageFeedbackReasonCode,
	ChatMessageFeedbackVote,
	ConversationDetail,
	ConversationSummary,
	SessionPrincipal,
} from "./api-types";
import type { ChatRunEventProjection, ChatRunPhase } from "./types";

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

function isJsonContentType(contentType: string): boolean {
	return contentType.toLowerCase().includes("application/json");
}

async function readRequiredJson(response: Response, invalidMessage: string): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		throw new Error(invalidMessage);
	}
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
		runId?: string | null;
		runPhase?: ChatRunPhase;
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
	const payload =
		response.status === 204
			? undefined
			: isJsonContentType(contentType)
				? await readRequiredJson(response, "App API returned invalid JSON.")
				: undefined;

	if (response.status === 401) {
		throw new UnauthorizedError(parseErrorMessage(payload, response.statusText));
	}

	if (!response.ok) {
		throw new Error(parseErrorMessage(payload, response.statusText));
	}

	if (response.status !== 204 && !isJsonContentType(contentType)) {
		throw new Error("App API returned a non-JSON response.");
	}

	return payload as T;
}

function parseSseBlock<T>(
	block: string,
	isKnownEvent: (eventName: string) => boolean,
): {
	data: T;
	event: string;
} | null {
	let event: ChatRequestStreamEventName | null = null;
	const dataLines: string[] = [];

	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) {
			const eventName = line.slice("event:".length).trim();
			if (isKnownEvent(eventName)) {
				event = eventName as ChatRequestStreamEventName;
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
		data: JSON.parse(dataLines.join("\n")) as T,
		event,
	};
}

function isProductStreamEventName(eventName: string): eventName is ChatRequestStreamEventName {
	return (
		eventName === "request.accepted" ||
		eventName === "execution.queued" ||
		eventName === "execution.running" ||
		eventName === "request.completed" ||
		eventName === "request.failed" ||
		eventName === "request.cancelled"
	);
}

function isDurableRunEventName(eventName: string): boolean {
	return eventName.trim().length > 0 && !isProductStreamEventName(eventName);
}

async function* parseSse<T>(
	response: Response,
	isKnownEvent: (eventName: string) => boolean,
): AsyncIterable<{ data: T; event: string }> {
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
				const parsed = parseSseBlock<T>(block, isKnownEvent);
				if (parsed) {
					yield parsed;
				}
				boundary = buffer.search(/\r?\n\r?\n/);
			}
		}

		buffer += decoder.decode();
		const parsed = parseSseBlock<T>(buffer.trim(), isKnownEvent);
		if (parsed) {
			yield parsed;
		}
	} finally {
		reader.releaseLock();
	}
}

async function* parseProductSse(response: Response): AsyncIterable<ChatRequestStreamEvent> {
	for await (const event of parseSse<ChatRequestStreamEvent["data"]>(
		response,
		isProductStreamEventName,
	)) {
		yield {
			data: event.data,
			event: event.event as ChatRequestStreamEventName,
		};
	}
}

async function* parseRunEventSse(response: Response): AsyncIterable<ChatRunEventProjection> {
	for await (const event of parseSse<ChatRunEventProjection>(response, isDurableRunEventName)) {
		yield event.data;
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

export async function setMessageFeedback(input: {
	conversationId: string;
	messageId: string;
	reasonCodes?: ChatMessageFeedbackReasonCode[];
	vote: ChatMessageFeedbackVote;
}): Promise<ChatMessageFeedback> {
	const body = {
		...(input.reasonCodes ? { reasonCodes: input.reasonCodes } : {}),
		vote: input.vote,
	};
	const payload = await requestJson<{ feedback: ChatMessageFeedback }>({
		body: JSON.stringify(body),
		headers: {
			"content-type": "application/json",
		},
		method: "PUT",
		path: `/api/chat/conversations/${input.conversationId}/messages/${input.messageId}/feedback`,
	});

	return payload.feedback;
}

export async function deleteMessageFeedback(input: {
	conversationId: string;
	messageId: string;
}): Promise<void> {
	await requestJson<void>({
		method: "DELETE",
		path: `/api/chat/conversations/${input.conversationId}/messages/${input.messageId}/feedback`,
	});
}

export async function deleteConversation(conversationId: string): Promise<void> {
	await requestJson<{ deleted: true }>({
		method: "DELETE",
		path: `/api/chat?id=${encodeURIComponent(conversationId)}`,
	});
}

export async function deleteAllConversations(): Promise<{ deletedCount: number }> {
	return requestJson<{ deletedCount: number }>({
		method: "DELETE",
		path: "/api/history",
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
		const payload = isJsonContentType(response.headers.get("content-type") ?? "")
			? await readRequiredJson(response, "App API returned invalid JSON error payload.")
			: undefined;
		throw new UnauthorizedError(parseErrorMessage(payload, response.statusText));
	}

	if (!response.ok) {
		const contentType = response.headers.get("content-type") ?? "";
		const payload = isJsonContentType(contentType)
			? await readRequiredJson(response, "App API returned invalid JSON error payload.")
			: await response.text();
		throw new Error(parseErrorMessage(payload, response.statusText));
	}

	for await (const event of parseProductSse(response)) {
		yield event;
	}
}

export async function* subscribeChatRunEventStream(input: {
	afterSequence?: number;
	runId: string;
	signal?: AbortSignal;
}): AsyncIterable<ChatRunEventProjection> {
	const runId = input.runId.trim();
	if (!runId) {
		throw new Error("runId is required.");
	}
	if (
		input.afterSequence !== undefined &&
		(!Number.isInteger(input.afterSequence) || input.afterSequence < 0)
	) {
		throw new Error("afterSequence must be a non-negative integer.");
	}

	const params = new URLSearchParams();
	if (input.afterSequence !== undefined) {
		params.set("after_sequence", String(input.afterSequence));
	}
	const response = await fetch(
		`/api/chat/runs/${encodeURIComponent(runId)}/events/stream${params.toString() ? `?${params.toString()}` : ""}`,
		{
			credentials: "same-origin",
			headers: {
				accept: "text/event-stream",
			},
			method: "GET",
			signal: input.signal,
		},
	);

	if (response.status === 401) {
		const payload = isJsonContentType(response.headers.get("content-type") ?? "")
			? await readRequiredJson(response, "App API returned invalid JSON error payload.")
			: undefined;
		throw new UnauthorizedError(parseErrorMessage(payload, response.statusText));
	}

	if (!response.ok) {
		const contentType = response.headers.get("content-type") ?? "";
		const payload = isJsonContentType(contentType)
			? await readRequiredJson(response, "App API returned invalid JSON error payload.")
			: await response.text();
		throw new Error(parseErrorMessage(payload, response.statusText));
	}

	for await (const event of parseRunEventSse(response)) {
		yield event;
	}
}
