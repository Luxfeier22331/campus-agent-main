import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgSchema,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import type { TurnDispatchPrincipalSnapshot } from "../../modules/turn-dispatch-types";

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
		activeRequestId: text("active_request_id"),
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
	}),
);

export const turnDispatches = chat.table(
	"turn_dispatches",
	{
		requestId: text("request_id").primaryKey(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		userMessageId: text("user_message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		assistantMessageId: text("assistant_message_id").notNull(),
		turnSequence: integer("turn_sequence").notNull(),
		surface: text("surface").notNull(),
		ownerUserId: text("owner_user_id").notNull(),
		actorUserId: text("actor_user_id").notNull(),
		principalSnapshotJson: jsonb("principal_snapshot_json")
			.$type<TurnDispatchPrincipalSnapshot>()
			.notNull(),
		memoryRecallEnabled: boolean("memory_recall_enabled"),
		memoryAppendEnabled: boolean("memory_append_enabled"),
		memoryOwnerGeneration: bigint("memory_owner_generation", { mode: "number" }),
		memoryOwnerSequence: bigint("memory_owner_sequence", { mode: "number" }),
		idempotencyKey: text("idempotency_key"),
		requestFingerprintSha256: text("request_fingerprint_sha256"),
		executionInputJson: text("execution_input_json"),
		executionInputSha256: text("execution_input_sha256"),
		finalizationFingerprint: text("finalization_fingerprint"),
		safetyIdentifier: text("safety_identifier"),
		status: text("status").notNull(),
		errorCode: text("error_code"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		executionInputPairCheck: check(
			"chat_turn_dispatches_execution_input_pair_check",
			sql`(${table.executionInputJson} is null) = (${table.executionInputSha256} is null)`,
		),
		inputLifecycleCheck: check(
			"chat_turn_dispatches_input_lifecycle_check",
			sql`(
					${table.status} = 'accepted'
					and (
						${table.executionInputJson} is not null
						and ${table.executionInputSha256} is not null
					)
				)
				or (
					${table.status} in (
						'completed',
						'error',
						'approval_required',
						'rejected',
						'cancelled'
					)
					and (
						(
							${table.executionInputJson} is null
							and ${table.executionInputSha256} is null
						)
						or (
							${table.executionInputJson} is not null
							and ${table.executionInputSha256} is not null
						)
					)
				)`,
		),
		actorIdempotencyUnique: uniqueIndex("chat_turn_dispatches_actor_idempotency_uidx").on(
			table.actorUserId,
			table.idempotencyKey,
		),
		conversationTurnSequenceIndex: index("chat_turn_dispatches_conversation_turn_sequence_idx").on(
			table.conversationId,
			table.turnSequence,
		),
		createdAtRequestIdIndex: index("chat_turn_dispatches_created_at_request_id_idx").on(
			table.createdAt.desc(),
			table.requestId.desc(),
		),
		safetyIdentifierCreatedAtIndex: index(
			"chat_turn_dispatches_safety_identifier_created_at_idx",
		).on(table.safetyIdentifier, table.createdAt),
		statusCreatedAtIndex: index("chat_turn_dispatches_status_created_at_idx").on(
			table.status,
			table.createdAt,
		),
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
