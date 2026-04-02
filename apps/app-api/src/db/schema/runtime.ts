import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { RequestDiagnosticsSummary } from "../../modules/request-diagnostics";

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
    entitlementSnapshotId: text("entitlement_snapshot_id"),
    entitlementGroupsJson: jsonb("entitlement_groups_json").$type<string[]>().notNull().default([]),
    visibilityScope: text("visibility_scope"),
    applicabilityScope: text("applicability_scope"),
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
    diagnosticsJson: jsonb("diagnostics_json").$type<RequestDiagnosticsSummary | null>(),
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

export const requestObservabilityFact = runtime.table(
  "request_observability_fact",
  {
    requestId: text("request_id").primaryKey(),
    traceId: text("trace_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    surface: text("surface").notNull(),
    principalType: text("principal_type").notNull(),
    entitlementSnapshotId: text("entitlement_snapshot_id"),
    policyProjectionVersion: text("policy_projection_version"),
    requestedCapability: text("requested_capability"),
    requestedScopeSummary: text("requested_scope_summary"),
    collection: text("collection"),
    selectedTarget: text("selected_target"),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    retrievalAttempted: boolean("retrieval_attempted"),
    candidateCount: integer("candidate_count"),
    retrievedSourceCount: integer("retrieved_source_count"),
    emptyRecall: boolean("empty_recall"),
    citationExpected: boolean("citation_expected"),
    citationCount: integer("citation_count"),
    citationMissing: boolean("citation_missing"),
    refusalClass: text("refusal_class"),
    aclDecision: text("acl_decision"),
    aclAnomalyCode: text("acl_anomaly_code"),
    failClosed: boolean("fail_closed"),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    estimatedCostMicrousd: integer("estimated_cost_microusd"),
    traceAvailable: boolean("trace_available").notNull().default(false),
    projectionLagMs: integer("projection_lag_ms"),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    startedAtIndex: index("runtime_request_observability_started_at_idx").on(table.startedAt),
    statusStartedAtIndex: index("runtime_request_observability_status_started_at_idx").on(
      table.status,
      table.startedAt,
    ),
    surfaceStartedAtIndex: index("runtime_request_observability_surface_started_at_idx").on(
      table.surface,
      table.startedAt,
    ),
    selectedTargetStartedAtIndex: index(
      "runtime_request_observability_selected_target_started_at_idx",
    ).on(table.selectedTarget, table.startedAt),
    principalTypeStartedAtIndex: index(
      "runtime_request_observability_principal_type_started_at_idx",
    ).on(table.principalType, table.startedAt),
    modelNameStartedAtIndex: index("runtime_request_observability_model_name_started_at_idx").on(
      table.modelName,
      table.startedAt,
    ),
    collectionStartedAtIndex: index("runtime_request_observability_collection_started_at_idx").on(
      table.collection,
      table.startedAt,
    ),
  }),
);
