import { z } from "zod";

const IsoDateTimeSchema = z.string().datetime();
const HttpsUrlSchema = z
	.string()
	.url()
	.refine((value) => new URL(value).protocol === "https:", "external links must use HTTPS");

export const OpsOverviewWindowSchema = z.enum(["15m", "1h", "6h", "24h"]);
export const OpsRequestWindowSchema = z.enum(["15m", "1h", "6h", "24h", "7d"]);
export const OpsHealthStatusSchema = z.enum(["HEALTHY", "DEGRADED", "OUTAGE", "UNKNOWN"]);
export const OpsDataStateSchema = z.enum(["FRESH", "PARTIAL", "STALE", "NO_DATA", "UNAVAILABLE"]);

export const ModelSettingKindSchema = z.enum(["llm", "embedding"]);
export type ModelSettingKind = z.infer<typeof ModelSettingKindSchema>;

export const ModelSettingLatestValidationSchema = z.object({
	errorCode: z.string().min(1).optional(),
	message: z.string(),
	observedDimensions: z.number().int().positive().optional(),
	status: z.enum(["passed", "failed"]),
	validatedAt: IsoDateTimeSchema,
	validatedBy: z.string().min(1),
});
export type ModelSettingLatestValidation = z.infer<typeof ModelSettingLatestValidationSchema>;

export const ModelSettingValidationResponseSchema = z.object({
	kind: ModelSettingKindSchema,
	validation: ModelSettingLatestValidationSchema,
});
export type ModelSettingValidationResponse = z.infer<typeof ModelSettingValidationResponseSchema>;

export const ExecutionModelSettingSchema = z.object({
	baseUrl: z.string().url(),
	credentialConfigured: z.boolean(),
	credentialLast4: z.string().max(4).optional(),
	dimensions: z.number().int().positive().optional(),
	kind: ModelSettingKindSchema,
	latestValidation: ModelSettingLatestValidationSchema.nullable(),
	model: z.string().min(1),
	provider: z.enum(["openai", "openai-compatible"]),
	transport: z.enum(["responses", "chat_completions", "embeddings"]),
	updatedAt: IsoDateTimeSchema,
	updatedBy: z.string().min(1),
});

export const ExecutionModelSettingsStatusSchema = z.object({
	etag: z.string(),
	sampledAt: IsoDateTimeSchema,
	settings: z.object({
		embedding: ExecutionModelSettingSchema.nullable(),
		llm: ExecutionModelSettingSchema.nullable(),
	}),
});

export type ExecutionModelSettingsStatus = z.infer<typeof ExecutionModelSettingsStatusSchema>;

export const ModelSettingUpdateSchema = z
	.object({
		apiKey: z
			.string()
			.max(16 * 1024)
			.optional(),
		baseUrl: z.string().url(),
		model: z.string().trim().min(1).max(256),
		provider: z.enum(["openai", "openai-compatible"]),
		transport: z.enum(["responses", "chat_completions", "embeddings"]),
	})
	.strict();
export type ModelSettingUpdate = z.infer<typeof ModelSettingUpdateSchema>;

export const HindsightModelSettingsUpdateSchema = z
	.object({
		embedding: z.object({
			apiKey: z
				.string()
				.max(16 * 1024)
				.optional(),
			baseUrl: z.string().url(),
		}),
		llm: z.object({
			apiKey: z
				.string()
				.max(16 * 1024)
				.optional(),
			baseUrl: z.string().url(),
			model: z.string().trim().min(1).max(256),
		}),
	})
	.strict();
export type HindsightModelSettingsUpdate = z.infer<typeof HindsightModelSettingsUpdateSchema>;

const HindsightCredentialStatusSchema = z.object({
	baseUrl: z.string().url().nullable(),
	credentialConfigured: z.boolean(),
	credentialLast4: z.string().max(4).nullable(),
});

