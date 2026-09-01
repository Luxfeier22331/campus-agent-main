import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { conversations, messageFeedback, messages, sessionSlots } from "../../db/schema";
import type { ChatConversationStoreContext } from "./store-context";
import type { ChatConversationStore } from "./store-contract";
import {
	buildConversationViewCondition,
	createConversationMatchSnippet,
	escapeIlikePattern,
	toChatConversation,
	toChatConversationSummary,
} from "./store-mappers";

export async function loadChatConversation(
	context: ChatConversationStoreContext,
	ownerUserId: string,
	conversationId: string,
) {
	const db = await context.getDb();
	const conversationRows = await db
		.select()
		.from(conversations)
		.where(
			and(
				eq(conversations.id, conversationId),
				eq(conversations.ownerUserId, ownerUserId),
				isNull(conversations.deletedAt),
			),
		)
		.limit(1);
	const conversationRow = conversationRows[0];
	if (!conversationRow) {
		return null;
	}

	const messageRows = await db
		.select()
		.from(messages)
		.where(eq(messages.conversationId, conversationId))
		.orderBy(asc(messages.createdAt));

	const sessionSlotRows = await db
		.select()
		.from(sessionSlots)
		.where(eq(sessionSlots.conversationId, conversationId))
		.orderBy(asc(sessionSlots.name));

	const assistantMessageIds = messageRows
		.filter((messageRow) => messageRow.role === "assistant")
		.map((messageRow) => messageRow.id);
	const feedbackRows =
		assistantMessageIds.length === 0
			? []
			: await db
					.select()
					.from(messageFeedback)
					.where(
						and(
							eq(messageFeedback.ownerUserId, ownerUserId),
							inArray(messageFeedback.messageId, assistantMessageIds),
						),
					);

	return toChatConversation(conversationRow, messageRows, sessionSlotRows, feedbackRows);
}

type ChatConversationReadStore = Pick<
	ChatConversationStore,
	| "getConversationByOwner"
	| "getConversationDetailByOwner"
	| "listConversationSummariesByOwner"
	| "listConversationSummariesPageByOwner"
	| "searchConversationSummariesByOwner"
>;

export function createPgChatConversationReadStore(
	context: ChatConversationStoreContext,
): ChatConversationReadStore {
	return {
		async listConversationSummariesByOwner(input) {
			const db = await context.getDb();
			const rows = await db
				.select()
				.from(conversations)
				.where(buildConversationViewCondition(input))
				.orderBy(
					sql`${conversations.pinnedAt} IS NULL`,
					desc(conversations.pinnedAt),
					desc(conversations.updatedAt),
				)
				.limit(input.limit);

			return rows.map(toChatConversationSummary);
		},

		async listConversationSummariesPageByOwner(input) {
			const db = await context.getDb();
			const rows = await db
				.select()
				.from(conversations)
				.where(
					and(
						eq(conversations.ownerUserId, input.ownerUserId),
						isNull(conversations.deletedAt),
						isNull(conversations.archivedAt),
					),
				)
				.orderBy(
					sql`${conversations.pinnedAt} IS NULL`,
					desc(conversations.pinnedAt),
					desc(conversations.updatedAt),
				);

			const summaries = rows.map(toChatConversationSummary);
			const startIndex = input.endingBeforeConversationId
				? summaries.findIndex(
						(conversation) => conversation.id === input.endingBeforeConversationId,
					) + 1
				: 0;

			const normalizedStartIndex = startIndex > 0 ? startIndex : 0;
			const page = summaries.slice(normalizedStartIndex, normalizedStartIndex + input.limit);
			const hasMore = normalizedStartIndex + input.limit < summaries.length;

			return {
				conversations: page,
				hasMore,
			};
		},

		async getConversationDetailByOwner(ownerUserId, conversationId) {
			return loadChatConversation(context, ownerUserId, conversationId);
		},

		async getConversationByOwner(ownerUserId, conversationId) {
			return loadChatConversation(context, ownerUserId, conversationId);
		},

		async searchConversationSummariesByOwner(input) {
			const db = await context.getDb();
			const pattern = `%${escapeIlikePattern(input.query)}%`;
			const titleMatches = sql<boolean>`${conversations.title} ILIKE ${pattern} ESCAPE ${"\\"}`;
			const latestMatchedMessage = db
				.select({ text: messages.text })
				.from(messages)
				.where(
					and(
						eq(messages.conversationId, conversations.id),
						sql`${messages.text} ILIKE ${pattern} ESCAPE ${"\\"}`,
					),
				)
				.orderBy(desc(messages.createdAt), desc(messages.id))
				.limit(1);
			const messageMatches = sql<boolean>`EXISTS (
				SELECT 1
				FROM ${messages}
				WHERE ${messages.conversationId} = ${conversations.id}
					AND ${messages.text} ILIKE ${pattern} ESCAPE ${"\\"}
			)`;
			const matchedMessageText = sql<string | null>`CASE
				WHEN ${titleMatches} THEN NULL
				ELSE (${latestMatchedMessage})
			END`;
			const rows = await db
				.select({ conversation: conversations, matchedMessageText })
				.from(conversations)
				.where(and(buildConversationViewCondition(input), or(titleMatches, messageMatches)))
				.orderBy(
					sql`${conversations.pinnedAt} IS NULL`,
					desc(conversations.pinnedAt),
					desc(conversations.updatedAt),
				)
				.limit(input.limit);

			return rows.map((row) => {
				const conversation = toChatConversationSummary(row.conversation);
				return {
					...conversation,
					matchSnippet: row.matchedMessageText
						? createConversationMatchSnippet(row.matchedMessageText, input.query)
						: null,
				};
			});
		},
	};
}
