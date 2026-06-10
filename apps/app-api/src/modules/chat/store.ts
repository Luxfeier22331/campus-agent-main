import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { conversations, messageFeedback, messages, sessionSlots } from "../../db/schema";
import {
	type ChatConversation,
	type ChatConversationSummary,
	type ChatMessage,
	type ChatMessageFeedback,
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

export type ChatConversationListView = "active" | "archived";

export interface ChatConversationStore {
	deleteMessageFeedbackByOwner(input: {
		conversationId: string;
		messageId: string;
		ownerUserId: string;
	}): Promise<boolean>;
	listConversationSummariesByOwner(input: {
		ownerUserId: string;
		view: ChatConversationListView;
		limit: number;
	}): Promise<ChatConversationSummary[]>;
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
	markConversationArchivedByOwner(input: {
		ownerUserId: string;
		conversationId: string;
		archivedAt: string | null;
		updatedAt: string;
	}): Promise<ChatConversationSummary | null>;
	markConversationDeletedByOwner(input: {
		ownerUserId: string;
		conversationId: string;
		deletedAt: string;
		updatedAt: string;
	}): Promise<boolean>;
	markConversationPinnedByOwner(input: {
		ownerUserId: string;
		conversationId: string;
		pinnedAt: string | null;
		updatedAt: string;
	}): Promise<ChatConversationSummary | null>;
	renameConversationByOwner(input: {
		ownerUserId: string;
		conversationId: string;
		title: string;
		updatedAt: string;
	}): Promise<ChatConversationSummary | null>;
	searchConversationSummariesByOwner(input: {
		ownerUserId: string;
		query: string;
		view: ChatConversationListView;
		limit: number;
	}): Promise<ChatConversationSummary[]>;
	upsertMessageFeedbackByOwner(input: {
		conversationId: string;
		feedbackId: string;
		messageId: string;
		ownerUserId: string;
		reasonCodes: ChatMessageFeedback["reasonCodes"];
		updatedAt: string;
		vote: ChatMessageFeedback["vote"];
	}): Promise<ChatMessageFeedback | null>;
}

function toIsoString(value: Date): string {
	return value.toISOString();
}

function toChatFeedback(row: typeof messageFeedback.$inferSelect): ChatMessageFeedback {
	return {
		createdAt: toIsoString(row.createdAt),
		feedbackId: row.feedbackId,
		messageId: row.messageId,
		reasonCodes: row.reasonCodesJson as ChatMessageFeedback["reasonCodes"],
		updatedAt: toIsoString(row.updatedAt),
		vote: row.vote as ChatMessageFeedback["vote"],
	};
}

function toChatMessage(
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
		requestId: row.requestId ?? null,
		retryable: row.retryable ?? null,
		structuredParts: normalizeChatStructuredParts(row.structuredPartsJson),
	};
	if (message.role === "assistant") {
		message.feedback = feedbackByMessageId.get(message.id) ?? null;
	}
	return message;
}

