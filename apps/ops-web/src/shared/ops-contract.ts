import { NOTICE_CATEGORIES } from "campus-contracts/notices";
import { z } from "zod";
import { CampusSearchDiagnosticsSchema } from "./campus-search-diagnostics.ts";
import { ModelOutputDiagnosticSchema } from "./model-output-diagnostic.ts";
import { WebSearchDiagnosticSchema } from "./web-search-diagnostic.ts";

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

export const OpsOverviewWindowSchema = z.enum(["15m", "1h", "6h", "24h"]);
export const OpsRequestWindowSchema = z.enum(["15m", "1h", "6h", "24h", "7d"]);
export const OpsHealthStatusSchema = z.enum(["HEALTHY", "DEGRADED", "OUTAGE", "UNKNOWN"]);
export const OpsDataStateSchema = z.enum(["FRESH", "PARTIAL", "STALE", "NO_DATA", "UNAVAILABLE"]);

export const NoticeJobOperationSchema = z.enum([
	"notice-sync",
	"notice-rescan",
	"notice-backfill",
	"notice-classify-missing",
	"notice-classify-one",
	"notice-publish-pending",
	"notice-publish-one",
	"notice-republish-one",
]);
export type NoticeJobOperation = z.infer<typeof NoticeJobOperationSchema>;

const NoticeIdSchema = z.number().int().positive();
const NoticeDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/u)
	.refine((value) => {
		const date = new Date(`${value}T00:00:00.000Z`);
		return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
	}, "invalid date");

export const NoticeJobRangeSchema = z
	.object({ from: NoticeDateSchema, to: NoticeDateSchema })
	.strict()
	.refine((value) => value.from <= value.to, "notice job range must use [from, to)");
export type NoticeJobRange = z.infer<typeof NoticeJobRangeSchema>;

export const NoticeJobProgressSchema = z
	.object({
		phase: z.enum(["scanning", "processing", "writing", "finalizing"]),
		processed: z.number().int().nonnegative(),
		total: z.number().int().nonnegative().nullable(),
	})
	.strict();
export type NoticeJobProgress = z.infer<typeof NoticeJobProgressSchema>;

export const NoticeJobCreateSchema = z.discriminatedUnion("operation", [
	z.object({ operation: z.literal("notice-sync") }).strict(),
	z
		.object({ operation: z.literal("notice-rescan"), from: NoticeDateSchema, to: NoticeDateSchema })
		.strict()
		.refine((value) => value.from < value.to, "补查结束日期必须晚于开始日期"),
	z.object({ operation: z.literal("notice-backfill"), startDate: NoticeDateSchema }).strict(),
	z.object({ operation: z.literal("notice-classify-missing") }).strict(),
	z.object({ operation: z.literal("notice-classify-one"), noticeId: NoticeIdSchema }).strict(),
	z.object({ operation: z.literal("notice-publish-pending") }).strict(),
	z.object({ operation: z.literal("notice-publish-one"), noticeId: NoticeIdSchema }).strict(),
	z.object({ operation: z.literal("notice-republish-one"), noticeId: NoticeIdSchema }).strict(),
]);
export type NoticeJobCreate = z.infer<typeof NoticeJobCreateSchema>;

export const NoticeJobStatusSchema = z.enum(["pending", "running", "succeeded", "failed"]);
export const NoticeJobSummarySchema = z
	.object({
		assets: z.number().int().nonnegative().optional(),
		attachmentsDownloaded: z.number().int().nonnegative().optional(),
		attachmentsMissing: z.number().int().nonnegative().optional(),
		attachmentsReused: z.number().int().nonnegative().optional(),
		classified: z.number().int().nonnegative().optional(),
		imagesDownloaded: z.number().int().nonnegative().optional(),
		imagesReused: z.number().int().nonnegative().optional(),
		notices: z.number().int().nonnegative().optional(),
		noticesFailed: z.number().int().nonnegative().optional(),
		noticesProcessed: z.number().int().nonnegative().optional(),
		noticesAdded: z.number().int().nonnegative().optional(),
		objectsReused: z.number().int().nonnegative().optional(),
		objectsWritten: z.number().int().nonnegative().optional(),
		pagesFetched: z.number().int().nonnegative().optional(),
		requested: z.number().int().nonnegative().optional(),
		skipped: z.number().int().nonnegative().optional(),
		unchanged: z.number().int().nonnegative().optional(),
		updated: z.number().int().nonnegative().optional(),
		upToDate: z.boolean().optional(),
	})
	.strict();
export const NoticeJobSchema = z
	.object({
		completedAt: IsoDateTimeSchema.nullable(),
		createdAt: IsoDateTimeSchema,
		controllerError: z.string().nullable(),
		error: z.string().nullable(),
		jobName: z.string().min(1),
		maintenanceRange: NoticeJobRangeSchema.nullable(),
		noticeId: NoticeIdSchema.nullable(),
		operation: NoticeJobOperationSchema,
		trigger: z.enum(["manual", "scheduled"]),
		processedRange: NoticeJobRangeSchema.nullable(),
		progress: NoticeJobProgressSchema.nullable(),
		startedAt: IsoDateTimeSchema.nullable(),
		status: NoticeJobStatusSchema,
		summary: NoticeJobSummarySchema.nullable(),
	})
	.strict();
