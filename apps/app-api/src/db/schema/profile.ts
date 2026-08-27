import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	integer,
	pgSchema,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

const profile = pgSchema("profile");

export const accountDeletionRequests = profile.table(
	"account_deletion_requests",
	{
		attemptCount: integer("attempt_count").notNull().default(0),
		lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
		requestId: text("request_id").primaryKey(),
		ownerUserId: text("owner_user_id"),
		status: text("status").notNull().default("pending"),
		lastErrorCode: text("last_error_code"),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
		leaseToken: text("lease_token"),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
		requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(table) => ({
		ownerStatusCheck: check(
			"profile_account_deletion_owner_status_check",
			sql`(${table.status} = 'pending' and ${table.ownerUserId} is not null)
				or (${table.status} = 'completed' and ${table.ownerUserId} is null)`,
		),
		leaseShapeCheck: check(
			"profile_account_deletion_lease_shape_check",
			sql`(${table.leaseToken} is null and ${table.leaseExpiresAt} is null)
				or (${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null and ${table.status} = 'pending')`,
		),
		ownerUserUnique: uniqueIndex("profile_account_deletion_owner_uidx").on(table.ownerUserId),
		statusCheck: check(
			"profile_account_deletion_status_check",
			sql`${table.status} in ('pending', 'completed')`,
		),
		pendingLeaseIndex: index("profile_account_deletion_pending_lease_idx").on(
			table.status,
			table.nextAttemptAt,
			table.leaseExpiresAt,
		),
	}),
);

export const profileMemorySettings = profile.table("memory_settings", {
	ownerUserId: text("owner_user_id").primaryKey(),
	lifecycleState: text("lifecycle_state").notNull().default("active"),
	syncStatus: text("sync_status").notNull().default("synced"),
	generation: bigint("generation", { mode: "number" }).notNull().default(1),
	commandSequence: bigint("command_sequence", { mode: "number" }).notNull().default(0),
	eraseRequestedAt: timestamp("erase_requested_at", { withTimezone: true }),
	erasedAt: timestamp("erased_at", { withTimezone: true }),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const profileMemoryItems = profile.table(
	"memory_items",
	{
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

export const profileMemoryCommands = profile.table(
	"memory_commands",
	{
		commandId: text("command_id").primaryKey(),
		ownerUserId: text("owner_user_id").notNull(),
		ownerGeneration: bigint("owner_generation", { mode: "number" }).notNull(),
		ownerSequence: bigint("owner_sequence", { mode: "number" }).notNull(),
		commandKind: text("command_kind").notNull(),
		supersessionScope: text("supersession_scope").notNull(),
		subjectId: text("subject_id"),
		subjectRevision: bigint("subject_revision", { mode: "number" }),
		acceptedItemKey: text("accepted_item_key"),
		acceptedItemValue: text("accepted_item_value"),
		acceptedLifecycleState: text("accepted_lifecycle_state").notNull(),
		sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
		status: text("status").notNull().default("pending_admission"),
		admittedAt: timestamp("admitted_at", { withTimezone: true }),
		lastErrorCode: text("last_error_code"),
		resultFingerprint: text("result_fingerprint"),
		reportedResultStatus: text("reported_result_status"),
		idempotencyKeyHash: text("idempotency_key_hash").notNull(),
		requestFingerprint: text("request_fingerprint").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
	},
	(table) => ({
		ownerSequenceUnique: uniqueIndex("profile_memory_commands_owner_sequence_uidx").on(
			table.ownerUserId,
			table.ownerSequence,
		),
		ownerIdempotencyUnique: uniqueIndex("profile_memory_commands_owner_idempotency_uidx").on(
			table.ownerUserId,
			table.idempotencyKeyHash,
		),
		statusCreatedIndex: index("profile_memory_commands_status_created_idx").on(
			table.status,
			table.createdAt,
		),
		ownerStatusSequenceIndex: index("profile_memory_commands_owner_status_sequence_idx").on(
			table.ownerUserId,
			table.status,
			table.ownerSequence,
		),
		ownerGenerationScopeSequenceIndex: index(
			"profile_memory_commands_owner_generation_scope_sequence_idx",
		).on(table.ownerUserId, table.ownerGeneration, table.supersessionScope, table.ownerSequence),
		supersessionScopeCheck: check(
			"profile_memory_commands_supersession_scope_check",
			sql`length(${table.supersessionScope}) between 1 and 300`,
		),
		lifecycleSnapshotCheck: check(
			"profile_memory_commands_lifecycle_snapshot_check",
			sql`${table.acceptedLifecycleState} in ('active', 'paused', 'erasing', 'erased')`,
		),
		itemSnapshotPairCheck: check(
			"profile_memory_commands_item_snapshot_pair_check",
			sql`(${table.acceptedItemKey} is null) = (${table.acceptedItemValue} is null)`,
		),
		reportedResultStatusCheck: check(
			"profile_memory_commands_reported_result_status_check",
			sql`${table.reportedResultStatus} is null or ${table.reportedResultStatus} in ('succeeded', 'failed')`,
		),
	}),
);

export const profileMemoryCommandSources = profile.table(
	"memory_command_sources",
	{
		commandId: text("command_id")
			.notNull()
			.references(() => profileMemoryCommands.commandId, { onDelete: "cascade" }),
		sourceMessageId: text("source_message_id").notNull(),
	},
	(table) => [primaryKey({ columns: [table.commandId, table.sourceMessageId] })],
);
