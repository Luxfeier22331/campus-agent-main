import { boolean, index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

import type { RequestDiagnosticsSummary } from "../../modules/request-diagnostics";
import type { VersionQuery } from "../../modules/version-query";

const operator = pgSchema("operator");

interface OfficialWebArtifactProjectionJson {
	artifactType: string;
	byteSize: number | null;
	contentSha256: string;
	objectKey: string;
	recordCount: number | null;
}

interface AuthenticatedNoticeTimelineEventJson {
	eventId?: string | null;
	stage: string;
	status: string;
	occurredAt: string;
	summary: string;
	payload?: Record<string, unknown> | null;
}

interface RequestAuditDiagnosticsJson {
	aclAnomalyCode: string | null;
	bridgeDurationMs?: number | null;
	decision?: string | null;
	durationMs?: number | null;
	failClosed: boolean | null;
	failureKind?: string | null;
	httpStatus?: number | null;
	lane?: string | null;
	queueWaitMs?: number | null;
	retryable?: boolean | null;
	sourceDocIds: string[];
}

interface MetricRollupMetricsJson {
	approvalRequiredCount: number;
	citationEligibleCount: number;
	citationMissCount: number;
	emptyRecallCount: number;
	needsClarificationCount: number;
	noAnswerCount: number;
	rejectedCount: number;
	requestCount: number;
	retrievalEligibleCount: number;
}

interface QualityBadcaseGradeJson {
	graderVersion: string;
	result: string;
	score: number | null;
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
		versionQueryJson: jsonb("version_query_json").$type<VersionQuery | null>(),
		resolvedScopeJson: jsonb("resolved_scope_json").$type<Record<string, unknown> | null>(),
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
		eventTypeOccurredAtIndex: index(
			"operator_request_audit_projection_event_type_occurred_at_idx",
		).on(table.eventType, table.occurredAt),
		statusOccurredAtIndex: index("operator_request_audit_projection_status_occurred_at_idx").on(
			table.status,
			table.occurredAt,
		),
	}),
);

export const metricRollup = operator.table(
	"metric_rollup",
	{
		rollupId: text("rollup_id").primaryKey(),
		requestId: text("request_id").notNull(),
		domain: text("domain").notNull(),
		granularity: text("granularity").notNull(),
		bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
		bucketEnd: timestamp("bucket_end", { withTimezone: true }).notNull(),
		surface: text("surface").notNull(),
		selectedTarget: text("selected_target"),
		requestedCapability: text("requested_capability"),
		principalType: text("principal_type").notNull(),
		collection: text("collection"),
		modelName: text("model_name"),
		metricsJson: jsonb("metrics_json").$type<MetricRollupMetricsJson>().notNull(),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		domainGranularityBucketStartIndex: index(
			"operator_metric_rollup_domain_granularity_bucket_idx",
		).on(table.domain, table.granularity, table.bucketStart),
		requestGranularityBucketStartIndex: index(
			"operator_metric_rollup_request_granularity_bucket_idx",
		).on(table.requestId, table.granularity, table.bucketStart),
		domainSurfaceBucketStartIndex: index("operator_metric_rollup_domain_surface_bucket_idx").on(
			table.domain,
			table.surface,
			table.bucketStart,
		),
		domainTargetBucketStartIndex: index("operator_metric_rollup_domain_target_bucket_idx").on(
			table.domain,
			table.selectedTarget,
			table.bucketStart,
		),
	}),
);

export const qualityBadcaseProjection = operator.table(
	"quality_badcase_projection",
	{
		badcaseId: text("badcase_id").primaryKey(),
		requestId: text("request_id").notNull(),
		traceId: text("trace_id").notNull(),
		surface: text("surface").notNull(),
		selectedTarget: text("selected_target"),
		status: text("status").notNull(),
		causeClass: text("cause_class").notNull(),
		detectedBy: text("detected_by").notNull(),
		openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
		summary: text("summary").notNull(),
		gradeJson: jsonb("grade_json").$type<QualityBadcaseGradeJson | null>(),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		statusOpenedAtIndex: index("operator_quality_badcase_projection_status_opened_at_idx").on(
			table.status,
			table.openedAt,
		),
		causeClassOpenedAtIndex: index("operator_quality_badcase_projection_cause_opened_at_idx").on(
			table.causeClass,
			table.openedAt,
		),
		detectedByOpenedAtIndex: index(
			"operator_quality_badcase_projection_detected_by_opened_at_idx",
		).on(table.detectedBy, table.openedAt),
		requestOpenedAtIndex: index("operator_quality_badcase_projection_request_opened_at_idx").on(
			table.requestId,
			table.openedAt,
		),
	}),
);

export const qualityGradeProjection = operator.table(
	"quality_grade_projection",
	{
		gradeId: text("grade_id").primaryKey(),
		requestId: text("request_id").notNull(),
		traceId: text("trace_id").notNull(),
		surface: text("surface").notNull(),
		requestStartedAt: timestamp("request_started_at", { withTimezone: true }).notNull(),
		selectedTarget: text("selected_target"),
		requestedCapability: text("requested_capability"),
		principalType: text("principal_type").notNull(),
		collection: text("collection"),
		modelName: text("model_name"),
		gradeSource: text("grade_source").notNull(),
		gradeDomain: text("grade_domain").notNull(),
		verdict: text("verdict").notNull(),
		scoreMilli: integer("score_milli"),
		graderVersion: text("grader_version").notNull(),
		rationaleSummary: text("rationale_summary"),
		sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		requestStartedAtIndex: index("operator_quality_grade_projection_request_started_at_idx").on(
			table.requestStartedAt,
		),
		domainRequestStartedAtIndex: index(
			"operator_quality_grade_projection_domain_started_at_idx",
		).on(table.gradeDomain, table.requestStartedAt),
		requestSampledAtIndex: index("operator_quality_grade_projection_request_sampled_at_idx").on(
			table.requestId,
			table.sampledAt,
		),
		domainSurfaceStartedAtIndex: index(
			"operator_quality_grade_projection_domain_surface_started_at_idx",
		).on(table.gradeDomain, table.surface, table.requestStartedAt),
	}),
);

