import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type { ChatMessageFeedbackReasonCode, ChatMessageFeedbackVote } from "./model";
import type { ChatConversationListView } from "./store";

const MESSAGE_FEEDBACK_REASON_CODES = new Set<ChatMessageFeedbackReasonCode>([
	"wrong_intent",
	"not_enough_detail",
	"outdated_or_missing_source",
	"incorrect_answer",
	"unclear_or_hard_to_use",
	"other",
]);

export function createChatRouteError(input: {
	code: string;
	message: string;
	status: number;
}): AppApiRouteError {
	return new AppApiRouteError({
		code: input.code,
		message: input.message,
		retryable: false,
		status: input.status,
	});
}

export function assertChatPrincipal(principal: ResolvedAppPrincipal): string {
	if (!principal.permissions.chat) {
		throw createChatRouteError({
			code: "forbidden",
			message: "Chat access is not available for this principal.",
			status: 403,
		});
	}

	return principal.principal.principalId;
}

export function normalizeConversationLimit(input: {
	defaultLimit: number;
	limit?: number;
	maxLimit: number;
}): number {
	if (input.limit === undefined) {
		return input.defaultLimit;
	}
	if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > input.maxLimit) {
		throw createChatRouteError({
			code: "invalid_conversation_limit",
			message: `limit must be an integer from 1 to ${input.maxLimit}.`,
			status: 400,
		});
	}
	return input.limit;
}

export function normalizeConversationView(
	view: ChatConversationListView | undefined,
): ChatConversationListView {
	return view ?? "active";
}

export function normalizeConversationTitle(title: string): string {
	const trimmed = title.trim();
	if (trimmed.length === 0 || trimmed.length > 80) {
		throw createChatRouteError({
			code: "invalid_conversation_title",
			message: "Conversation title must be 1 to 80 characters.",
			status: 400,
		});
	}
	return trimmed;
}

export function normalizeSearchQuery(query: string): string {
	const trimmed = query.trim();
	if (trimmed.length === 0 || trimmed.length > 80) {
		throw createChatRouteError({
			code: "invalid_conversation_search_query",
			message: "Search query must be 1 to 80 characters.",
			status: 400,
		});
	}
	return trimmed;
}

export function normalizeMessageFeedbackReasonCodes(input: {
	reasonCodes?: string[];
	vote: ChatMessageFeedbackVote;
}): ChatMessageFeedbackReasonCode[] {
	const rawReasonCodes = input.reasonCodes ?? [];
	if (!Array.isArray(rawReasonCodes)) {
		throw createChatRouteError({
			code: "invalid_message_feedback",
			message: "reasonCodes must be an array.",
			status: 400,
		});
	}

	const reasonCodes = rawReasonCodes.map((reasonCode) => reasonCode.trim());
	if (input.vote === "helpful" && reasonCodes.length > 0) {
		throw createChatRouteError({
			code: "invalid_message_feedback",
			message: "reasonCodes are only accepted for unhelpful feedback.",
			status: 400,
		});
	}
	if (reasonCodes.length > 3) {
		throw createChatRouteError({
			code: "invalid_message_feedback",
			message: "reasonCodes cannot contain more than 3 values.",
			status: 400,
		});
	}

	const seen = new Set<string>();
	for (const reasonCode of reasonCodes) {
		if (
			!MESSAGE_FEEDBACK_REASON_CODES.has(reasonCode as ChatMessageFeedbackReasonCode) ||
			seen.has(reasonCode)
		) {
			throw createChatRouteError({
				code: "invalid_message_feedback",
				message: "reasonCodes must be unique supported feedback reason codes.",
				status: 400,
			});
		}
		seen.add(reasonCode);
	}

	return reasonCodes as ChatMessageFeedbackReasonCode[];
}
