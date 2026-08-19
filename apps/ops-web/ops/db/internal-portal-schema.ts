import { sql } from "drizzle-orm";
import { check, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const internalPortal = pgSchema("internal_portal");

export const internalPortalAutomationTokens = internalPortal.table(
	"automation_tokens",
	{
		tokenId: text("token_id").primaryKey(),
		name: text("name").notNull(),
		tokenValue: text("token_value").notNull(),
		tokenHash: text("token_hash").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
	},
	(table) => [
		check(
			"internal_portal_automation_tokens_name_check",
			sql`length(btrim(${table.name})) between 1 and 80`,
		),
		check("internal_portal_automation_tokens_value_check", sql`length(${table.tokenValue}) > 0`),
		check(
			"internal_portal_automation_tokens_hash_check",
			sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
		),
	],
);
