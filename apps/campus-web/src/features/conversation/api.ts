import { createIdempotencyKey, requestJson, UnauthorizedError } from "@/platform/api/client";
import type {
	ChatAnswerPayload,
	ChatRequestStreamEvent,
	ChatRequestStreamEventName,
	ConversationDetail,
	ConversationSummary,
	SessionPrincipal,
} from "./model";

export async function getSessionPrincipal(): Promise<SessionPrincipal> {
	return requestJson<SessionPrincipal>({
		path: "/api/me",
	});
}

export async function listConversations(): Promise<ConversationSummary[]> {
	const payload = await requestJson<{ conversations: ConversationSummary[] }>({
		path: "/api/chat/conversations",
	});
	return payload.conversations;
}

export async function getConversationDetail(conversationId: string): Promise<ConversationDetail> {
	const payload = await requestJson<{ conversation: ConversationDetail }>({
		path: `/api/chat/conversations/${encodeURIComponent(conversationId)}`,
	});
	return payload.conversation;
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
		throw new Error(response.statusText || "请求失败。");
	}
	if (!response.body) {
		throw new Error("Lifecycle stream response body is empty.");
	}

	for await (const event of parseProductSse(response)) {
		yield event;
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
		value === "execution.queued" ||
		value === "execution.running" ||
		value === "request.accepted" ||
		value === "request.cancelled" ||
		value === "request.completed" ||
		value === "request.failed"
	);
}