export const traceBacklinkProjection = operator.table(
	"trace_backlink_projection",
	{
		requestId: text("request_id").primaryKey(),
		traceId: text("trace_id").notNull(),
		traceLink: text("trace_link"),
		issueLink: text("issue_link"),
		issueFingerprint: text("issue_fingerprint"),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		traceProjectedAtIndex: index("operator_trace_backlink_projection_trace_projected_at_idx").on(
			table.traceId,
			table.projectedAt,
		),
	}),
);

export const officialWebRunProjection = operator.table(
	"official_web_run_projection",
	{
		runId: text("run_id").primaryKey(),
		siteId: text("site_id").notNull(),
		runIntent: text("run_intent").notNull().default("baseline"),
		status: text("status").notNull(),
		ingestionDispatchStatus: text("ingestion_dispatch_status").notNull(),
		ingestionDispatchRef: text("ingestion_dispatch_ref"),
		ingestionExecutionStatus: text("ingestion_execution_status").notNull().default("pending"),
		ingestionExecutionRef: text("ingestion_execution_ref"),
		ingestionExecutionUpdatedAt: timestamp("ingestion_execution_updated_at", {
			withTimezone: true,
		}),
		ingestionExecutionErrorCode: text("ingestion_execution_error_code"),
		ingestionExecutionErrorMessage: text("ingestion_execution_error_message"),
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
		latestIngestionExecutionStatus: text("latest_ingestion_execution_status"),
		latestIngestionExecutionUpdatedAt: timestamp("latest_ingestion_execution_updated_at", {
			withTimezone: true,
		}),
		latestIngestionExecutionErrorCode: text("latest_ingestion_execution_error_code"),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		latestRunStatusProjectedAtIndex: index(
			"operator_official_web_site_projection_status_projected_at_idx",
		).on(table.latestRunStatus, table.projectedAt),
	}),
);

export const authenticatedNoticeProcessingProjection = operator.table(
	"authenticated_notice_processing_projection",
	{
		processingId: text("processing_id").primaryKey(),
		noticeKey: text("notice_key").notNull(),
		sourceChannel: text("source_channel").notNull(),
		sourceSurface: text("source_surface").notNull(),
		siteId: text("site_id").notNull(),
		noticeId: text("notice_id").notNull(),
		title: text("title").notNull(),
		runId: text("run_id"),
		jobId: text("job_id"),
		replayBatchId: text("replay_batch_id"),
		enqueueSource: text("enqueue_source"),
		queueStatus: text("queue_status").notNull(),
		lifecycleStatus: text("lifecycle_status").notNull(),
		latestStage: text("latest_stage").notNull(),
		targetSurface: text("target_surface"),
		candidateKind: text("candidate_kind"),
		materializationStatus: text("materialization_status"),
		releaseId: text("release_id"),
		current: boolean("current").notNull().default(false),
		toolReady: boolean("tool_ready").notNull().default(false),
		readModelCountsJson: jsonb("read_model_counts_json")
			.$type<Record<string, number | string | boolean | null>>()
			.notNull()
			.default({}),
		childTaskSummaryJson: jsonb("child_task_summary_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		timelineJson: jsonb("timeline_json")
			.$type<AuthenticatedNoticeTimelineEventJson[]>()
			.notNull()
			.default([]),
		downstreamJson: jsonb("downstream_json").$type<Record<string, unknown> | null>(),
		lastErrorCode: text("last_error_code"),
		lastErrorMessage: text("last_error_message"),
		attemptCount: integer("attempt_count").notNull().default(0),
		lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
		sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
		producerVersion: text("producer_version").notNull(),
		redactionVersion: text("redaction_version").notNull(),
	},
	(table) => ({
		noticeProjectedAtIndex: index("operator_auth_notice_processing_notice_projected_idx").on(
			table.noticeId,
			table.projectedAt,
		),
		noticeKeyProjectedAtIndex: index("operator_auth_notice_processing_notice_key_projected_idx").on(
			table.noticeKey,
			table.projectedAt,
		),
		statusProjectedAtIndex: index("operator_auth_notice_processing_status_projected_idx").on(
			table.lifecycleStatus,
			table.projectedAt,
		),
		targetProjectedAtIndex: index("operator_auth_notice_processing_target_projected_idx").on(
			table.targetSurface,
			table.candidateKind,
			table.projectedAt,
		),
		runProjectedAtIndex: index("operator_auth_notice_processing_run_projected_idx").on(
			table.runId,
			table.projectedAt,
		),
	}),
);

export const authenticatedNoticeProcessingEventProjection = operator.table(
	"authenticated_notice_processing_event_projection",
	{
		eventId: text("event_id").primaryKey(),
		processingId: text("processing_id").notNull(),
		noticeKey: text("notice_key").notNull(),
		noticeId: text("notice_id").notNull(),
		runId: text("run_id"),
		jobId: text("job_id"),
		stage: text("stage").notNull(),
		status: text("status").notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
		summary: text("summary").notNull(),
		payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		processingOccurredAtIndex: index("operator_auth_notice_event_processing_occurred_idx").on(
			table.processingId,
			table.occurredAt,
		),
		noticeOccurredAtIndex: index("operator_auth_notice_event_notice_occurred_idx").on(
			table.noticeId,
			table.occurredAt,
		),
	}),
);
