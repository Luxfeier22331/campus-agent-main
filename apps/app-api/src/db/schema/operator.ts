import { index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

import type { RequestDiagnosticsSummary } from "../../modules/request-diagnostics";

const operator = pgSchema("operator");

interface OfficialWebArtifactProjectionJson {
  artifactType: string;
  byteSize: number | null;
  contentSha256: string;
  objectKey: string;
  recordCount: number | null;
}

interface RequestAuditDiagnosticsJson {
  aclAnomalyCode: string | null;
  failClosed: boolean | null;
  sourceDocIds: string[];
}

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
    entitlementSnapshotId: text("entitlement_snapshot_id"),
    entitlementGroupsJson: jsonb("entitlement_groups_json").$type<string[]>().notNull().default([]),
    visibilityScope: text("visibility_scope"),
    applicabilityScope: text("applicability_scope"),
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

export const requestAuditProjection = operator.table(
  "request_audit_projection",
  {
    auditEventId: text("audit_event_id").primaryKey(),
    requestId: text("request_id").notNull(),
    traceId: text("trace_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    eventType: text("event_type").notNull(),
    surface: text("surface").notNull(),
    principalType: text("principal_type").notNull(),
    entitlementSnapshotId: text("entitlement_snapshot_id"),
    policyProjectionVersion: text("policy_projection_version"),
    requestedCapability: text("requested_capability"),
    selectedTarget: text("selected_target"),
    status: text("status").notNull(),
    terminalCode: text("terminal_code"),
    summary: text("summary").notNull(),
    diagnosticsJson: jsonb("diagnostics_json").$type<RequestAuditDiagnosticsJson>().notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    requestOccurredAtIndex: index("operator_request_audit_projection_request_occurred_at_idx").on(
      table.requestId,
      table.occurredAt,
    ),
    traceOccurredAtIndex: index("operator_request_audit_projection_trace_occurred_at_idx").on(
      table.traceId,
      table.occurredAt,
    ),
    eventTypeOccurredAtIndex: index("operator_request_audit_projection_event_type_occurred_at_idx").on(
      table.eventType,
      table.occurredAt,
    ),
    statusOccurredAtIndex: index("operator_request_audit_projection_status_occurred_at_idx").on(
      table.status,
      table.occurredAt,
    ),
  }),
);

export const officialWebRunProjection = operator.table(
  "official_web_run_projection",
  {
    runId: text("run_id").primaryKey(),
    siteId: text("site_id").notNull(),
    status: text("status").notNull(),
    ingestionDispatchStatus: text("ingestion_dispatch_status").notNull(),
    ingestionDispatchRef: text("ingestion_dispatch_ref"),
    collectorVersion: text("collector_version"),
    configVersion: text("config_version"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    summaryJson: jsonb("summary_json").$type<Record<string, unknown> | null>(),
    artifactsJson: jsonb("artifacts_json").$type<OfficialWebArtifactProjectionJson[]>().notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    siteStartedAtIndex: index("operator_official_web_run_projection_site_started_at_idx").on(
      table.siteId,
      table.startedAt,
    ),
    statusStartedAtIndex: index("operator_official_web_run_projection_status_started_at_idx").on(
      table.status,
      table.startedAt,
    ),
    dispatchStatusStartedAtIndex: index(
      "operator_official_web_run_projection_dispatch_started_at_idx",
    ).on(table.ingestionDispatchStatus, table.startedAt),
  }),
);

export const officialWebSiteProjection = operator.table(
  "official_web_site_projection",
  {
    siteId: text("site_id").primaryKey(),
    displayName: text("display_name").notNull(),
    hostRootsJson: jsonb("host_roots_json").$type<string[]>().notNull(),
    latestRunId: text("latest_run_id"),
    latestRunStatus: text("latest_run_status"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    latestCollectorVersion: text("latest_collector_version"),
    latestConfigVersion: text("latest_config_version"),
    latestIngestionDispatchStatus: text("latest_ingestion_dispatch_status"),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    latestRunStatusProjectedAtIndex: index(
      "operator_official_web_site_projection_status_projected_at_idx",
    ).on(table.latestRunStatus, table.projectedAt),
  }),
);
