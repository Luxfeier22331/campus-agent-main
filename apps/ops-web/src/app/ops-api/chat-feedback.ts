import {
	ChatFeedbackDetailSchema,
	ChatFeedbackPageSchema,
	type ChatFeedbackQuery,
} from "campus-contracts/chat-feedback";
import { fetchJson, queryString } from "./core";

export async function fetchChatFeedback(query: ChatFeedbackQuery, signal?: AbortSignal) {
	return ChatFeedbackPageSchema.parse(
		await fetchJson(`/api/ops/chat-feedback${queryString(query)}`, { signal }),
	);
}

export async function fetchChatFeedbackDetail(id: string, signal?: AbortSignal) {
	return ChatFeedbackDetailSchema.parse(
		await fetchJson(`/api/ops/chat-feedback/${encodeURIComponent(id)}`, { signal }),
	);
}
