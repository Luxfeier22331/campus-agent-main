import { createIdempotencyKey, requestJson, UnauthorizedError } from "@/platform/api/client";
import type {
	ChatAnswerPayload,
	ChatRequestStreamEvent,
	ChatRequestStreamEventName,
	ConversationDetail,
	ConversationSummary,
	MessageFeedbackReasonCode,
	MessageFeedbackResult,
	MessageFeedbackVote,
} from "./model";

const DEFAULT_CHAT_STREAM_ERROR_MESSAGE = "请求失败，请稍后重试。";

export class ChatStreamRequestError extends Error {
	code: string;
	requestId?: string;
	retryable: boolean;
	status?: number;
	traceId?: string;

	constructor(input: {
		code: string;
		message: string;
		requestId?: string;
		retryable: boolean;
		status?: number;
		traceId?: string;
	}) {
		super(input.message);
		this.name = "ChatStreamRequestError";
		this.code = input.code;
		this.requestId = input.requestId;
		this.retryable = input.retryable;
		this.status = input.status;
		this.traceId = input.traceId;
	}
}

export async function listConversations(
	input: { limit?: number; view?: "active" | "archived" } = {},
): Promise<ConversationSummary[]> {
	const params = new URLSearchParams();
	if (input.view) {
		params.set("view", input.view);
	}
	if (input.limit !== undefined) {
		params.set("limit", String(input.limit));
	}
	const suffix = params.size > 0 ? `?${params.toString()}` : "";
	const payload = await requestJson<{ conversations: ConversationSummary[] }>({
		path: `/api/chat/conversations${suffix}`,
	});
	return payload.conversations;
}

export async function searchConversations(input: {
	limit?: number;
	query: string;
	view?: "active" | "archived";
}): Promise<{ query: string; conversations: ConversationSummary[] }> {
	const query = input.query.trim();
	const params = new URLSearchParams({
		q: query,
		view: input.view ?? "active",
	});
	if (input.limit !== undefined) {
		params.set("limit", String(input.limit));
	}
	return requestJson<{ query: string; conversations: ConversationSummary[] }>({
		path: `/api/chat/conversations/search?${params.toString()}`,
	});
}

export async function getConversationDetail(conversationId: string): Promise<ConversationDetail> {
	const payload = await requestJson<{ conversation: ConversationDetail }>({
		path: `/api/chat/conversations/${encodeURIComponent(conversationId)}`,
	});
	return normalizeConversationDetail(payload.conversation);
}

export async function createConversationDraft(): Promise<ConversationDetail> {
	const payload = await requestJson<{ conversation: ConversationDetail }>({
		method: "POST",
		path: "/api/chat/conversations",
	});
	return normalizeConversationDetail(payload.conversation);
}

export async function renameConversation(input: {
	conversationId: string;
	title: string;
}): Promise<ConversationSummary> {
	const payload = await requestJson<{ conversation: ConversationSummary }>({
		body: JSON.stringify({ title: input.title }),
		headers: {
			"content-type": "application/json",
		},
		method: "PATCH",
		path: `/api/chat/conversations/${encodeURIComponent(input.conversationId)}`,
	});
	return payload.conversation;
}

export async function pinConversation(conversationId: string): Promise<ConversationSummary> {
	return mutateConversationSummary(
		`/api/chat/conversations/${encodeURIComponent(conversationId)}/pin`,
		"POST",
	);
}

export async function unpinConversation(conversationId: string): Promise<ConversationSummary> {
	return mutateConversationSummary(
		`/api/chat/conversations/${encodeURIComponent(conversationId)}/pin`,
		"DELETE",
	);
}

export async function archiveConversation(conversationId: string): Promise<ConversationSummary> {
	return mutateConversationSummary(
		`/api/chat/conversations/${encodeURIComponent(conversationId)}/archive`,
		"POST",
	);
}

export async function unarchiveConversation(conversationId: string): Promise<ConversationSummary> {
	return mutateConversationSummary(
		`/api/chat/conversations/${encodeURIComponent(conversationId)}/archive`,
		"DELETE",
	);
}

async function mutateConversationSummary(
	path: string,
	method: "DELETE" | "POST",
): Promise<ConversationSummary> {
	const payload = await requestJson<{ conversation: ConversationSummary }>({
		method,
		path,
	});
	return payload.conversation;
}

function normalizeConversationDetail(conversation: ConversationDetail): ConversationDetail {
	return {
		...conversation,
		archivedAt: conversation.archivedAt ?? null,
		pinnedAt: conversation.pinnedAt ?? null,
	};
}

export async function deleteConversation(conversationId: string): Promise<void> {
	await requestNoContent({
		method: "DELETE",
		path: `/api/chat/conversations/${encodeURIComponent(conversationId)}`,
	});
}

