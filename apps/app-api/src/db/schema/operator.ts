import { index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

const operator = pgSchema("operator");

export const requestProjection = operator.table(
  "request_projection",
  {
    requestId: text("request_id").primaryKey(),
    traceId: text("trace_id").notNull(),
    surface: text("surface").notNull(),
    conversationId: text("conversation_id").notNull(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    principalLabel: text("principal_label"),
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
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    statusStartedAtIndex: index("operator_request_projection_status_started_at_idx").on(
      table.status,
      table.startedAt,
    ),
    conversationStartedAtIndex: index("operator_request_projection_conversation_started_at_idx").on(
      table.conversationId,
      table.startedAt,
    ),
  }),
);
