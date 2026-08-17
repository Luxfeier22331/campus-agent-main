import { createIdempotencyKey, requestJson, UnauthorizedError } from "@/platform/api/client";
import type {
	ChatAnswerPayload,
	ConversationDetail,
	ConversationSearchResult,
	ConversationSummary,
	MessageFeedbackReasonCode,
	MessageFeedbackResult,
	MessageFeedbackVote,
} from "./model";

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
	signal?: AbortSignal;
	view?: "active" | "archived";
}): Promise<{ query: string; conversations: ConversationSearchResult[] }> {
	const query = input.query.trim();
	const params = new URLSearchParams({
		q: query,
		view: input.view ?? "active",
	});
	if (input.limit !== undefined) {
		params.set("limit", String(input.limit));
	}
	return requestJson<{ query: string; conversations: ConversationSearchResult[] }>({
		path: `/api/chat/conversations/search?${params.toString()}`,
		...(input.signal ? { signal: input.signal } : {}),
	});
}

export async function getConversationDetail(
	conversationId: string,
	signal?: AbortSignal,
): Promise<ConversationDetail> {
	const payload = await requestJson<{ conversation: ConversationDetail }>({
		path: `/api/chat/conversations/${encodeURIComponent(conversationId)}`,
		...(signal ? { signal } : {}),
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