export async function submitChatRequest(input: {
	conversationId?: string;
	prompt: string;
}): Promise<ChatAnswerPayload> {
	const body = input.conversationId?.trim()
		? { conversationId: input.conversationId, prompt: input.prompt.trim() }
		: { prompt: input.prompt.trim() };
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

export async function submitMessageFeedback(input: {
	conversationId: string;
	messageId: string;
	reasonCodes?: MessageFeedbackReasonCode[];
	vote: MessageFeedbackVote;
}): Promise<MessageFeedbackResult> {
	return requestJson<MessageFeedbackResult>({
		body: JSON.stringify({
			reasonCodes: input.reasonCodes ?? [],
			vote: input.vote,
		}),
		headers: {
			"content-type": "application/json",
		},
		method: "PUT",
		path: `/api/chat/conversations/${encodeURIComponent(
			input.conversationId,
		)}/messages/${encodeURIComponent(input.messageId)}/feedback`,
	});
}

export async function deleteMessageFeedback(input: {
	conversationId: string;
	messageId: string;
}): Promise<void> {
	const response = await fetch(
		`/api/chat/conversations/${encodeURIComponent(input.conversationId)}/messages/${encodeURIComponent(
			input.messageId,
		)}/feedback`,
		{
			credentials: "same-origin",
			method: "DELETE",
		},
	);
	if (response.status === 401) {
		throw new UnauthorizedError();
	}
	if (!response.ok) {
		throw new Error(response.statusText || "撤回反馈失败。");
	}
}

export async function deleteTrailingMessages(input: {
	conversationId: string;
	messageId: string;
}): Promise<void> {
	await requestNoContent({
		method: "DELETE",
		path: `/api/chat/conversations/${encodeURIComponent(
			input.conversationId,
		)}/messages/${encodeURIComponent(input.messageId)}/trailing`,
	});
}

export async function cancelRun(runId: string): Promise<void> {
	await requestJson({
		body: JSON.stringify({ reason: "user_requested" }),
		headers: {
			"content-type": "application/json",
		},
		method: "POST",
		path: `/api/chat/runs/${encodeURIComponent(runId)}/cancel`,
	});
}

export async function* submitChatRequestStream(input: {
	conversationId?: string;
	prompt: string;
	signal?: AbortSignal;
}): AsyncIterable<ChatRequestStreamEvent> {
	const body = input.conversationId?.trim()
		? { conversationId: input.conversationId, prompt: input.prompt.trim() }
		: { prompt: input.prompt.trim() };
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
		throw new UnauthorizedError();
	}
	if (!response.ok) {
		throw await createChatStreamRequestError(response);
	}
	if (!response.body) {
		throw new Error("Lifecycle stream response body is empty.");
	}

	for await (const event of parseProductSse(response)) {
		yield event;
	}
}

export async function* resumeRunEventsStream(input: {
	afterSequence?: number;
	runId: string;
	signal?: AbortSignal;
}): AsyncIterable<ChatRequestStreamEvent> {
	const params = new URLSearchParams();
	if (input.afterSequence !== undefined) {
		params.set("after_sequence", String(input.afterSequence));
	}
	const suffix = params.size > 0 ? `?${params.toString()}` : "";
	const response = await fetch(
		`/api/chat/runs/${encodeURIComponent(input.runId)}/events/stream${suffix}`,
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
		throw new UnauthorizedError();
	}
	if (!response.ok) {
		throw new Error(response.statusText || "恢复回答失败。");
	}
	if (!response.body) {
		throw new Error("Run event stream response body is empty.");
	}

	for await (const event of parseProductSse(response)) {
		yield event;
	}
}

async function requestNoContent(input: { method: "DELETE"; path: string }): Promise<void> {
	const response = await fetch(input.path, {
		credentials: "same-origin",
		method: input.method,
	});
	if (response.status === 401) {
		throw new UnauthorizedError();
	}
	if (!response.ok) {
		throw new Error(response.statusText || "请求失败。");
	}
}

async function* parseProductSse(response: Response): AsyncIterable<ChatRequestStreamEvent> {
	const reader = response.body?.getReader();
	if (!reader) {
		return;
	}

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

function parseSseBlock(block: string): ChatRequestStreamEvent | null {
	let event: ChatRequestStreamEventName | null = null;
	const dataLines: string[] = [];
	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) {
			const name = line.slice("event:".length).trim();
			if (isProductStreamEventName(name)) {
				event = name;
			}
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}
	if (!(event && dataLines.length > 0)) {
		return null;
	}
	return {
		data: JSON.parse(dataLines.join("\n")) as ChatRequestStreamEvent["data"],
		event,
	};
}

function isProductStreamEventName(value: string): value is ChatRequestStreamEventName {
	return (
		value === "answer.delta" ||
		value === "execution.queued" ||
		value === "execution.running" ||
		value === "request.accepted" ||
		value === "request.cancelled" ||
		value === "request.completed" ||
		value === "request.failed"
	);
}

async function createChatStreamRequestError(response: Response): Promise<ChatStreamRequestError> {
	const payload = await readJsonErrorPayload(response);
	const errorPayload =
		payload &&
		typeof payload === "object" &&
		"error" in payload &&
		payload.error &&
		typeof payload.error === "object"
			? payload.error
			: null;
	const message =
		readStringField(errorPayload, "message") ||
		response.statusText ||
		DEFAULT_CHAT_STREAM_ERROR_MESSAGE;
	return new ChatStreamRequestError({
		code: readStringField(errorPayload, "code") ?? "chat_stream_request_failed",
		message,
		requestId: readStringField(errorPayload, "requestId"),
		retryable: readBooleanField(errorPayload, "retryable") ?? response.status >= 500,
		status: response.status,
		traceId: readStringField(errorPayload, "traceId"),
	});
}

async function readJsonErrorPayload(response: Response): Promise<unknown> {
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		return null;
	}
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function readStringField(input: object | null, field: string): string | undefined {
	if (!(input && field in input)) {
		return;
	}
	const value = (input as Record<string, unknown>)[field];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function readBooleanField(input: object | null, field: string): boolean | undefined {
	if (!(input && field in input)) {
		return;
	}
	const value = (input as Record<string, unknown>)[field];
	return typeof value === "boolean" ? value : undefined;
}
