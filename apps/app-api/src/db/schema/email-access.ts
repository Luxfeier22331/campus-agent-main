import { sql } from "drizzle-orm";
import { check, index, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";

const auth = pgSchema("app_auth");

export const emailAccessGrant = auth.table(
	"email_access_grant",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		kind: text("kind").notNull(),
		environment: text("environment").notNull(),
		state: text("state").notNull().default("pending"),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }).notNull(),
		accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		revokedBy: text("revoked_by"),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		lastInvitationSentAt: timestamp("last_invitation_sent_at", { withTimezone: true }),
	},
	(table) => ({
		kindCheck: check("email_access_grant_kind_check", sql`${table.kind} in ('invitation', 'test')`),
		environmentCheck: check(
			"email_access_grant_environment_check",
			sql`${table.environment} in ('development', 'test', 'staging', 'production')`,
		),
		stateCheck: check(
			"email_access_grant_state_check",
			sql`${table.state} in ('pending', 'active', 'revoked', 'expired')`,
		),
		testBoundaryCheck: check(
			"email_access_grant_test_boundary_check",
			sql`${table.kind} <> 'test' or (${table.environment} <> 'production' and ${table.accessExpiresAt} is not null)`,
		),
		stateShapeCheck: check(
			"email_access_grant_state_shape_check",
			sql`(${table.state} = 'pending' and ${table.userId} is null and ${table.claimedAt} is null and ${table.revokedAt} is null)
				or (${table.state} = 'active' and ${table.userId} is not null and ${table.claimedAt} is not null and ${table.revokedAt} is null)
				or (${table.state} = 'revoked' and ${table.revokedAt} is not null)
				or ${table.state} = 'expired'`,
		),
		liveEmailUnique: uniqueIndex("email_access_grant_live_email_uidx")
			.on(table.environment, table.email)
			.where(sql`${table.state} in ('pending', 'active')`),
		stateIndex: index("email_access_grant_environment_state_idx").on(
			table.environment,
			table.state,
			table.updatedAt,
		),
		userIdIndex: index("email_access_grant_user_id_idx").on(table.userId),
	}),
);

export const emailAccessGrantEvent = auth.table(
	"email_access_grant_event",
	{
		id: text("id").primaryKey(),
		grantId: text("grant_id")
			.notNull()
			.references(() => emailAccessGrant.id, { onDelete: "cascade" }),
		action: text("action").notNull(),
		actorId: text("actor_id").notNull(),
		idempotencyKey: text("idempotency_key"),
		payloadHash: text("payload_hash"),
		outcome: text("outcome").notNull(),
		errorCode: text("error_code"),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		actionCheck: check(
			"email_access_grant_event_action_check",
			sql`${table.action} in ('created', 'invitation_sent', 'claimed', 'revoked', 'expired')`,
		),
		outcomeCheck: check(
			"email_access_grant_event_outcome_check",
			sql`${table.outcome} in ('started', 'succeeded', 'failed')`,
		),
		idempotencyUnique: uniqueIndex("email_access_grant_event_idempotency_uidx").on(
			table.actorId,
			table.idempotencyKey,
		),
		grantOccurredIndex: index("email_access_grant_event_grant_occurred_idx").on(
			table.grantId,
			table.occurredAt,
		),
	}),
);
