import { bigint, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

import type { profileMemoryCommands, profileMemorySettings } from "../../db/schema";

const profileRuntime = pgSchema("profile");

export const profileMemoryItems = profileRuntime.table("memory_items", {
	itemId: text("item_id").primaryKey(),
	ownerUserId: text("owner_user_id").notNull(),
	ownerGeneration: bigint("owner_generation", { mode: "number" }).notNull().default(1),
	key: text("key").notNull(),
	value: text("value").notNull(),
	revision: bigint("revision", { mode: "number" }).notNull().default(1),
	desiredState: text("desired_state").notNull().default("present"),
	syncStatus: text("sync_status").notNull().default("pending"),
	syncErrorCode: text("sync_error_code"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const profileMemoryItemSelection = {
	createdAt: profileMemoryItems.createdAt,
	desiredState: profileMemoryItems.desiredState,
	itemId: profileMemoryItems.itemId,
	key: profileMemoryItems.key,
	ownerGeneration: profileMemoryItems.ownerGeneration,
	ownerUserId: profileMemoryItems.ownerUserId,
	revision: profileMemoryItems.revision,
	syncErrorCode: profileMemoryItems.syncErrorCode,
	syncStatus: profileMemoryItems.syncStatus,
	updatedAt: profileMemoryItems.updatedAt,
	value: profileMemoryItems.value,
};

export type SettingsRow = typeof profileMemorySettings.$inferSelect;
export type ItemRow = typeof profileMemoryItems.$inferSelect;
export type CommandRow = typeof profileMemoryCommands.$inferSelect;
