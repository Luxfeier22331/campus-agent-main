import { index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const runtime = pgSchema("runtime");

export const requestExecution = runtime.table(
  "request_execution",
  {
    requestId: text("request_id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    userMessageId: text("user_message_id").notNull(),
    assistantMessageId: text("assistant_message_id"),
    surface: text("surface").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorPrincipalId: text("actor_principal_id").notNull(),
    actorRolesJson: jsonb("actor_roles_json").$type<string[]>().notNull(),
    actorDepartmentsJson: jsonb("actor_departments_json").$type<string[]>().notNull(),
    actorGroupsJson: jsonb("actor_groups_json").$type<string[]>().notNull(),
    actorCampusScope: text("actor_campus_scope"),
    principalType: text("principal_type").notNull(),
    principalLabel: text("principal_label"),
    idempotencyKey: text("idempotency_key"),
    requestFingerprintSha256: text("request_fingerprint_sha256"),
    traceId: text("trace_id").notNull(),
    requestedCapability: text("requested_capability"),
    requestedScopeJson: jsonb("requested_scope_json").$type<Record<string, unknown> | null>(),
    selectedTarget: text("selected_target"),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    questionPreview: text("question_preview").notNull(),
    answerPreview: text("answer_preview"),
    sourceDocIdsJson: jsonb("source_doc_ids_json").$type<string[] | null>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationStartedAtIndex: index("runtime_request_execution_conversation_started_at_idx").on(
      table.conversationId,
      table.startedAt,
    ),
    statusStartedAtIndex: index("runtime_request_execution_status_started_at_idx").on(
      table.status,
      table.startedAt,
    ),
    actorIdempotencyUnique: uniqueIndex("runtime_request_execution_actor_idempotency_idx").on(
      table.actorUserId,
      table.idempotencyKey,
    ),
  }),
);

export const projectionOutbox = runtime.table(
  "projection_outbox",
  {
    eventId: text("event_id").primaryKey(),
    requestId: text("request_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => ({
    processedAvailableIndex: index("runtime_projection_outbox_processed_available_idx").on(
      table.processedAt,
      table.availableAt,
    ),
    requestOccurredIndex: index("runtime_projection_outbox_request_occurred_idx").on(
      table.requestId,
      table.occurredAt,
    ),
  }),
);
