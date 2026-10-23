import { sql } from "drizzle-orm";
import { check, index, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";

const auth = pgSchema("app_auth");

export const accountAdminEvent = auth.table(
	"account_admin_event",
	{
		action: text("action").notNull(),
		actorId: text("actor_id").notNull(),
		errorCode: text("error_code"),
		eventId: text("event_id").primaryKey(),
		idempotencyKey: text("idempotency_key").notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
		outcome: text("outcome").notNull(),
		reason: text("reason"),
		requestFingerprint: text("request_fingerprint").notNull(),
		targetUserId: text("target_user_id").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => ({
		actorOccurredIndex: index("account_admin_event_actor_occurred_idx").on(
			table.actorId,
			table.occurredAt,
		),
		actionOccurredIndex: index("account_admin_event_action_occurred_idx").on(
			table.action,
			table.occurredAt,
		),
		actorIdempotencyUnique: uniqueIndex("account_admin_event_actor_idempotency_uidx").on(
			table.actorId,
			table.idempotencyKey,
		),
		outcomeCheck: check(
			"account_admin_event_outcome_check",
			sql`${table.outcome} in ('started', 'succeeded', 'failed', 'indeterminate')`,
		),
		outcomeOccurredIndex: index("account_admin_event_outcome_occurred_idx").on(
			table.outcome,
			table.occurredAt,
		),
		occurredIndex: index("account_admin_event_occurred_idx").on(table.occurredAt, table.eventId),
		targetOccurredIndex: index("account_admin_event_target_occurred_idx").on(
			table.targetUserId,
			table.occurredAt,
		),
	}),
);