function toChatConversationSummary(
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

function buildConversationViewCondition(input: {
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

function toChatConversation(
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

async function loadFeedbackTarget(input: {
	conversationId: string;
	db: Awaited<ReturnType<RuntimeDbGetter>>;
	messageId: string;
	ownerUserId: string;
}): Promise<typeof messages.$inferSelect | null> {
	const conversationRows = await input.db
		.select({ id: conversations.id })
		.from(conversations)
		.where(
			and(
				eq(conversations.ownerUserId, input.ownerUserId),
				eq(conversations.id, input.conversationId),
				isNull(conversations.deletedAt),
			),
		)
		.limit(1);
	if (!conversationRows[0]) {
		return null;
	}

	const messageRows = await input.db
		.select()
		.from(messages)
		.where(and(eq(messages.id, input.messageId), eq(messages.conversationId, input.conversationId)))
		.limit(1);
	const messageRow = messageRows[0];
	if (
		!messageRow ||
		messageRow.role !== "assistant" ||
		!messageRow.requestId ||
		messageRow.kind === "error"
	) {
		return null;
	}

	return messageRow;
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

	return {
		async deleteMessageFeedbackByOwner(input) {
			const db = await getDb();
			const messageRow = await loadFeedbackTarget({ db, ...input });
			if (!messageRow) {
				return false;
			}

			const deletedRows = await db
				.delete(messageFeedback)
				.where(
					and(
						eq(messageFeedback.ownerUserId, input.ownerUserId),
						eq(messageFeedback.messageId, input.messageId),
					),
				)
				.returning({ feedbackId: messageFeedback.feedbackId });

			return deletedRows.length > 0;
		},

		async listConversationSummariesByOwner(input) {
			const db = await getDb();
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
			const db = await getDb();
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
			const now = new Date();
			const rows = await db
				.update(conversations)
				.set({ deletedAt: now, updatedAt: now })
				.where(
					and(
						eq(conversations.ownerUserId, ownerUserId),
						eq(conversations.id, conversationId),
						isNull(conversations.deletedAt),
					),
				)
				.returning({ id: conversations.id });

			return rows.length > 0;
		},

		async deleteConversationsByOwner(ownerUserId) {
			const db = await getDb();
			const now = new Date();
			const deletedRows = await db
				.update(conversations)
				.set({ deletedAt: now, updatedAt: now })
				.where(and(eq(conversations.ownerUserId, ownerUserId), isNull(conversations.deletedAt)))
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
						isNull(conversations.deletedAt),
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
						isNull(conversations.deletedAt),
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

		async markConversationArchivedByOwner(input) {
			const db = await getDb();
			const rows = await db
				.update(conversations)
				.set({
					archivedAt: input.archivedAt ? new Date(input.archivedAt) : null,
					updatedAt: new Date(input.updatedAt),
				})
				.where(
					and(
						eq(conversations.ownerUserId, input.ownerUserId),
						eq(conversations.id, input.conversationId),
						isNull(conversations.deletedAt),
					),
				)
				.returning();

			return rows[0] ? toChatConversationSummary(rows[0]) : null;
		},

		async markConversationDeletedByOwner(input) {
			const db = await getDb();
			const rows = await db
				.update(conversations)
				.set({
					deletedAt: new Date(input.deletedAt),
					updatedAt: new Date(input.updatedAt),
				})
				.where(
					and(
						eq(conversations.ownerUserId, input.ownerUserId),
						eq(conversations.id, input.conversationId),
						isNull(conversations.deletedAt),
					),
				)
				.returning({ id: conversations.id });

			return rows.length > 0;
		},

		async markConversationPinnedByOwner(input) {
			const db = await getDb();
			const rows = await db
				.update(conversations)
				.set({
					pinnedAt: input.pinnedAt ? new Date(input.pinnedAt) : null,
					updatedAt: new Date(input.updatedAt),
				})
				.where(
					and(
						eq(conversations.ownerUserId, input.ownerUserId),
						eq(conversations.id, input.conversationId),
						isNull(conversations.deletedAt),
					),
				)
				.returning();

			return rows[0] ? toChatConversationSummary(rows[0]) : null;
		},

		async renameConversationByOwner(input) {
			const db = await getDb();
			const updatedAt = new Date(input.updatedAt);
			const rows = await db
				.update(conversations)
				.set({
					title: input.title,
					titleUpdatedAt: updatedAt,
					updatedAt,
				})
				.where(
					and(
						eq(conversations.ownerUserId, input.ownerUserId),
						eq(conversations.id, input.conversationId),
						isNull(conversations.deletedAt),
					),
				)
				.returning();

			return rows[0] ? toChatConversationSummary(rows[0]) : null;
		},

		async searchConversationSummariesByOwner(input) {
			const db = await getDb();
			const rows = await db
				.select({ conversation: conversations })
				.from(conversations)
				.leftJoin(messages, eq(messages.conversationId, conversations.id))
				.where(
					and(
						buildConversationViewCondition(input),
						or(
							ilike(conversations.title, `%${input.query}%`),
							ilike(messages.text, `%${input.query}%`),
						),
					),
				)
				.orderBy(
					sql`${conversations.pinnedAt} IS NULL`,
					desc(conversations.pinnedAt),
					desc(conversations.updatedAt),
				)
				.limit(input.limit * 4);

			const summariesById = new Map<string, ChatConversationSummary>();
			for (const row of rows) {
				if (!summariesById.has(row.conversation.id)) {
					summariesById.set(row.conversation.id, toChatConversationSummary(row.conversation));
				}
				if (summariesById.size >= input.limit) {
					break;
				}
			}

			return [...summariesById.values()];
		},

		async upsertMessageFeedbackByOwner(input) {
			const db = await getDb();
			const messageRow = await loadFeedbackTarget({ db, ...input });
			if (!messageRow) {
				return null;
			}

			const requestId = messageRow.requestId;
			if (!requestId) {
				return null;
			}
			const now = new Date(input.updatedAt);
			const rows = await db
				.insert(messageFeedback)
				.values({
					conversationId: input.conversationId,
					createdAt: now,
					feedbackId: input.feedbackId,
					messageId: input.messageId,
					ownerUserId: input.ownerUserId,
					reasonCodesJson: input.reasonCodes,
					requestId,
					updatedAt: now,
					vote: input.vote,
				})
				.onConflictDoUpdate({
					set: {
						reasonCodesJson: input.reasonCodes,
						updatedAt: now,
						vote: input.vote,
					},
					target: [messageFeedback.ownerUserId, messageFeedback.messageId],
				})
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Message feedback upsert returned no row.");
			}

			return toChatFeedback(row);
		},
	};
}