export const HindsightModelSettingsStatusSchema = z.object({
	applyState: z.enum(["blocked", "pending", "applying", "applied", "failed"]),
	configState: z.enum(["unconfigured", "drifted", "configured"]),
	etag: z.string().min(1),
	embedding: HindsightCredentialStatusSchema.extend({
		dimensions: z.literal(2560),
		model: z.literal("Qwen3-Embedding-4B"),
	}),
	llm: HindsightCredentialStatusSchema.extend({
		model: z.string().nullable(),
		provider: z.literal("openai"),
	}),
	failure: z
		.object({
			message: z.string().min(1).max(512).nullable(),
			reasonCode: z.enum(["HINDSIGHT_REPLICA_FAILURE", "HINDSIGHT_ROLLOUT_STALLED"]),
		})
		.nullable(),
	rerank: z.object({ provider: z.literal("rrf") }),
	runtimeState: z.enum(["running", "scaled_down"]),
	sampledAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema.nullable(),
	updatedBy: z.string().min(1).nullable(),
});

export type HindsightModelSettingsStatus = z.infer<typeof HindsightModelSettingsStatusSchema>;

export const OpsInternalPortalCredentialStatusSchema = z.object({
	configured: z.boolean(),
	updatedAt: IsoDateTimeSchema.nullable(),
	updatedBy: z.string().min(1).nullable(),
});

export const OpsInternalPortalMaintenanceStatusSchema = z.object({
	errorCode: z.string().min(1).nullable(),
	lastAttemptAt: IsoDateTimeSchema.nullable(),
	lastOutcome: z
		.enum([
			"SUCCESS",
			"TRANSIENT_FAILURE",
			"CREDENTIAL_EXPIRED",
			"CREDENTIAL_UNAVAILABLE",
			"RUNNING",
			"UNKNOWN",
		])
		.nullable(),
	lastSuccessAt: IsoDateTimeSchema.nullable(),
	nextRunAt: IsoDateTimeSchema.nullable(),
	noticeProbeSucceeded: z.boolean().nullable(),
	portalSessionEstablished: z.boolean().nullable(),
	scheduleState: z.enum(["ACTIVE", "PAUSED", "MISSING", "UNAVAILABLE"]),
	serviceTicketIssued: z.boolean().nullable(),
});

export const OpsInternalPortalAuthStatusSchema = OpsInternalPortalCredentialStatusSchema.extend({
	maintenance: OpsInternalPortalMaintenanceStatusSchema,
	observedLifetime: z.object({
		lowerBoundSeconds: z.number().int().nonnegative().nullable(),
		upperBoundSeconds: z.number().int().nonnegative().nullable(),
	}),
});

export const OpsInternalPortalAuthUpdateSchema = z
	.object({
		credential: z
			.string()
			.min(1)
			.max(8 * 1024),
	})
	.strict();

const OpsIngestionArtifactRefSchema = z.object({
	byte_size: z.number().int().nonnegative(),
	digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
	kind: z.literal("object_store"),
	uri: z.string().startsWith("s3://"),
});

export const OpsIngestionTaskSchema = z.object({
	collection: z.string().nullable(),
	corpus: z.string().nullable(),
	created_at: IsoDateTimeSchema,
	created_by: z.string().min(1),
	error_code: z.string().nullable().optional(),
	error_message: z.string().nullable().optional(),
	executor_kind: z.enum(["rust_kernel", "source_collector", "typescript_kernel"]),
	has_result: z.boolean().optional(),
	input_contract: z.string().optional(),
	input_ref: OpsIngestionArtifactRefSchema.optional(),
	last_error_code: z.string().nullable().optional(),
	last_error_message: z.string().nullable().optional(),
	output_contract: z.string().optional(),
	pipeline_workflow_id: z.string().nullable(),
	registry_task_id: z.string().min(1),
	result_contract: z.string().nullable(),
	result_ref: OpsIngestionArtifactRefSchema.nullable().optional(),
	retry_of_task_id: z.string().nullable(),
	run_id: z.string().min(1),
	schema_version: z.string().min(1),
	source_channel: z.string().nullable(),
	source_family: z.string().nullable(),
	status: z.enum(["running", "completed", "failed", "canceled"]),
	summary: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
		.nullable(),
	task_id: z.string().min(1),
	updated_at: IsoDateTimeSchema,
	workflow_id: z.string().min(1),
	workflow_run_id: z.string().nullable(),
});

export const OpsIngestionTaskListSchema = z.object({
	page: z.object({ next_cursor: z.string().nullable() }),
	tasks: z.array(OpsIngestionTaskSchema),
});

