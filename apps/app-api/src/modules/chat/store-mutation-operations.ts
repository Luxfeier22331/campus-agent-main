import { and, eq, gte, isNull } from "drizzle-orm";

import { conversations, messages } from "../../db/schema";
import type { ChatConversationStoreContext } from "./store-context";
import type { ChatConversationStore } from "./store-contract";
import { toChatConversationSummary } from "./store-mappers";
import { loadChatConversation } from "./store-read-operations";

type ChatConversationMutationStore = Pick<
	ChatConversationStore,
	| "createConversationDraft"
	| "deleteConversationsByOwner"
	| "deleteTrailingMessagesFromMessageByOwner"
	| "markConversationArchivedByOwner"
	| "markConversationDeletedByOwner"
	| "markConversationPinnedByOwner"
	| "renameConversationByOwner"
>;

export function createPgChatConversationMutationStore(
	context: ChatConversationStoreContext,
): ChatConversationMutationStore {
	return {
		async createConversationDraft(input) {
			const db = await context.getDb();
			await db.insert(conversations).values({
				id: input.conversationId,
				ownerUserId: input.ownerUserId,
				title: input.title,
				createdAt: new Date(input.createdAt),
				updatedAt: new Date(input.updatedAt),
			});

			const conversation = await loadChatConversation(
				context,
				input.ownerUserId,
				input.conversationId,
			);
			if (!conversation) {
				throw new Error("Conversation disappeared after draft creation.");
			}

			return conversation;
		},

		async deleteConversationsByOwner(ownerUserId) {
			const db = await context.getDb();
			const now = new Date();
			return db.transaction(async (tx) => {
				const activeRows = await tx
					.select({ id: conversations.id })
					.from(conversations)
					.where(and(eq(conversations.ownerUserId, ownerUserId), isNull(conversations.deletedAt)))
					.for("update");
				if (activeRows.length === 0) {
					return 0;
				}
				await tx
					.update(conversations)
					.set({ deletedAt: now, updatedAt: now })
					.where(and(eq(conversations.ownerUserId, ownerUserId), isNull(conversations.deletedAt)));
				return activeRows.length;
			});
		},

		async deleteTrailingMessagesFromMessageByOwner(input) {
			const db = await context.getDb();
			return db.transaction(async (tx) => {
				const conversationRows = await tx
					.select({ id: conversations.id })
					.from(conversations)
					.where(
						and(
							eq(conversations.ownerUserId, input.ownerUserId),
							eq(conversations.id, input.conversationId),
							isNull(conversations.deletedAt),
						),
					)
					.limit(1)
					.for("update");
				if (!conversationRows[0]) {
					return false;
				}
				const messageRows = await tx
					.select({ createdAt: messages.createdAt, id: messages.id })
					.from(messages)
					.where(
						and(
							eq(messages.id, input.messageId),
							eq(messages.conversationId, input.conversationId),
						),
					)
					.limit(1);
				const messageRow = messageRows[0];
				if (!messageRow) {
					return false;
				}
				const now = new Date(input.updatedAt);
				await tx
					.delete(messages)
					.where(
						and(
							eq(messages.conversationId, input.conversationId),
							gte(messages.createdAt, messageRow.createdAt),
						),
					);
				await tx
					.update(conversations)
					.set({ updatedAt: now })
					.where(
						and(
							eq(conversations.ownerUserId, input.ownerUserId),
							eq(conversations.id, input.conversationId),
							isNull(conversations.deletedAt),
						),
					);
				return true;
			});
		},

		async markConversationArchivedByOwner(input) {
			const db = await context.getDb();
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
			const db = await context.getDb();
			return db.transaction(async (tx) => {
				const now = new Date(input.updatedAt);
				const conversationRows = await tx
					.select({ id: conversations.id })
					.from(conversations)
					.where(
						and(
							eq(conversations.ownerUserId, input.ownerUserId),
							eq(conversations.id, input.conversationId),
							isNull(conversations.deletedAt),
						),
					)
					.limit(1)
					.for("update");
				if (!conversationRows[0]) {
					return false;
				}
				await tx
					.update(conversations)
					.set({ deletedAt: new Date(input.deletedAt), updatedAt: now })
					.where(eq(conversations.id, input.conversationId));
				return true;
			});
		},

		async markConversationPinnedByOwner(input) {
			const db = await context.getDb();
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
			const db = await context.getDb();
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
	};
}
