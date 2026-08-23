import { z } from "zod";

export {
	type InternalPortalCredential,
	InternalPortalCredentialCreateSchema,
	InternalPortalCredentialListSchema,
	type InternalPortalCredentialOutcome,
	InternalPortalCredentialOutcomeSchema,
	InternalPortalCredentialResponseSchema,
	InternalPortalCredentialRevealSchema,
	InternalPortalCredentialSchema,
	InternalPortalCredentialUpdateSchema,
} from "campus-contracts/internal-portal-credential";

const IsoDateTimeSchema = z.string().datetime();
const HttpsUrlSchema = z
	.string()
	.url()
	.refine((value) => new URL(value).protocol === "https:", "external links must use HTTPS");

export const OpsOverviewWindowSchema = z.enum(["15m", "1h", "6h", "24h"]);
export const OpsRequestWindowSchema = z.enum(["15m", "1h", "6h", "24h", "7d"]);
export const OpsHealthStatusSchema = z.enum(["HEALTHY", "DEGRADED", "OUTAGE", "UNKNOWN"]);
export const OpsDataStateSchema = z.enum(["FRESH", "PARTIAL", "STALE", "NO_DATA", "UNAVAILABLE"]);

export const NoticePipelineOperationSchema = z.enum([
	"notice-sync",
	"notice-backfill",
	"notice-classify-missing",
	"notice-classify-one",
	"notice-publish-all",
	"notice-publish-one",
]);
export type NoticePipelineOperation = z.infer<typeof NoticePipelineOperationSchema>;

const NoticeIdSchema = z.number().int().positive();
const NoticeStartDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/u)
	.refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "invalid start date");

export const NoticePipelineJobCreateSchema = z.discriminatedUnion("operation", [
	z.object({ operation: z.literal("notice-sync") }).strict(),
	z.object({ operation: z.literal("notice-backfill"), startDate: NoticeStartDateSchema }).strict(),
	z.object({ operation: z.literal("notice-classify-missing") }).strict(),
	z.object({ operation: z.literal("notice-classify-one"), noticeId: NoticeIdSchema }).strict(),
	z.object({ operation: z.literal("notice-publish-all") }).strict(),
	z.object({ operation: z.literal("notice-publish-one"), noticeId: NoticeIdSchema }).strict(),
]);
export type NoticePipelineJobCreate = z.infer<typeof NoticePipelineJobCreateSchema>;

export const NoticePipelineJobStatusSchema = z.enum(["pending", "running", "succeeded", "failed"]);
export const NoticePipelineJobSummarySchema = z.record(
	z.string().min(1),
	z.union([z.number().int().nonnegative(), z.string().max(200), z.boolean()]),
);
export const NoticePipelineJobSchema = z
	.object({
		completedAt: IsoDateTimeSchema.nullable(),
		createdAt: IsoDateTimeSchema,
		error: z.string().max(500).nullable(),
		jobName: z.string().min(1),
		operation: NoticePipelineOperationSchema,
		startedAt: IsoDateTimeSchema.nullable(),
		status: NoticePipelineJobStatusSchema,
		summary: NoticePipelineJobSummarySchema.nullable(),
	})
	.strict();
export type NoticePipelineJob = z.infer<typeof NoticePipelineJobSchema>;
export const NoticePipelineJobResponseSchema = z.object({ job: NoticePipelineJobSchema }).strict();
export const NoticePipelineJobListResponseSchema = z
	.object({ jobs: z.array(NoticePipelineJobSchema).max(50) })
	.strict();

export const ModelSettingKindSchema = z.enum(["llm", "embedding", "reranker", "notice_classifier"]);
export type ModelSettingKind = z.infer<typeof ModelSettingKindSchema>;

export const ModelProviderSchema = z.enum([
	"openai",
	"openai-compatible",
	"cohere",
	"cohere-compatible",
]);

export const ModelSettingLatestValidationSchema = z.object({
	errorCode: z.string().min(1).optional(),
	message: z.string(),
	observedDimensions: z.number().int().positive().optional(),
	status: z.enum(["passed", "failed"]),
	validatedAt: IsoDateTimeSchema,
	validatedBy: z.string().min(1),
});
export type ModelSettingLatestValidation = z.infer<typeof ModelSettingLatestValidationSchema>;

export const ModelDiscoveryRequestSchema = z
	.object({
		apiKey: z
			.string()
			.max(16 * 1024)
			.optional(),
		baseUrl: z.string().url(),
		provider: ModelProviderSchema,
	})
	.strict();
export type ModelDiscoveryRequest = z.infer<typeof ModelDiscoveryRequestSchema>;

export const ModelDiscoveryResponseSchema = z
	.object({
		models: z.array(z.string().trim().min(1).max(256)).max(500),
		sampledAt: IsoDateTimeSchema,
	})
	.strict();
export type ModelDiscoveryResponse = z.infer<typeof ModelDiscoveryResponseSchema>;

export const ExecutionModelSettingSchema = z.object({
	baseUrl: z.string().url(),
	credentialConfigured: z.boolean(),
	kind: ModelSettingKindSchema,
	latestValidation: ModelSettingLatestValidationSchema.nullable(),
	model: z.string().min(1),
	provider: ModelProviderSchema,
	transport: z.enum(["responses", "chat_completions", "embeddings", "rerank"]),
	updatedAt: IsoDateTimeSchema,
	updatedBy: z.string().min(1),
});

export const EmbeddingContractSchema = z
	.object({
		dimensions: z.number().int().positive(),
		model: z.string().trim().min(1).max(256),
		provider: z.enum(["openai", "openai-compatible"]),
		transport: z.enum(["responses", "chat_completions", "embeddings"]),
	})
	.strict();

