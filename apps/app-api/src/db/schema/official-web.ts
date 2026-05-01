import {
	index,
	integer,
	jsonb,
	pgSchema,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

const officialWeb = pgSchema("official_web");

export const crawlRuns = officialWeb.table(
	"crawl_runs",
	{
		runId: text("run_id").primaryKey(),
		siteId: text("site_id").notNull(),
		schedulerRunKey: text("scheduler_run_key").notNull(),
		runIntent: text("run_intent").notNull().default("baseline"),
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
		ingestionExecutionStatus: text("ingestion_execution_status").notNull().default("pending"),
		ingestionExecutionRef: text("ingestion_execution_ref"),
		ingestionExecutionUpdatedAt: timestamp("ingestion_execution_updated_at", {
			withTimezone: true,
		}),
		ingestionExecutionErrorCode: text("ingestion_execution_error_code"),
		ingestionExecutionErrorMessage: text("ingestion_execution_error_message"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		siteSchedulerRunKeyUnique: uniqueIndex("official_web_crawl_runs_site_scheduler_idx").on(
			table.siteId,
			table.schedulerRunKey,
			table.runIntent,
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

export const pageObservations = officialWeb.table(
	"page_observations",
	{
		observationId: text("observation_id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => crawlRuns.runId, { onDelete: "cascade" }),
		siteId: text("site_id").notNull(),
		runIntent: text("run_intent").notNull(),
		host: text("host").notNull(),
		requestedUrl: text("requested_url").notNull(),
		finalUrl: text("final_url").notNull(),
		normalizedCanonicalUrl: text("normalized_canonical_url").notNull(),
		pageFamily: text("page_family").notNull(),
		pageTitleNormalized: text("page_title_normalized").notNull(),
		discoveryMethod: text("discovery_method").notNull(),
		discoveredFromUrl: text("discovered_from_url"),
		rawAssetId: text("raw_asset_id"),
		rawVersionId: text("raw_version_id"),
		httpStatus: integer("http_status"),
		contentType: text("content_type"),
		etag: text("etag"),
		lastModified: text("last_modified"),
		responseBodyHash: text("response_body_hash"),
		mainContentHash: text("main_content_hash"),
		fetchDisposition: text("fetch_disposition").notNull(),
		changeStatus: text("change_status").notNull(),
		lastChangeReason: text("last_change_reason").notNull(),
		cadenceClass: text("cadence_class").notNull(),
		priorityScore: integer("priority_score").notNull(),
		nextEligibleFetchAt: timestamp("next_eligible_fetch_at", { withTimezone: true }).notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		runObservedAtIndex: index("official_web_page_observations_run_observed_at_idx").on(
			table.runId,
			table.observedAt,
		),
		siteCanonicalObservedAtIndex: index(
			"official_web_page_observations_site_url_observed_at_idx",
		).on(table.siteId, table.normalizedCanonicalUrl, table.observedAt),
		changeStatusObservedAtIndex: index(
			"official_web_page_observations_change_status_observed_at_idx",
		).on(table.changeStatus, table.observedAt),
	}),
);

export const pageFreshness = officialWeb.table(
	"page_freshness",
	{
		siteId: text("site_id").notNull(),
		normalizedCanonicalUrl: text("normalized_canonical_url").notNull(),
		host: text("host").notNull(),
		pageFamily: text("page_family").notNull(),
		pageTitleNormalized: text("page_title_normalized").notNull(),
		discoveredFromUrl: text("discovered_from_url"),
		discoveryMethod: text("discovery_method").notNull(),
		lastFetchDisposition: text("last_fetch_disposition").notNull(),
		lastHttpStatus: integer("last_http_status"),
		contentType: text("content_type"),
		etag: text("etag"),
		lastModified: text("last_modified"),
		responseBodyHash: text("response_body_hash"),
		mainContentHash: text("main_content_hash"),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
		lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
		lastNotModifiedAt: timestamp("last_not_modified_at", { withTimezone: true }),
		cadenceClass: text("cadence_class").notNull(),
		priorityScore: integer("priority_score").notNull(),
		nextEligibleFetchAt: timestamp("next_eligible_fetch_at", { withTimezone: true }).notNull(),
		lastSuccessfulRunId: text("last_successful_run_id"),
		lastChangeReason: text("last_change_reason").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		pageFreshnessPk: primaryKey({
			columns: [table.siteId, table.normalizedCanonicalUrl],
			name: "official_web_page_freshness_pk",
		}),
		cadenceEligibleIndex: index("official_web_page_freshness_cadence_eligible_idx").on(
			table.cadenceClass,
			table.nextEligibleFetchAt,
		),
		hostUpdatedAtIndex: index("official_web_page_freshness_host_updated_at_idx").on(
			table.host,
			table.updatedAt,
		),
		lastSeenAtIndex: index("official_web_page_freshness_last_seen_at_idx").on(table.lastSeenAt),
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

export const runAdmissionDecisions = officialWeb.table(
	"run_admission_decisions",
	{
		decisionId: text("decision_id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => crawlRuns.runId, { onDelete: "cascade" }),
		siteId: text("site_id").notNull(),
		decision: text("decision").notNull(),
		reasonCode: text("reason_code").notNull(),
		reason: text("reason").notNull(),
		decidedBy: text("decided_by").notNull(),
		decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
		evidenceJson: jsonb("evidence_json").$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		runUnique: uniqueIndex("official_web_run_admission_decisions_run_idx").on(table.runId),
		siteDecisionDecidedAtIndex: index("official_web_run_admission_decisions_site_decision_idx").on(
			table.siteId,
			table.decision,
			table.decidedAt,
		),
	}),
);
