import { and, eq, isNull } from "drizzle-orm";
import type { RuntimeDatabase } from "../../db/runtime";
import { conversations, messageFeedback, messages } from "../../db/schema";
import type { ChatConversationStoreContext } from "./store-context";
import type { ChatConversationStore } from "./store-contract";
import { toChatFeedback } from "./store-mappers";

async function loadFeedbackTarget(input: {
	conversationId: string;
	db: RuntimeDatabase;
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
	if (messageRow?.role !== "assistant" || !messageRow.requestId || messageRow.kind === "error") {
		return null;
	}

	return messageRow;
}

type ChatConversationFeedbackStore = Pick<
	ChatConversationStore,
	"deleteMessageFeedbackByOwner" | "upsertMessageFeedbackByOwner"
>;

export function createPgChatConversationFeedbackStore(
	context: ChatConversationStoreContext,
): ChatConversationFeedbackStore {
	return {
		async deleteMessageFeedbackByOwner(input) {
			const db = await context.getDb();
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

		async upsertMessageFeedbackByOwner(input) {
			const db = await context.getDb();
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