export const OpsInternalPortalPublicationStatusSchema = z.object({
	errorCode: z.string().nullable(),
	lastAttemptAt: IsoDateTimeSchema.nullable(),
	lastOutcome: z
		.enum([
			"CREDENTIAL_EXPIRED",
			"CREDENTIAL_UNAVAILABLE",
			"DEFERRED",
			"FAILED",
			"PUBLISHED",
			"RUNNING",
			"UNCHANGED",
			"UNKNOWN",
		])
		.nullable(),
	lastReleaseId: z.string().nullable(),
	nextRunAt: IsoDateTimeSchema.nullable(),
	scheduleState: z.enum(["ACTIVE", "PAUSED", "MISSING"]),
	workflowId: z.string().nullable(),
	workflowRunId: z.string().nullable(),
});

const OpsOfflineReleaseStatusSchema = z
	.object({
		checkpoint: z.record(z.string(), z.json()),
		current_release_id: z.string().nullable(),
		item_count: z.number().int().nonnegative().nullable(),
		last_added_count: z.number().int().nonnegative(),
		last_check_at: IsoDateTimeSchema.nullable(),
		last_check_error_code: z.string().nullable(),
		last_check_mode: z.enum(["incremental", "reconcile", "selected"]).nullable(),
		last_check_outcome: z.enum(["published", "unchanged", "deferred", "failed"]).nullable(),
		last_committed_at: IsoDateTimeSchema.nullable(),
		last_published_at: IsoDateTimeSchema.nullable(),
		last_reconcile_at: IsoDateTimeSchema.nullable(),
		last_updated_count: z.number().int().nonnegative(),
		last_withdrawn_count: z.number().int().nonnegative(),
		stream_id: z.string().min(1),
		version: z.number().int().nonnegative(),
	})
	.nullable();

export const OpsInternalPortalIngestionStatusSchema = z.object({
	auth_maintenance: OpsInternalPortalMaintenanceStatusSchema.extend({
		workflowId: z.string().nullable().optional(),
		workflowRunId: z.string().nullable().optional(),
	}),
	file_release: OpsOfflineReleaseStatusSchema,
	notice: z.object({
		publication: OpsInternalPortalPublicationStatusSchema,
		release: OpsOfflineReleaseStatusSchema,
	}),
	schema_version: z.literal("internal_portal_ingestion_status.v1"),
});

export const OpsIngestionWorkflowStartSchema = z.object({
	already_started: z.boolean(),
	request_id: z.string().min(1),
	temporal_status: z.string().min(1),
	workflow_id: z.string().min(1),
	workflow_run_id: z.string().nullable(),
});

export const OpsIngestionTaskRetryStartSchema = z.object({
	retry_of_task_id: z.string().min(1),
	task_id: z.string().min(1),
	workflow_id: z.string().min(1),
	workflow_run_id: z.string().nullable(),
});

export const OpsFileReleaseBatchStartSchema = z.object({
	request_id: z.string().min(1),
	schema_version: z.literal("internal_portal_file_release_batch_start.v1"),
	workflows: z.array(
		z.object({
			alreadyStarted: z.boolean(),
			file_release_id: z.number().int().positive(),
			workflowId: z.string().min(1),
			workflowRunId: z.string().nullable(),
			workflowStatus: z.string().min(1),
		}),
	),
});

const OpsStatusSchema = z.enum([
	"COMPLETED",
	"FAILED",
	"CANCELLED",
	"RUNNING",
	"PENDING",
	"ACTION_REQUIRED",
]);
const OpsRequestLifecyclePhaseSchema = z.enum([
	"PREPARING",
	"WAITING_ADMISSION",
	"QUEUED",
	"RUNNING",
	"STREAMING",
	"FINALIZING",
	"FINISHED",
]);
const OpsProductActionStatusSchema = z.enum(["COMPLETED", "FAILED", "RUNNING", "PENDING"]);

const AgentUsageStateSchema = z.enum([
	"NOT_STARTED",
	"IN_PROGRESS",
	"COMPLETE",
	"PARTIAL",
	"UNAVAILABLE",
]);

const OpsProductCapabilitySchema = z.enum(["CAMPUS_KNOWLEDGE", "TRANSPORT_SCHEDULE", "OTHER"]);

const OpsProductActionSchema = z.object({
	capability: OpsProductCapabilitySchema,
	status: OpsProductActionStatusSchema,
});

