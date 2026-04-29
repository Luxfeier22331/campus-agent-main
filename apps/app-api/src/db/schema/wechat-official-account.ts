import { index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const wechatOfficialAccount = pgSchema("wechat_official_account");

export const wechatOfficialAccountCaptureRuns = wechatOfficialAccount.table(
	"capture_runs",
	{
		runId: text("run_id").primaryKey(),
		sourceChannel: text("source_channel").notNull(),
		provider: text("provider").notNull(),
		accountName: text("account_name").notNull(),
		accountSlug: text("account_slug").notNull(),
		schedulerRunKey: text("scheduler_run_key").notNull(),
		triggerType: text("trigger_type").notNull(),
		collectorVersion: text("collector_version").notNull(),
		providerBaseUrl: text("provider_base_url").notNull(),
		requestSummaryJson: jsonb("request_summary_json").$type<Record<string, unknown>>().notNull(),
		startFingerprintSha256: text("start_fingerprint_sha256").notNull(),
		status: text("status").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
		latestHeartbeatSequence: integer("latest_heartbeat_sequence").notNull().default(0),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
		summaryJson: jsonb("summary_json").$type<Record<string, unknown> | null>(),
		terminalPayloadSha256: text("terminal_payload_sha256"),
		terminalErrorCode: text("terminal_error_code"),
		terminalErrorMessage: text("terminal_error_message"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		accountSchedulerRunKeyUnique: uniqueIndex(
			"wechat_official_account_capture_runs_account_scheduler_idx",
		).on(table.provider, table.accountSlug, table.schedulerRunKey),
		statusStartedAtIndex: index("wechat_official_account_capture_runs_status_started_at_idx").on(
			table.status,
			table.startedAt,
		),
		accountStartedAtIndex: index("wechat_official_account_capture_runs_account_started_at_idx").on(
			table.accountSlug,
			table.startedAt,
		),
	}),
);

export const wechatOfficialAccountRunHeartbeats = wechatOfficialAccount.table(
	"run_heartbeats",
	{
		heartbeatId: text("heartbeat_id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => wechatOfficialAccountCaptureRuns.runId, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
		countsJson: jsonb("counts_json").$type<Record<string, number>>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		runSequenceUnique: uniqueIndex("wechat_official_account_run_heartbeats_run_sequence_idx").on(
			table.runId,
			table.sequence,
		),
		runObservedAtIndex: index("wechat_official_account_run_heartbeats_run_observed_at_idx").on(
			table.runId,
			table.observedAt,
		),
	}),
);

export const wechatOfficialAccountRunArtifacts = wechatOfficialAccount.table(
	"run_artifacts",
	{
		artifactId: text("artifact_id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => wechatOfficialAccountCaptureRuns.runId, { onDelete: "cascade" }),
		artifactType: text("artifact_type").notNull(),
		objectKey: text("object_key").notNull(),
		contentSha256: text("content_sha256").notNull(),
		byteSize: integer("byte_size"),
		recordCount: integer("record_count"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		runArtifactTypeIndex: index("wechat_official_account_run_artifacts_run_type_idx").on(
			table.runId,
			table.artifactType,
		),
		runArtifactKeyUnique: uniqueIndex("wechat_official_account_run_artifacts_run_type_key_idx").on(
			table.runId,
			table.artifactType,
			table.objectKey,
		),
	}),
);
