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

export const ModelDiscoveryRequestSchema = z
	.object({
		apiKey: z
			.string()
			.max(16 * 1024)
			.optional(),
		baseUrl: z.string().url(),
		provider: z.enum(["openai", "openai-compatible"]),
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
	credentialLast4: z.string().max(4).optional(),
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

const ModelSettingUpdateBaseSchema = z.object({
	apiKey: z
		.string()
		.max(16 * 1024)
		.optional(),
	baseUrl: z.string().url(),
	model: z.string().trim().min(1).max(256),
	provider: z.enum(["openai", "openai-compatible"]),
});

export const LLMModelSettingUpdateSchema = ModelSettingUpdateBaseSchema.extend({
	transport: z.enum(["responses", "chat_completions"]),
}).strict();

export const EmbeddingModelSettingUpdateSchema = ModelSettingUpdateBaseSchema.strict();

export type ModelSettingUpdate =
	| z.infer<typeof LLMModelSettingUpdateSchema>
	| z.infer<typeof EmbeddingModelSettingUpdateSchema>;

export const InternalPortalCredentialOutcomeSchema = z.enum([
	"valid",
	"credential_rejected",
	"check_failed",
]);
export type InternalPortalCredentialOutcome = z.infer<typeof InternalPortalCredentialOutcomeSchema>;

export const InternalPortalCredentialSchema = z
	.object({
		credentialId: z.string().uuid(),
		name: z.string().trim().min(1).max(80),
		version: z.number().int().positive(),
		createdAt: IsoDateTimeSchema,
		updatedAt: IsoDateTimeSchema,
		lastAttemptAt: IsoDateTimeSchema.nullable(),
		lastSuccessfulAt: IsoDateTimeSchema.nullable(),
		lastOutcome: InternalPortalCredentialOutcomeSchema.nullable(),
	})
	.strict();
export type InternalPortalCredential = z.infer<typeof InternalPortalCredentialSchema>;

export const InternalPortalCredentialListSchema = z
	.object({ credentials: z.array(InternalPortalCredentialSchema) })
	.strict();

export const InternalPortalCredentialResponseSchema = z
	.object({ credential: InternalPortalCredentialSchema })
	.strict();

export const InternalPortalCredentialCreateSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		ssoTgc: z
			.string()
			.min(1)
			.max(16 * 1024),
	})
	.strict();

export const InternalPortalCredentialUpdateSchema = z.union([
	z.object({ name: z.string().trim().min(1).max(80) }).strict(),
	z
		.object({
			ssoTgc: z
				.string()
				.min(1)
				.max(16 * 1024),
		})
		.strict(),
]);

export const InternalPortalCredentialRevealSchema = z
	.object({
		credentialId: z.string().uuid(),
		ssoTgc: z.string().min(1),
		version: z.number().int().positive(),
	})
	.strict();

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

const AxiomLogRecordSchema = z.object({
	durationMs: z.number().nonnegative().nullable(),
	errorCode: z.string().min(1).nullable(),
	eventType: z.string().min(1).nullable(),
	requestId: z.string().min(1),
	serviceName: z.string().min(1).nullable(),
	severityText: z.string().min(1).nullable(),
	source: z.string().min(1).nullable(),
	status: z.string().min(1).nullable(),
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
	truncated: z.boolean(),
});

export const OpsObservabilityResponseSchema = z.discriminatedUnion("kind", [
	ObservabilityBaseSchema.extend({
		kind: z.literal("logs"),
		limit: z.literal(200),
		records: z.array(AxiomLogRecordSchema).max(200),
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
	source: z.literal("SENTRY"),
	to: IsoDateTimeSchema,
	truncated: z.boolean(),
});

export type OpsDataState = z.infer<typeof OpsDataStateSchema>;
export type OpsHealthStatus = z.infer<typeof OpsHealthStatusSchema>;
export type OpsObservabilityResponse = z.infer<typeof OpsObservabilityResponseSchema>;
export type OpsOverviewResponse = z.infer<typeof OpsOverviewResponseSchema>;
export type OpsOverviewWindow = z.infer<typeof OpsOverviewWindowSchema>;
export type OpsRequestDetailResponse = z.infer<typeof OpsRequestDetailResponseSchema>;
export type OpsRequestListView = z.infer<typeof OpsRequestListViewSchema>;
export type OpsSentryIssuesResponse = z.infer<typeof OpsSentryIssuesResponseSchema>;
export type OpsRequestListResponse = z.infer<typeof OpsRequestListResponseSchema>;
export type OpsRequestSummary = z.infer<typeof OpsRequestSummarySchema>;
export type OpsRequestWindow = z.infer<typeof OpsRequestWindowSchema>;
