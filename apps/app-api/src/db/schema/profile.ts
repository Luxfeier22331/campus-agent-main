import { boolean, index, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const profile = pgSchema("profile");

export const profileMemorySettings = profile.table("memory_settings", {
	ownerUserId: text("owner_user_id").primaryKey(),
	profileMemoryEnabled: boolean("profile_memory_enabled").notNull().default(true),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const profileMemoryItems = profile.table(
	"memory_items",
	{
		itemId: text("item_id").primaryKey(),
		ownerUserId: text("owner_user_id").notNull(),
		key: text("key").notNull(),
		value: text("value").notNull(),
		sourceType: text("source_type").notNull().default("user_declared"),
		confidence: text("confidence").notNull().default("low"),
		visibility: text("visibility").notNull().default("user_visible"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		ownerKeyUnique: uniqueIndex("profile_memory_items_owner_key_uidx").on(
			table.ownerUserId,
			table.key,
		),
		ownerUpdatedAtIndex: index("profile_memory_items_owner_updated_at_idx").on(
			table.ownerUserId,
			table.updatedAt,
		),
	}),
);
