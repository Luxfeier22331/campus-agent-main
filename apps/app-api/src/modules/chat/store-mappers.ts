import { and, eq, isNotNull, isNull } from "drizzle-orm";

import {
	conversations,
	type messageFeedback,
	type messages,
	type sessionSlots,
} from "../../db/schema";
import type {
	ChatConversation,
	ChatConversationSummary,
	ChatMessage,
	ChatMessageFeedback,
	ChatSessionSlot,
} from "./model";
import { normalizeChatStructuredParts } from "./model";
import type { ChatConversationListView } from "./store-contract";

function toIsoString(value: Date): string {
	return value.toISOString();
}

export function toChatFeedback(row: typeof messageFeedback.$inferSelect): ChatMessageFeedback {
	return {
		createdAt: toIsoString(row.createdAt),
		feedbackId: row.feedbackId,
		messageId: row.messageId,
		reasonCodes: row.reasonCodesJson as ChatMessageFeedback["reasonCodes"],
		updatedAt: toIsoString(row.updatedAt),
		vote: row.vote as ChatMessageFeedback["vote"],
	};
}

export function toChatMessage(
	row: typeof messages.$inferSelect,
	feedbackByMessageId: Map<string, ChatMessageFeedback> = new Map(),
): ChatMessage {
	const message: ChatMessage = {
		id: row.id,
		conversationId: row.conversationId,
		role: row.role as ChatMessage["role"],
		kind: (row.kind as ChatMessage["kind"]) ?? null,
		text: row.text,
		createdAt: toIsoString(row.createdAt),
		parentMessageId: row.parentMessageId ?? null,
		requestId: row.requestId ?? null,
		retryable: row.retryable ?? null,
		branchId: row.branchId ?? "branch_active",
		turnSequence: row.turnSequence ?? 0,
		isActiveBranchHead: row.isActiveBranchHead ?? false,
		structuredParts: normalizeChatStructuredParts(row.structuredPartsJson),
	};
	if (message.role === "assistant") {
		message.feedback = feedbackByMessageId.get(message.id) ?? null;
	}
	return message;
}

export function toChatConversationSummary(
	row: typeof conversations.$inferSelect,
): ChatConversationSummary {
	return {
		id: row.id,
		title: row.title,
		createdAt: toIsoString(row.createdAt),
		updatedAt: toIsoString(row.updatedAt),
		archivedAt: row.archivedAt ? toIsoString(row.archivedAt) : null,
		pinnedAt: row.pinnedAt ? toIsoString(row.pinnedAt) : null,
	};
}

export function escapeIlikePattern(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function createConversationMatchSnippet(text: string, query: string): string | null {
	const normalizedText = text.replace(/\s+/g, " ").trim();
	const normalizedQuery = query.replace(/\s+/g, " ").trim();
	if (!(normalizedText && normalizedQuery)) {
		return null;
	}

	const matchIndex = normalizedText
		.toLocaleLowerCase()
		.indexOf(normalizedQuery.toLocaleLowerCase());
	const startIndex = matchIndex < 0 ? 0 : Math.max(0, matchIndex - 64);
	const endIndex =
		matchIndex < 0
			? Math.min(normalizedText.length, 160)
			: Math.min(normalizedText.length, matchIndex + normalizedQuery.length + 96);
	let snippet = normalizedText.slice(startIndex, endIndex);
	if (startIndex > 0) {
		snippet = `…${snippet}`;
	}
	if (endIndex < normalizedText.length) {
		snippet = `${snippet}…`;
	}
	return snippet.slice(0, 160);
}

export function buildConversationViewCondition(input: {
	ownerUserId: string;
	view: ChatConversationListView;
}) {
	const archiveCondition =
		input.view === "archived"
			? isNotNull(conversations.archivedAt)
			: isNull(conversations.archivedAt);
	return and(
		eq(conversations.ownerUserId, input.ownerUserId),
		isNull(conversations.deletedAt),
		archiveCondition,
	);
}

export function toChatConversation(
	row: typeof conversations.$inferSelect,
	messageRows: (typeof messages.$inferSelect)[],
	sessionSlotRows: (typeof sessionSlots.$inferSelect)[],
	feedbackRows: (typeof messageFeedback.$inferSelect)[] = [],
): ChatConversation {
	const feedbackByMessageId = new Map(
		feedbackRows.map((feedbackRow) => [feedbackRow.messageId, toChatFeedback(feedbackRow)]),
	);
	return {
		id: row.id,
		ownerUserId: row.ownerUserId,
		title: row.title,
		createdAt: toIsoString(row.createdAt),
		updatedAt: toIsoString(row.updatedAt),
		activeBranchId: row.activeBranchId ?? "branch_active",
		activeMessageId: row.activeMessageId ?? null,
		activeRequestId: row.activeRequestId ?? null,
		activeTurnSequence: row.activeTurnSequence ?? 0,
		sessionSlots: sessionSlotRows.map(
			(slot): ChatSessionSlot => ({
				confirmed: slot.confirmed,
				name: slot.name,
				updatedAt: toIsoString(slot.updatedAt),
				value: slot.value,
			}),
		),
		messages: messageRows.map((messageRow) => toChatMessage(messageRow, feedbackByMessageId)),
	};
}
