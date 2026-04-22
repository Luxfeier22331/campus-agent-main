import { boolean, index, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

const chat = pgSchema("chat");

export const conversations = chat.table(
	"conversations",
	{
		id: text("id").primaryKey(),
		ownerUserId: text("owner_user_id").notNull(),
		title: text("title").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
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
	},
	(table) => ({
		conversationCreatedAtIndex: index("chat_messages_conversation_created_at_idx").on(
			table.conversationId,
			table.createdAt,
		),
		requestIdIndex: index("chat_messages_request_id_idx").on(table.requestId),
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