export const ExecutionModelSettingsStatusSchema = z.object({
	embeddingContract: EmbeddingContractSchema,
	sampledAt: IsoDateTimeSchema,
	settings: z.object({
		embedding: ExecutionModelSettingSchema.nullable(),
		llm: ExecutionModelSettingSchema.nullable(),
		reranker: ExecutionModelSettingSchema.nullable(),
		notice_classifier: ExecutionModelSettingSchema.nullable(),
	}),
});

export type ExecutionModelSettingsStatus = z.infer<typeof ExecutionModelSettingsStatusSchema>;

const LLMModelSettingUpdateBaseSchema = z.object({
	apiKey: z
		.string()
		.max(16 * 1024)
		.optional(),
	baseUrl: z.string().url(),
	model: z.string().trim().min(1).max(256),
	provider: z.enum(["openai", "openai-compatible"]),
});

export const LLMModelSettingUpdateSchema = LLMModelSettingUpdateBaseSchema.extend({
	transport: z.enum(["responses", "chat_completions"]),
}).strict();

export const EmbeddingModelSettingUpdateSchema = z
	.object({
		apiKey: z
			.string()
			.trim()
			.min(1)
			.max(16 * 1024)
			.optional(),
		baseUrl: z.string().url(),
	})
	.strict();

export const RerankerModelSettingUpdateSchema = z
	.object({
		apiKey: z
			.string()
			.max(16 * 1024)
			.optional(),
		baseUrl: z.string().url(),
		model: z.string().trim().min(1).max(256),
		provider: z.enum(["cohere", "cohere-compatible"]),
	})
	.strict();

export type ModelSettingUpdate =
	| z.infer<typeof LLMModelSettingUpdateSchema>
	| z.infer<typeof EmbeddingModelSettingUpdateSchema>
	| z.infer<typeof RerankerModelSettingUpdateSchema>;

export const InternalPortalAutomationTokenMetadataSchema = z
	.object({
		createdAt: IsoDateTimeSchema,
		name: z.string().trim().min(1).max(80),
		revokedAt: IsoDateTimeSchema.nullable(),
		tokenId: z.string().uuid(),
	})
	.strict();
export type InternalPortalAutomationTokenMetadata = z.infer<
	typeof InternalPortalAutomationTokenMetadataSchema
>;

export const InternalPortalAutomationTokenSchema =
	InternalPortalAutomationTokenMetadataSchema.extend({
		tokenValue: z.string().min(1).max(512),
	}).strict();
export type InternalPortalAutomationToken = z.infer<typeof InternalPortalAutomationTokenSchema>;

export const InternalPortalAutomationTokenListSchema = z
	.object({
		endpoint: z.string().url(),
		tokens: z.array(InternalPortalAutomationTokenMetadataSchema),
	})
	.strict();

export const InternalPortalAutomationTokenResponseSchema = z
	.object({ token: InternalPortalAutomationTokenSchema })
	.strict();

export const InternalPortalAutomationTokenMetadataResponseSchema = z
	.object({ token: InternalPortalAutomationTokenMetadataSchema })
	.strict();

export const InternalPortalAutomationTokenCreateSchema = z
	.object({ name: z.string().trim().min(1).max(80) })
	.strict();

export const InternalPortalAutomationCredentialUpdateSchema = z
	.object({
		ssoTgc: z
			.string()
			.min(1)
			.max(16 * 1024),
	})
	.strict();
export type InternalPortalAutomationCredentialUpdate = z.infer<
	typeof InternalPortalAutomationCredentialUpdateSchema
>;

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
const AgentUsageStateSchema = z.enum([
	"NOT_STARTED",
	"IN_PROGRESS",
	"COMPLETE",
	"PARTIAL",
	"UNAVAILABLE",
]);

const OpsJourneyEntrySchema = z.enum(["CAMPUS_WEB", "OTHER"]);
const OpsAssistantMessageKindSchema = z.enum(["answer", "clarification", "no_answer", "error"]);
const OpsJourneyResultSchema = z.discriminatedUnion("state", [
	z.object({ kind: z.null(), state: z.literal("PENDING") }),
	z.object({ kind: OpsAssistantMessageKindSchema, state: z.literal("WRITTEN") }),
	z.object({ kind: z.null(), state: z.literal("MISSING") }),
]);

const OpsRequestJourneySchema = z.object({
	entry: OpsJourneyEntrySchema,
	result: OpsJourneyResultSchema,
});

const ExternalLinkSchema = z.object({
	href: HttpsUrlSchema.nullable(),
	isAvailable: z.boolean(),
	label: z.string().min(1),
	source: z.enum(["LANGFUSE", "TEMPORAL", "SENTRY"]),
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
			source: z.literal("REQUESTS"),
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
	source: z.literal("SENTRY"),
	to: IsoDateTimeSchema,
	truncated: z.boolean(),
});

export type OpsDataState = z.infer<typeof OpsDataStateSchema>;
export type OpsHealthStatus = z.infer<typeof OpsHealthStatusSchema>;
export type OpsOverviewResponse = z.infer<typeof OpsOverviewResponseSchema>;
export type OpsOverviewWindow = z.infer<typeof OpsOverviewWindowSchema>;
export type OpsRequestDetailResponse = z.infer<typeof OpsRequestDetailResponseSchema>;
export type OpsRequestListView = z.infer<typeof OpsRequestListViewSchema>;
export type OpsSentryIssuesResponse = z.infer<typeof OpsSentryIssuesResponseSchema>;
export type OpsRequestListResponse = z.infer<typeof OpsRequestListResponseSchema>;
export type OpsRequestSummary = z.infer<typeof OpsRequestSummarySchema>;
export type OpsRequestWindow = z.infer<typeof OpsRequestWindowSchema>;