const OpsJourneyEntrySchema = z.enum(["CAMPUS_WEB", "OTHER"]);
const OpsAssistantMessageKindSchema = z.enum(["answer", "clarification", "no_answer", "error"]);
const OpsJourneyResultSchema = z.discriminatedUnion("state", [
	z.object({ kind: z.null(), state: z.literal("PENDING") }),
	z.object({ kind: OpsAssistantMessageKindSchema, state: z.literal("WRITTEN") }),
	z.object({ kind: z.null(), state: z.literal("MISSING") }),
]);

const OpsRequestJourneySchema = z.object({
	actions: z.array(OpsProductActionSchema),
	actionsDataState: OpsDataStateSchema,
	entry: OpsJourneyEntrySchema,
	result: OpsJourneyResultSchema,
});

const ExternalLinkSchema = z.object({
	href: HttpsUrlSchema.nullable(),
	isAvailable: z.boolean(),
	label: z.string().min(1),
	source: z.enum(["LANGFUSE", "TEMPORAL", "SENTRY", "AXIOM"]),
});

export const OpsCorrelationIdsSchema = z.object({
	conversationId: z.string().min(1),
	requestId: z.string().min(1),
	runId: z.string().min(1).nullable(),
	traceId: z.string().min(1),
	workflowId: z.string().min(1).nullable(),
});

export const OpsRequestSummarySchema = z.object({
	attentionReason: z.enum(["RESULT_MISSING", "REQUEST_FAILED", "WAITING_USER"]).nullable(),
	completedAt: IsoDateTimeSchema.nullable(),
	durationMs: z.number().int().nonnegative().nullable(),
	journey: OpsRequestJourneySchema,
	lifecyclePhase: OpsRequestLifecyclePhaseSchema,
	question: z.object({
		preview: z.string().min(1),
		truncated: z.boolean(),
	}),
	requestId: z.string().min(1),
	startedAt: IsoDateTimeSchema,
	status: OpsStatusSchema,
	usage: z.object({
		state: AgentUsageStateSchema,
		totalTokens: z.number().int().nonnegative().nullable(),
	}),
});

export const OpsRequestListViewSchema = z.enum(["recent", "attention"]);

export const OpsRequestListResponseSchema = z.object({
	data: z.array(OpsRequestSummarySchema),
	generatedAt: IsoDateTimeSchema,
	page: z.object({
		nextCursor: z.string().min(1).nullable(),
	}),
	statusCounts: z.object({
		actionRequired: z.number().int().nonnegative(),
		cancelled: z.number().int().nonnegative(),
		completed: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		pending: z.number().int().nonnegative(),
		running: z.number().int().nonnegative(),
		total: z.number().int().nonnegative(),
	}),
	view: OpsRequestListViewSchema,
	window: OpsRequestWindowSchema,
});

const OpsProductSourceSchema = z.object({
	collectionLabel: z.string(),
	pageLabel: z.string(),
	primaryAction: z.object({
		disabledReason: z.string().min(1).nullable(),
		external: z.boolean(),
		href: z.string().min(1).nullable(),
		label: z.string().min(1),
	}),
	publisherLabel: z.string(),
	sectionTitle: z.string(),
	snippet: z.string().nullable(),
	title: z.string().min(1),
	versionLabel: z.string(),
});

const OpsProductResultSchema = z.discriminatedUnion("state", [
	z.object({ state: z.literal("PENDING") }),
	z.object({ reasonCode: z.literal("ASSISTANT_MESSAGE_MISSING"), state: z.literal("MISSING") }),
	z.object({
		kind: OpsAssistantMessageKindSchema,
		sources: z.array(OpsProductSourceSchema).max(5),
		state: z.literal("WRITTEN"),
		text: z.string(),
	}),
]);

export const OpsRequestDetailResponseSchema = z.object({
	generatedAt: IsoDateTimeSchema,
	journey: z.object({
		actions: z.array(OpsProductActionSchema),
		actionsDataState: OpsDataStateSchema,
		entry: OpsJourneyEntrySchema,
	}),
	question: z.object({
		text: z.string().min(1),
		turnSequence: z.number().int().nonnegative(),
	}),
	request: z.object({
		completedAt: IsoDateTimeSchema.nullable(),
		durationMs: z.number().int().nonnegative().nullable(),
		lifecyclePhase: OpsRequestLifecyclePhaseSchema,
		requestId: z.string().min(1),
		startedAt: IsoDateTimeSchema,
		status: OpsStatusSchema,
	}),
	result: OpsProductResultSchema,
	technical: z.object({
		correlationIds: OpsCorrelationIdsSchema,
		errorCode: z.string().min(1).nullable(),
		externalLinks: z.array(ExternalLinkSchema),
		runtimeVersions: z.record(z.string(), z.json()),
		terminalReason: z.string().min(1).nullable(),
	}),
	usage: z.object({
		cachedInputTokens: z.number().int().nonnegative().nullable(),
		inputTokens: z.number().int().nonnegative().nullable(),
		outputTokens: z.number().int().nonnegative().nullable(),
		state: AgentUsageStateSchema,
		totalTokens: z.number().int().nonnegative().nullable(),
	}),
});

