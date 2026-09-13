import {
	OpsChatConversationSchema,
	OpsConversationListResponseSchema,
} from "campus-contracts/chat-conversations";
import { fetchJson } from "./core";

export async function fetchChatConversations(search: URLSearchParams, signal?: AbortSignal) {
	return OpsConversationListResponseSchema.parse(
		await fetchJson(`/api/ops/chat-conversations?${search.toString()}`, { signal }),
	);
}

export async function fetchChatConversation(id: string, signal?: AbortSignal) {
	return OpsChatConversationSchema.parse(
		await fetchJson(`/api/ops/chat-conversations/${encodeURIComponent(id)}`, { signal }),
	);
}
