import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	conversations,
	messageFeedback,
	messages,
	profileMemoryCommandSources,
	profileMemoryCommands,
	profileMemorySettings,
	sessionSlots,
} from "../../db/schema";
import {
	PROFILE_MEMORY_SUPERSESSION_SCOPE,
	reconcileOwnerMemoryState,
} from "../profile-memory/command-state";
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
	deleteConversationByOwner?(ownerUserId: string, conversationId: string): Promise<boolean>;
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

function createMemorySourceCommandId(): string {
	return `memcmd_${randomUUID().replaceAll("-", "")}`;
}

function sourceCommandHash(commandId: string): string {
	return createHash("sha256").update(commandId, "utf8").digest("hex");
}

function chunkMemorySourceIds(sourceMessageIds: string[]): string[][] {
	const chunks: string[][] = [];
	for (let index = 0; index < sourceMessageIds.length; index += 50) {
		chunks.push(sourceMessageIds.slice(index, index + 50));
	}
	return chunks;
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
		parentMessageId: row.parentMessageId ?? null,
		requestId: row.requestId ?? null,
		retryable: row.retryable ?? null,
		branchId: row.branchId ?? "branch_active",
		turnSequence: row.turnSequence ?? 0,
		runId: row.runId ?? null,
		isActiveBranchHead: row.isActiveBranchHead ?? false,
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
		activeBranchId: row.activeBranchId ?? "branch_active",
		activeMessageId: row.activeMessageId ?? null,
		activeRunId: row.activeRunId ?? null,
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
	if (messageRow?.role !== "assistant" || !messageRow.requestId || messageRow.kind === "error") {
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

		async deleteConversationsByOwner(ownerUserId) {
			const db = await getDb();
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
				const sourceRows = await tx
					.select({ conversationId: messages.conversationId, sourceMessageId: messages.id })
					.from(messages)
					.where(
						and(
							inArray(
								messages.conversationId,
								activeRows.map((row) => row.id),
							),
							eq(messages.role, "user"),
						),
					)
					.orderBy(asc(messages.createdAt), asc(messages.id));
				await tx
					.update(conversations)
					.set({ deletedAt: now, updatedAt: now })
					.where(and(eq(conversations.ownerUserId, ownerUserId), isNull(conversations.deletedAt)));
				await tx
					.insert(profileMemorySettings)
					.values({ ownerUserId, updatedAt: now })
					.onConflictDoNothing({ target: profileMemorySettings.ownerUserId });
				const settingsRows = await tx
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, ownerUserId))
					.limit(1)
					.for("update");
				const settings = settingsRows[0];
				if (
					settings &&
					(settings.lifecycleState === "active" || settings.lifecycleState === "paused")
				) {
					let sequence = settings.commandSequence;
					for (const row of activeRows) {
						const sourceIds = sourceRows
							.filter((source) => source.conversationId === row.id)
							.map((source) => source.sourceMessageId);
						for (const chunk of chunkMemorySourceIds(sourceIds)) {
							sequence += 1;
							const commandId = createMemorySourceCommandId();
							const hash = sourceCommandHash(commandId);
							await tx.insert(profileMemoryCommands).values({
								acceptedLifecycleState: settings.lifecycleState,
								commandId,
								commandKind: "conversation_delete",
								createdAt: now,
								idempotencyKeyHash: hash,
								ownerGeneration: settings.generation,
								ownerSequence: sequence,
								ownerUserId,
								requestFingerprint: hash,
								sourceUpdatedAt: now,
								status: "pending_admission",
								subjectId: row.id,
								supersessionScope: PROFILE_MEMORY_SUPERSESSION_SCOPE.sourceBatch(commandId),
								updatedAt: now,
							});
							await tx
								.insert(profileMemoryCommandSources)
								.values(chunk.map((sourceMessageId) => ({ commandId, sourceMessageId })));
						}
					}
					await tx
						.update(profileMemorySettings)
						.set({ commandSequence: sequence, updatedAt: now })
						.where(eq(profileMemorySettings.ownerUserId, ownerUserId));
					await reconcileOwnerMemoryState(tx, {
						generation: settings.generation,
						now,
						ownerUserId,
					});
				}
				return activeRows.length;
			});
		},

		async deleteTrailingMessagesFromMessageByOwner(input) {
			const db = await getDb();
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
				const removedSourceRows = await tx
					.select({ sourceMessageId: messages.id })
					.from(messages)
					.where(
						and(
							eq(messages.conversationId, input.conversationId),
							eq(messages.role, "user"),
							gte(messages.createdAt, messageRow.createdAt),
						),
					)
					.orderBy(asc(messages.createdAt), asc(messages.id));
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
				await tx
					.insert(profileMemorySettings)
					.values({ ownerUserId: input.ownerUserId, updatedAt: now })
					.onConflictDoNothing({ target: profileMemorySettings.ownerUserId });
				const settingsRows = await tx
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId))
					.limit(1)
					.for("update");
				const settings = settingsRows[0];
				if (
					settings &&
					(settings.lifecycleState === "active" || settings.lifecycleState === "paused")
				) {
					let sequence = settings.commandSequence;
					for (const chunk of chunkMemorySourceIds(
						removedSourceRows.map((row) => row.sourceMessageId),
					)) {
						sequence += 1;
						const commandId = createMemorySourceCommandId();
						const hash = sourceCommandHash(commandId);
						await tx.insert(profileMemoryCommands).values({
							acceptedLifecycleState: settings.lifecycleState,
							commandId,
							commandKind: "conversation_prune",
							createdAt: now,
							idempotencyKeyHash: hash,
							ownerGeneration: settings.generation,
							ownerSequence: sequence,
							ownerUserId: input.ownerUserId,
							requestFingerprint: hash,
							sourceUpdatedAt: now,
							status: "pending_admission",
							subjectId: input.conversationId,
							supersessionScope: PROFILE_MEMORY_SUPERSESSION_SCOPE.sourceBatch(commandId),
							updatedAt: now,
						});
						await tx
							.insert(profileMemoryCommandSources)
							.values(chunk.map((sourceMessageId) => ({ commandId, sourceMessageId })));
					}
					if (sequence !== settings.commandSequence) {
						await tx
							.update(profileMemorySettings)
							.set({ commandSequence: sequence, updatedAt: now })
							.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId));
						await reconcileOwnerMemoryState(tx, {
							generation: settings.generation,
							now,
							ownerUserId: input.ownerUserId,
						});
					}
				}
				return true;
			});
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
				const sourceRows = await tx
					.select({ sourceMessageId: messages.id })
					.from(messages)
					.where(and(eq(messages.conversationId, input.conversationId), eq(messages.role, "user")))
					.orderBy(asc(messages.createdAt), asc(messages.id));
				await tx
					.update(conversations)
					.set({ deletedAt: new Date(input.deletedAt), updatedAt: now })
					.where(eq(conversations.id, input.conversationId));
				await tx
					.insert(profileMemorySettings)
					.values({ ownerUserId: input.ownerUserId, updatedAt: now })
					.onConflictDoNothing({ target: profileMemorySettings.ownerUserId });
				const settingsRows = await tx
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId))
					.limit(1)
					.for("update");
				const settings = settingsRows[0];
				if (
					settings &&
					(settings.lifecycleState === "active" || settings.lifecycleState === "paused")
				) {
					let sequence = settings.commandSequence;
					for (const chunk of chunkMemorySourceIds(sourceRows.map((row) => row.sourceMessageId))) {
						sequence += 1;
						const commandId = createMemorySourceCommandId();
						const hash = sourceCommandHash(commandId);
						await tx.insert(profileMemoryCommands).values({
							acceptedLifecycleState: settings.lifecycleState,
							commandId,
							commandKind: "conversation_delete",
							createdAt: now,
							idempotencyKeyHash: hash,
							ownerGeneration: settings.generation,
							ownerSequence: sequence,
							ownerUserId: input.ownerUserId,
							requestFingerprint: hash,
							sourceUpdatedAt: now,
							status: "pending_admission",
							subjectId: input.conversationId,
							supersessionScope: PROFILE_MEMORY_SUPERSESSION_SCOPE.sourceBatch(commandId),
							updatedAt: now,
						});
						await tx
							.insert(profileMemoryCommandSources)
							.values(chunk.map((sourceMessageId) => ({ commandId, sourceMessageId })));
					}
					if (sequence !== settings.commandSequence) {
						await tx
							.update(profileMemorySettings)
							.set({ commandSequence: sequence, updatedAt: now })
							.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId));
						await reconcileOwnerMemoryState(tx, {
							generation: settings.generation,
							now,
							ownerUserId: input.ownerUserId,
						});
					}
				}
				return true;
			});
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
