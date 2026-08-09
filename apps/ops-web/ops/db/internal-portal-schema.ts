import { sql } from "drizzle-orm";
import { check, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const internalPortal = pgSchema("internal_portal");

export const internalPortalCredentials = internalPortal.table(
	"credentials",
	{
		credentialId: text("credential_id").primaryKey(),
		name: text("name").notNull(),
		ssoTgc: text("sso_tgc").notNull(),
		version: integer("version").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
		lastSuccessfulAt: timestamp("last_successful_at", { withTimezone: true }),
		lastOutcome: text("last_outcome"),
	},
	(table) => [
		check(
			"internal_portal_credentials_name_check",
			sql`length(btrim(${table.name})) between 1 and 80`,
		),
		check("internal_portal_credentials_sso_tgc_check", sql`length(${table.ssoTgc}) > 0`),
		check("internal_portal_credentials_version_check", sql`${table.version} > 0`),
		check(
			"internal_portal_credentials_outcome_check",
			sql`${table.lastOutcome} is null or ${table.lastOutcome} in ('valid', 'credential_rejected', 'check_failed')`,
		),
	],
);

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
