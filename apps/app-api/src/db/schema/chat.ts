import {
	boolean,
	index,
	integer,
	jsonb,
	pgSchema,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

const chat = pgSchema("chat");

export const conversations = chat.table(
	"conversations",
	{
		id: text("id").primaryKey(),
		ownerUserId: text("owner_user_id").notNull(),
		title: text("title").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		pinnedAt: timestamp("pinned_at", { withTimezone: true }),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		titleUpdatedAt: timestamp("title_updated_at", { withTimezone: true }),
		activeBranchId: text("active_branch_id").notNull().default("branch_active"),
		activeMessageId: text("active_message_id"),
		activeRunId: text("active_run_id"),
		activeTurnSequence: integer("active_turn_sequence").notNull().default(0),
	},
	(table) => ({
		ownerArchivedUpdatedAtIndex: index("chat_conversations_owner_archived_updated_at_idx").on(
			table.ownerUserId,
			table.archivedAt,
			table.updatedAt,
		),
		ownerDeletedUpdatedAtIndex: index("chat_conversations_owner_deleted_updated_at_idx").on(
			table.ownerUserId,
			table.deletedAt,
			table.updatedAt,
		),
		ownerPinnedUpdatedAtIndex: index("chat_conversations_owner_pinned_updated_at_idx").on(
			table.ownerUserId,
			table.pinnedAt,
			table.updatedAt,
		),
		ownerUpdatedAtIndex: index("chat_conversations_owner_updated_at_idx").on(
			table.ownerUserId,
			table.updatedAt,
		),
	}),
);

export const messages = chat.table(
	"messages",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		kind: text("kind"),
		text: text("text").notNull(),
		structuredPartsJson: jsonb("structured_parts_json"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		requestId: text("request_id"),
		retryable: boolean("retryable"),
		parentMessageId: text("parent_message_id"),
		branchId: text("branch_id").notNull().default("branch_active"),
		turnSequence: integer("turn_sequence").notNull().default(0),
		runId: text("run_id"),
		isActiveBranchHead: boolean("is_active_branch_head").notNull().default(false),
	},
	(table) => ({
		conversationCreatedAtIndex: index("chat_messages_conversation_created_at_idx").on(
			table.conversationId,
			table.createdAt,
		),
		requestIdIndex: index("chat_messages_request_id_idx").on(table.requestId),
		conversationBranchSequenceIndex: index("chat_messages_conversation_branch_sequence_idx").on(
			table.conversationId,
			table.branchId,
			table.turnSequence,
		),
		runIdIndex: index("chat_messages_run_id_idx").on(table.runId),
	}),
);

export const messageFeedback = chat.table(
	"message_feedback",
	{
		feedbackId: text("feedback_id").primaryKey(),
		ownerUserId: text("owner_user_id").notNull(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		messageId: text("message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		requestId: text("request_id").notNull(),
		vote: text("vote").notNull(),
		reasonCodesJson: jsonb("reason_codes_json").$type<string[]>().notNull().default([]),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		ownerMessageUnique: uniqueIndex("chat_message_feedback_owner_message_uidx").on(
			table.ownerUserId,
			table.messageId,
		),
		requestIdIndex: index("chat_message_feedback_request_id_idx").on(table.requestId),
		updatedAtIndex: index("chat_message_feedback_updated_at_idx").on(table.updatedAt),
	}),
);

export const sessionSlots = chat.table(
	"session_slots",
	{
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		value: text("value").notNull(),
		confirmed: boolean("confirmed").notNull().default(true),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		conversationNameIndex: index("chat_session_slots_conversation_name_idx").on(
			table.conversationId,
			table.name,
		),
	}),
);
