import { index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const officialWeb = pgSchema("official_web");

export const crawlRuns = officialWeb.table(
  "crawl_runs",
  {
    runId: text("run_id").primaryKey(),
    siteId: text("site_id").notNull(),
    schedulerRunKey: text("scheduler_run_key").notNull(),
    triggerType: text("trigger_type").notNull(),
    collectorVersion: text("collector_version").notNull(),
    configVersion: text("config_version").notNull(),
    crawlPolicyVersion: text("crawl_policy_version").notNull(),
    startFingerprintSha256: text("start_fingerprint_sha256").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    latestHeartbeatSequence: integer("latest_heartbeat_sequence").notNull().default(0),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    hostSetJson: jsonb("host_set_json").$type<string[]>().notNull(),
    seedSetJson: jsonb("seed_set_json").$type<string[]>().notNull(),
    summaryJson: jsonb("summary_json").$type<Record<string, unknown> | null>(),
    terminalPayloadSha256: text("terminal_payload_sha256"),
    terminalErrorCode: text("terminal_error_code"),
    terminalErrorMessage: text("terminal_error_message"),
    ingestionDispatchStatus: text("ingestion_dispatch_status").notNull().default("pending"),
    ingestionDispatchedAt: timestamp("ingestion_dispatched_at", { withTimezone: true }),
    ingestionDispatchRef: text("ingestion_dispatch_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    siteSchedulerRunKeyUnique: uniqueIndex("official_web_crawl_runs_site_scheduler_idx").on(
      table.siteId,
      table.schedulerRunKey,
    ),
    statusStartedAtIndex: index("official_web_crawl_runs_status_started_at_idx").on(
      table.status,
      table.startedAt,
    ),
    siteStartedAtIndex: index("official_web_crawl_runs_site_started_at_idx").on(
      table.siteId,
      table.startedAt,
    ),
    ingestionDispatchStatusUpdatedAtIndex: index(
      "official_web_crawl_runs_dispatch_status_updated_at_idx",
    ).on(table.ingestionDispatchStatus, table.updatedAt),
  }),
);

export const runHeartbeats = officialWeb.table(
  "run_heartbeats",
  {
    heartbeatId: text("heartbeat_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => crawlRuns.runId, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    countsJson: jsonb("counts_json").$type<Record<string, number>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    runSequenceUnique: uniqueIndex("official_web_run_heartbeats_run_sequence_idx").on(
      table.runId,
      table.sequence,
    ),
    runObservedAtIndex: index("official_web_run_heartbeats_run_observed_at_idx").on(
      table.runId,
      table.observedAt,
    ),
  }),
);

export const runArtifacts = officialWeb.table(
  "run_artifacts",
  {
    artifactId: text("artifact_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => crawlRuns.runId, { onDelete: "cascade" }),
    artifactType: text("artifact_type").notNull(),
    objectKey: text("object_key").notNull(),
    contentSha256: text("content_sha256").notNull(),
    byteSize: integer("byte_size"),
    recordCount: integer("record_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    runArtifactTypeIndex: index("official_web_run_artifacts_run_type_idx").on(
      table.runId,
      table.artifactType,
    ),
    runArtifactKeyUnique: uniqueIndex("official_web_run_artifacts_run_type_key_idx").on(
      table.runId,
      table.artifactType,
      table.objectKey,
    ),
  }),
);

export const runOutbox = officialWeb.table(
  "run_outbox",
  {
    eventId: text("event_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => crawlRuns.runId, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => ({
    processedAvailableIndex: index("official_web_run_outbox_processed_available_idx").on(
      table.processedAt,
      table.availableAt,
    ),
    runOccurredIndex: index("official_web_run_outbox_run_occurred_idx").on(
      table.runId,
      table.occurredAt,
    ),
  }),
);