export type NoticeJob = z.infer<typeof NoticeJobSchema>;
export const NoticeJobResponseSchema = z.object({ job: NoticeJobSchema }).strict();
export const NoticeJobListResponseSchema = z
	.object({ jobs: z.array(NoticeJobSchema).max(50) })
	.strict();

export const NoticeCategorySchema = z.enum(NOTICE_CATEGORIES);
export const NoticeStateSchema = z.enum(["needs_classification", "needs_publication", "published"]);
export type NoticeState = z.infer<typeof NoticeStateSchema>;

export const NoticeSummarySchema = z
	.object({
		category: NoticeCategorySchema.nullable(),
		externalUrl: z.string().url().nullable(),
		isExternal: z.boolean(),
		noticeId: NoticeIdSchema,
		noticeType: z.object({ id: z.number().int().positive(), name: z.string().min(1) }),
		organization: z.object({ id: z.string().min(1), name: z.string().min(1) }).nullable(),
		releasedAt: IsoDateTimeSchema,
		state: NoticeStateSchema,
		title: z.string().min(1),
	})
	.strict();
export type NoticeSummary = z.infer<typeof NoticeSummarySchema>;
export const NoticeDetailSchema = NoticeSummarySchema;
export type NoticeDetail = z.infer<typeof NoticeDetailSchema>;
export const NoticeListCountsSchema = z
	.object({
		all: z.number().int().nonnegative(),
		needsClassification: z.number().int().nonnegative(),
		needsPublication: z.number().int().nonnegative(),
		published: z.number().int().nonnegative(),
	})
	.strict();
export type NoticeListCounts = z.infer<typeof NoticeListCountsSchema>;
export const NoticeListResponseSchema = z
	.object({
		counts: NoticeListCountsSchema,
		items: z.array(NoticeSummarySchema),
		page: z.number().int().positive(),
		totalItems: z.number().int().nonnegative(),
		totalPages: z.number().int().nonnegative(),
	})
	.strict();
export const NoticeDetailResponseSchema = z.object({ notice: NoticeDetailSchema }).strict();
export const NoticeCategoryUpdateSchema = z.object({ category: NoticeCategorySchema }).strict();
export type NoticeCategoryUpdate = z.infer<typeof NoticeCategoryUpdateSchema>;

export const ModelSettingKindSchema = z.enum(["llm", "embedding", "reranker", "notice_classifier"]);
export type ModelSettingKind = z.infer<typeof ModelSettingKindSchema>;

export const ModelProviderSchema = z.enum([
	"google",
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
		models: z.array(z.string().trim().min(1).max(256)),
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
	transport: z.enum(["responses", "chat_completions", "generate_content", "embeddings", "rerank"]),
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

export const NoticeClassifierModelSettingUpdateSchema = LLMModelSettingUpdateBaseSchema.extend({
	transport: z.enum(["responses", "chat_completions"]),
}).strict();
export const LLMModelSettingUpdateSchema = z.union([
	NoticeClassifierModelSettingUpdateSchema,
	LLMModelSettingUpdateBaseSchema.extend({
		provider: z.literal("google"),
		transport: z.literal("generate_content"),
	}).strict(),
]);

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
	"QUEUED",
	"RUNNING",
	"STREAMING",
	"FINALIZING",
	"FINISHED",
]);
const OpsAssistantMessageKindSchema = z.enum(["answer", "error"]);
export const CitationIndexesSchema = z
	.array(z.number().int().min(1).max(10))
	.min(1)
	.max(10)
	.refine((values) => new Set(values).size === values.length, "citation indexes must be unique");
const OpsRequestResultSummarySchema = z.discriminatedUnion("state", [
	z.object({ kind: z.null(), state: z.literal("PENDING") }),
	z.object({ kind: OpsAssistantMessageKindSchema, state: z.literal("WRITTEN") }),
	z.object({ kind: z.null(), state: z.literal("MISSING") }),
]);

