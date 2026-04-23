import { and, asc, desc, eq, gte } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { conversations, messages, sessionSlots } from "../../db/schema";
import {
	type ChatConversation,
	type ChatConversationSummary,
	type ChatMessage,
	type ChatSessionSlot,
	normalizeChatStructuredParts,
} from "./model";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface ChatConversationDraftWrite {
	conversationId: string;
	ownerUserId: string;
	title: string;
	createdAt: string;
	updatedAt: string;
}

export interface ChatConversationStore {
	listConversationSummariesByOwner(ownerUserId: string): Promise<ChatConversationSummary[]>;
	listConversationSummariesPageByOwner(input: {
		ownerUserId: string;
		limit: number;
		endingBeforeConversationId: string | null;
	}): Promise<{ conversations: ChatConversationSummary[]; hasMore: boolean }>;
	createConversationDraft(input: ChatConversationDraftWrite): Promise<ChatConversation>;
	deleteConversationByOwner(ownerUserId: string, conversationId: string): Promise<boolean>;
	deleteConversationsByOwner(ownerUserId: string): Promise<number>;
	deleteTrailingMessagesFromMessageByOwner(input: {
		ownerUserId: string;
		conversationId: string;
		messageId: string;
		updatedAt: string;
	}): Promise<boolean>;
	getConversationDetailByOwner(
		ownerUserId: string,
		conversationId: string,
	): Promise<ChatConversation | null>;
	getConversationByOwner(
		ownerUserId: string,
		conversationId: string,
	): Promise<ChatConversation | null>;
}

function toIsoString(value: Date): string {
	return value.toISOString();
}

function toChatMessage(row: typeof messages.$inferSelect): ChatMessage {
	return {
		id: row.id,
		conversationId: row.conversationId,
		role: row.role as ChatMessage["role"],
		kind: (row.kind as ChatMessage["kind"]) ?? null,
		text: row.text,
		createdAt: toIsoString(row.createdAt),
		requestId: row.requestId ?? null,
		retryable: row.retryable ?? null,
		structuredParts: normalizeChatStructuredParts(row.structuredPartsJson),
	};
}

function toChatConversationSummary(
	row: typeof conversations.$inferSelect,
): ChatConversationSummary {
	return {
		id: row.id,
		title: row.title,
		createdAt: toIsoString(row.createdAt),
		updatedAt: toIsoString(row.updatedAt),
	};
}

function toChatConversation(
	row: typeof conversations.$inferSelect,
	messageRows: (typeof messages.$inferSelect)[],
	sessionSlotRows: (typeof sessionSlots.$inferSelect)[],
): ChatConversation {
	return {
		id: row.id,
		ownerUserId: row.ownerUserId,
		title: row.title,
		createdAt: toIsoString(row.createdAt),
		updatedAt: toIsoString(row.updatedAt),
		sessionSlots: sessionSlotRows.map(
			(slot): ChatSessionSlot => ({
				confirmed: slot.confirmed,
				name: slot.name,
				updatedAt: toIsoString(slot.updatedAt),
				value: slot.value,
			}),
		),
		messages: messageRows.map(toChatMessage),
	};
}

export function createPgChatConversationStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): ChatConversationStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	async function loadConversation(
		ownerUserId: string,
		conversationId: string,
	): Promise<ChatConversation | null> {
		const db = await getDb();
		const conversationRows = await db
			.select()
			.from(conversations)
			.where(and(eq(conversations.id, conversationId), eq(conversations.ownerUserId, ownerUserId)))
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

		return toChatConversation(conversationRow, messageRows, sessionSlotRows);
	}

	return {
		async listConversationSummariesByOwner(ownerUserId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(conversations)
				.where(eq(conversations.ownerUserId, ownerUserId))
				.orderBy(desc(conversations.updatedAt));

			return rows.map(toChatConversationSummary);
		},

		async listConversationSummariesPageByOwner(input) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(conversations)
				.where(eq(conversations.ownerUserId, input.ownerUserId))
				.orderBy(desc(conversations.updatedAt));

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

		async createConversationDraft(input) {
			const db = await getDb();
			await db.insert(conversations).values({
				id: input.conversationId,
				ownerUserId: input.ownerUserId,
				title: input.title,
				createdAt: new Date(input.createdAt),
				updatedAt: new Date(input.updatedAt),
			});

			const conversation = await loadConversation(input.ownerUserId, input.conversationId);
			if (!conversation) {
				throw new Error("Conversation disappeared after draft creation.");
			}

			return conversation;
		},

		async deleteConversationByOwner(ownerUserId, conversationId) {
			const db = await getDb();
			const deletedRows = await db
				.delete(conversations)
				.where(
					and(eq(conversations.ownerUserId, ownerUserId), eq(conversations.id, conversationId)),
				)
				.returning({ id: conversations.id });

			return deletedRows.length > 0;
		},

		async deleteConversationsByOwner(ownerUserId) {
			const db = await getDb();
			const deletedRows = await db
				.delete(conversations)
				.where(eq(conversations.ownerUserId, ownerUserId))
				.returning({ id: conversations.id });

			return deletedRows.length;
		},

		async deleteTrailingMessagesFromMessageByOwner(input) {
			const db = await getDb();
			const conversationRows = await db
				.select({ id: conversations.id })
				.from(conversations)
				.where(
					and(
						eq(conversations.ownerUserId, input.ownerUserId),
						eq(conversations.id, input.conversationId),
					),
				)
				.limit(1);
			if (!conversationRows[0]) {
				return false;
			}

			const messageRows = await db
				.select({
					createdAt: messages.createdAt,
					id: messages.id,
				})
				.from(messages)
				.where(
					and(eq(messages.id, input.messageId), eq(messages.conversationId, input.conversationId)),
				)
				.limit(1);
			const messageRow = messageRows[0];
			if (!messageRow) {
				return false;
			}

			await db
				.delete(messages)
				.where(
					and(
						eq(messages.conversationId, input.conversationId),
						gte(messages.createdAt, messageRow.createdAt),
					),
				);

			await db
				.update(conversations)
				.set({
					updatedAt: new Date(input.updatedAt),
				})
				.where(
					and(
						eq(conversations.ownerUserId, input.ownerUserId),
						eq(conversations.id, input.conversationId),
					),
				);

			return true;
		},

		async getConversationDetailByOwner(ownerUserId, conversationId) {
			return loadConversation(ownerUserId, conversationId);
		},

		async getConversationByOwner(ownerUserId, conversationId) {
			return loadConversation(ownerUserId, conversationId);
		},
	};
}