const SourceStatusSchema = z.object({
	dataState: OpsDataStateSchema,
	reason: z.string().min(1).nullable(),
	status: OpsHealthStatusSchema,
	updatedAt: IsoDateTimeSchema.nullable(),
});

export const OpsOverviewResponseSchema = z.object({
	cache: z.object({
		ageMs: z.number().int().nonnegative(),
		status: z.enum(["FRESH", "STALE"]),
	}),
	externalLinks: z.array(ExternalLinkSchema),
	generatedAt: IsoDateTimeSchema,
	health: z.object({
		dataState: OpsDataStateSchema,
		status: OpsHealthStatusSchema,
	}),
	issues: z.array(
		z.object({
			code: z.string().min(1),
			detail: z.string().min(1),
			severity: z.enum(["CRITICAL", "WARNING", "INFO"]),
			source: z.enum(["REQUESTS", "SERVICE", "TEMPORAL", "TELEMETRY"]),
			title: z.string().min(1),
		}),
	),
	requests: SourceStatusSchema.extend({
		actionRequired: z.number().int().nonnegative(),
		cancelled: z.number().int().nonnegative(),
		completed: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		p95DurationMs: z.number().int().nonnegative().nullable(),
		pending: z.number().int().nonnegative(),
		running: z.number().int().nonnegative(),
		successRate: z.number().min(0).max(1).nullable(),
		total: z.number().int().nonnegative(),
	}),
	services: z.array(
		SourceStatusSchema.extend({
			displayName: z.string().min(1),
			name: z.string().min(1),
		}),
	),
	telemetry: SourceStatusSchema.extend({
		signals: z.array(
			SourceStatusSchema.extend({
				kind: z.enum(["LOGS", "METRICS", "TRACES"]),
				recordCount: z.number().int().nonnegative().nullable(),
			}),
		),
	}),
	temporal: SourceStatusSchema.extend({
		backlogCount: z.number().int().nonnegative(),
		oldestTaskAgeMs: z.number().int().nonnegative().nullable(),
		pollerCount: z.number().int().nonnegative(),
		queues: z.array(
			SourceStatusSchema.extend({
				backlogCount: z.number().int().nonnegative(),
				kind: z.enum(["ACTIVITY", "WORKFLOW", "UNKNOWN"]),
				name: z.string().min(1),
				oldestTaskAgeMs: z.number().int().nonnegative().nullable(),
				pollerCount: z.number().int().nonnegative(),
				taskQueue: z.string().min(1),
			}),
		),
	}),
	trends: z.object({
		data: z.array(
			z.object({
				bucketStart: IsoDateTimeSchema,
				completed: z.number().int().nonnegative(),
				failed: z.number().int().nonnegative(),
				p95DurationMs: z.number().int().nonnegative().nullable(),
				total: z.number().int().nonnegative(),
			}),
		),
		dataState: OpsDataStateSchema,
		reason: z.string().min(1).nullable(),
	}),
	window: OpsOverviewWindowSchema,
});

const AxiomLogRecordSchema = z.object({
	durationMs: z.number().nonnegative().nullable(),
	errorCode: z.string().min(1).nullable(),
	eventType: z.string().min(1).nullable(),
	otelSpanId: z.string().min(1).nullable(),
	otelTraceId: z.string().min(1).nullable(),
	productTraceId: z.string().min(1).nullable(),
	requestId: z.string().min(1),
	serviceName: z.string().min(1).nullable(),
	severityText: z.string().min(1).nullable(),
	source: z.string().min(1).nullable(),
	status: z.string().min(1).nullable(),
	timestamp: IsoDateTimeSchema,
});