export const OpsRequestSummarySchema = z.object({
	attentionReason: z
		.enum(["RESULT_MISSING", "REQUEST_FAILED", "EXECUTION_STAGE_FAILED", "WAITING_USER"])
		.nullable(),
	completedAt: IsoDateTimeSchema.nullable(),
	durationMs: z.number().int().nonnegative().nullable(),
	executionStage: z
		.object({
			kind: z.string().min(1),
			status: z.string().min(1),
			toolName: z.string().min(1).nullable(),
		})
		.nullable(),
	failureKind: z.string().min(1).nullable(),
	lifecyclePhase: OpsRequestLifecyclePhaseSchema,
	question: z.object({
		preview: z.string().min(1),
		truncated: z.boolean(),
	}),
	requestId: z.string().min(1),
	result: OpsRequestResultSummarySchema,
	startedAt: IsoDateTimeSchema,
	status: OpsStatusSchema,
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

const OpsCampusProductSourceSchema = z.object({
	citationIndexes: CitationIndexesSchema,
	collectionLabel: z.string(),
	kind: z.literal("campus_document"),
	primaryAction: z.object({
		disabledReason: z.string().min(1).nullable(),
		external: z.literal(false),
		href: z.string().min(1).nullable(),
		label: z.literal("查看文档"),
	}),
	sectionTitle: z.string(),
	snippet: z.string().nullable(),
	title: z.string().min(1),
	versionSlug: z.string().regex(/^[1-9]\d*$/u),
});

const OpsWebProductSourceSchema = z.object({
	citationIndexes: CitationIndexesSchema,
	hostname: z.string().min(1),
	kind: z.literal("web_page"),
	primaryAction: z.object({
		disabledReason: z.string().min(1).nullable(),
		external: z.literal(true),
		href: z.string().min(1).nullable(),
		label: z.literal("打开网页"),
	}),
	snippet: z.string().nullable(),
	title: z.string().min(1),
});

const OpsNoticeProductSourceSchema = z.object({
	citationIndexes: CitationIndexesSchema,
	kind: z.literal("campus_notice"),
	noticeId: z.string().min(1),
	primaryAction: z.object({
		disabledReason: z.string().min(1).nullable(),
		external: z.literal(false),
		href: z.string().min(1).nullable(),
		label: z.literal("查看通知"),
	}),
	sectionTitle: z.string(),
	snippet: z.string().nullable(),
	title: z.string().min(1),
});

const OpsProductSourceSchema = z.discriminatedUnion("kind", [
	OpsCampusProductSourceSchema,
	OpsNoticeProductSourceSchema,
	OpsWebProductSourceSchema,
]);

const OpsProductResultSchema = z.discriminatedUnion("state", [
	z.object({ state: z.literal("PENDING") }),
	z.object({ reasonCode: z.literal("ASSISTANT_MESSAGE_MISSING"), state: z.literal("MISSING") }),
	z.object({
		kind: OpsAssistantMessageKindSchema,
		sources: z.array(OpsProductSourceSchema).max(10),
		state: z.literal("WRITTEN"),
		text: z.string(),
	}),
]);

const OpsExecutionFailureSchema = z.object({
	code: z.string().min(1).nullable(),
	detail: z.string().min(1).nullable(),
	httpStatus: z.number().int().min(100).max(599).nullable(),
	invocationId: z.string().min(1).nullable(),
	operation: z.string().min(1).nullable(),
});

const OpsExecutionStageSchema = z.object({
	webSearchDiagnostic: WebSearchDiagnosticSchema.nullish(),
	modelOutputDiagnostic: ModelOutputDiagnosticSchema.nullish(),
	completedAt: IsoDateTimeSchema.nullable(),
	durationMs: z.number().int().nonnegative().nullable(),
	failureKind: z.string().min(1).nullable(),
	kind: z.string().min(1),
	invocationId: z.string().min(1).nullable(),
	startedAt: IsoDateTimeSchema.nullable(),
	status: z.string().min(1),
	toolName: z.string().min(1).nullable(),
});

export const OpsRequestDetailResponseSchema = z.object({
	execution: z.object({
		campusSearch: CampusSearchDiagnosticsSchema,
		failCloseReason: z.string().min(1).nullable(),
		failure: OpsExecutionFailureSchema,
		terminalFailure: OpsExecutionFailureSchema.nullish(),
		model: z.object({
			name: z.string().min(1).nullable(),
			provider: z.string().min(1).nullable(),
			requestCount: z.number().int().nonnegative(),
			tokens: z.object({
				cachedInput: z.number().int().nonnegative().nullable(),
				input: z.number().int().nonnegative().nullable(),
				output: z.number().int().nonnegative().nullable(),
				total: z.number().int().nonnegative().nullable(),
			}),
		}),
		releases: z.object({
			agentRuntime: z.string().min(1).nullable(),
			executionControl: z.string().min(1).nullable(),
		}),
		stages: z.array(OpsExecutionStageSchema),
		terminalReason: z.string().min(1).nullable(),
	}),
	generatedAt: IsoDateTimeSchema,
	question: z.object({
		text: z.string().min(1),
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

export type OpsDataState = z.infer<typeof OpsDataStateSchema>;
export type OpsHealthStatus = z.infer<typeof OpsHealthStatusSchema>;
export type OpsOverviewResponse = z.infer<typeof OpsOverviewResponseSchema>;
export type OpsOverviewWindow = z.infer<typeof OpsOverviewWindowSchema>;
export type OpsRequestDetailResponse = z.infer<typeof OpsRequestDetailResponseSchema>;
export type OpsRequestListView = z.infer<typeof OpsRequestListViewSchema>;
export type OpsRequestListResponse = z.infer<typeof OpsRequestListResponseSchema>;
export type OpsRequestSummary = z.infer<typeof OpsRequestSummarySchema>;
export type OpsRequestWindow = z.infer<typeof OpsRequestWindowSchema>;