const AxiomTraceRecordSchema = z.object({
	duration: z.string().min(1).nullable(),
	hasError: z.boolean().nullable(),
	kind: z.string().min(1).nullable(),
	name: z.string().min(1).nullable(),
	otelSpanId: z.string().min(1),
	otelTraceId: z.string().min(1),
	parentSpanId: z.string().min(1).nullable(),
	productTraceId: z.string().min(1).nullable(),
	requestId: z.string().min(1),
	serviceName: z.string().min(1).nullable(),
	statusCode: z.string().min(1).nullable(),
	timestamp: IsoDateTimeSchema,
});

const ObservabilityBaseSchema = z.object({
	dataState: OpsDataStateSchema,
	from: IsoDateTimeSchema,
	queryDurationMs: z.number().int().nonnegative(),
	queriedAt: IsoDateTimeSchema,
	requestId: z.string().min(1),
	source: z.literal("AXIOM"),
	to: IsoDateTimeSchema,
	traceId: z.string().min(1),
	truncated: z.boolean(),
});

export const OpsObservabilityResponseSchema = z.discriminatedUnion("kind", [
	ObservabilityBaseSchema.extend({
		kind: z.literal("logs"),
		limit: z.literal(200),
		records: z.array(AxiomLogRecordSchema).max(200),
	}),
	ObservabilityBaseSchema.extend({
		kind: z.literal("trace"),
		limit: z.literal(500),
		records: z.array(AxiomTraceRecordSchema).max(500),
	}),
]);

const SentryIssueSummarySchema = z.object({
	eventCount: z.number().int().nonnegative(),
	firstSeen: IsoDateTimeSchema,
	issueId: z.string().min(1),
	lastSeen: IsoDateTimeSchema,
	level: z.string().min(1).nullable(),
	permalink: HttpsUrlSchema,
	projectName: z.string().min(1),
	projectSlug: z.string().min(1),
	shortId: z.string().min(1),
	status: z.string().min(1),
	title: z.string().min(1),
});

export const OpsSentryIssuesResponseSchema = z.object({
	dataState: OpsDataStateSchema,
	from: IsoDateTimeSchema,
	issues: z.array(SentryIssueSummarySchema).max(5),
	limit: z.literal(5),
	queriedAt: IsoDateTimeSchema,
	queryDurationMs: z.number().int().nonnegative(),
	requestId: z.string().min(1),
	searchQuery: z.string().min(1),
	source: z.literal("SENTRY"),
	to: IsoDateTimeSchema,
	traceId: z.string().min(1),
	truncated: z.boolean(),
});

export type OpsDataState = z.infer<typeof OpsDataStateSchema>;
export type OpsHealthStatus = z.infer<typeof OpsHealthStatusSchema>;
export type OpsInternalPortalAuthStatus = z.infer<typeof OpsInternalPortalAuthStatusSchema>;
export type OpsInternalPortalCredentialStatus = z.infer<
	typeof OpsInternalPortalCredentialStatusSchema
>;
export type OpsInternalPortalMaintenanceStatus = z.infer<
	typeof OpsInternalPortalMaintenanceStatusSchema
>;
export type OpsIngestionTask = z.infer<typeof OpsIngestionTaskSchema>;
export type OpsIngestionTaskList = z.infer<typeof OpsIngestionTaskListSchema>;
export type OpsIngestionTaskRetryStart = z.infer<typeof OpsIngestionTaskRetryStartSchema>;
export type OpsInternalPortalIngestionStatus = z.infer<
	typeof OpsInternalPortalIngestionStatusSchema
>;
export type OpsObservabilityResponse = z.infer<typeof OpsObservabilityResponseSchema>;
export type OpsOverviewResponse = z.infer<typeof OpsOverviewResponseSchema>;
export type OpsOverviewWindow = z.infer<typeof OpsOverviewWindowSchema>;
export type OpsRequestDetailResponse = z.infer<typeof OpsRequestDetailResponseSchema>;
export type OpsRequestListView = z.infer<typeof OpsRequestListViewSchema>;
export type OpsSentryIssuesResponse = z.infer<typeof OpsSentryIssuesResponseSchema>;
export type OpsRequestListResponse = z.infer<typeof OpsRequestListResponseSchema>;
export type OpsRequestSummary = z.infer<typeof OpsRequestSummarySchema>;
export type OpsRequestWindow = z.infer<typeof OpsRequestWindowSchema>;
