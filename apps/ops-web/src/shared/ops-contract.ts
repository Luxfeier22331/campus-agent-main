import { z } from "zod";

const IsoDateTimeSchema = z.string().datetime();
const HttpsUrlSchema = z
	.string()
	.url()
	.refine((value) => new URL(value).protocol === "https:", "external links must use HTTPS");

export const OpsOverviewWindowSchema = z.enum(["15m", "1h", "6h", "24h"]);
export const OpsRequestWindowSchema = z.enum(["1h", "6h", "24h", "7d"]);
export const OpsHealthStatusSchema = z.enum(["HEALTHY", "DEGRADED", "OUTAGE", "UNKNOWN"]);
export const OpsDataStateSchema = z.enum(["FRESH", "STALE", "NO_DATA", "UNAVAILABLE"]);

const OpsStatusSchema = z.enum(["COMPLETED", "FAILED", "CANCELLED", "RUNNING", "PENDING"]);
const OpsStepStatusSchema = z.enum([
	"COMPLETED",
	"FAILED",
	"CANCELLED",
	"RUNNING",
	"PENDING",
	"UNKNOWN",
]);

const ExternalLinkSchema = z.object({
	href: HttpsUrlSchema.nullable(),
	isAvailable: z.boolean(),
	label: z.string().min(1),
	source: z.enum(["LANGFUSE", "TEMPORAL", "SENTRY", "AXIOM", "OPENOBSERVE"]),
});

export const OpsCorrelationIdsSchema = z.object({
	conversationId: z.string().min(1),
	missingCorrelationFields: z.array(z.string().min(1)),
	requestId: z.string().min(1),
	runId: z.string().min(1).nullable(),
	traceId: z.string().min(1),
	workflowId: z.string().min(1).nullable(),
});

export const OpsRequestSummarySchema = z.object({
	completedAt: IsoDateTimeSchema.nullable(),
	conversationId: z.string().min(1),
	diagnostics: z.array(z.string().min(1)),
	durationMs: z.number().int().nonnegative().nullable(),
	errorCode: z.string().min(1).nullable(),
	principalHash: z.string().min(1),
	principalType: z.string().min(1),
	projectedAt: IsoDateTimeSchema,
	questionPreview: z.string().min(1),
	requestId: z.string().min(1),
	requestedTool: z.string().min(1).nullable(),
	runId: z.string().min(1).nullable(),
	selectedTool: z.string().min(1).nullable(),
	startedAt: IsoDateTimeSchema,
	status: OpsStatusSchema,
	traceId: z.string().min(1),
	workflowId: z.string().min(1).nullable(),
});

export const OpsRequestListResponseSchema = z.object({
	data: z.array(OpsRequestSummarySchema),
	page: z.object({
		nextCursor: z.string().min(1).nullable(),
	}),
	summary: z.object({
		cancelled: z.number().int().nonnegative(),
		completed: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		pending: z.number().int().nonnegative(),
		running: z.number().int().nonnegative(),
		total: z.number().int().nonnegative(),
	}),
	window: OpsRequestWindowSchema,
});

const StageTimingSchema = z.record(z.string().min(1), z.number().nonnegative());

const StepTrajectoryItemSchema = z.object({
	outcome: z.string().min(1).nullable(),
	parentStepId: z.string().min(1).nullable(),
	resultStatus: z.string().min(1).nullable(),
	retryCount: z.number().int().nonnegative(),
	spanKind: z.string().min(1),
	status: OpsStepStatusSchema,
	stepId: z.string().min(1),
	toolName: z.string().min(1).nullable(),
});

const SupportingSourceSchema = z.object({
	canonicalUrl: z.string().min(1),
	sourceKind: z.string().min(1).nullable(),
	sourceTitle: z.string().min(1),
	targetKind: z.string().min(1).nullable(),
	versionId: z.string().min(1).nullable(),
});

export const OpsRequestDetailResponseSchema = z.object({
	correlationIds: OpsCorrelationIdsSchema,
	debugTraceRefs: z.array(
		z.object({
			sink: z.string().min(1),
			traceId: z.string().min(1).nullable(),
			traceRef: z.string().min(1),
		}),
	),
	externalLinks: z.array(ExternalLinkSchema),
	modelSummary: z.object({
		model: z.string().min(1).nullable(),
		promptId: z.string().min(1).nullable(),
		provider: z.string().min(1).nullable(),
		promptVersion: z.string().min(1).nullable(),
		templateSha256: z.string().min(1).nullable(),
	}),
	outcomeSummary: z.object({
		refusalClass: z.string().min(1).nullable(),
		scopeClass: z.string().min(1).nullable(),
		semanticOutcome: z.string().min(1).nullable(),
	}),
	policySummary: z.object({
		aclAnomalyCode: z.string().min(1).nullable(),
		aclDecision: z.string().min(1).nullable(),
		failClosed: z.boolean().nullable(),
	}),
	request: OpsRequestSummarySchema,
	sources: z.array(SupportingSourceSchema),
	stageTiming: StageTimingSchema,
	stageTimingBudget: z.record(z.string().min(1), z.enum(["OK", "WARN", "BREACH"])),
	stepTrajectory: z.array(StepTrajectoryItemSchema),
	toolSummary: z.object({
		requestedTool: z.string().min(1).nullable(),
		selectedTool: z.string().min(1).nullable(),
	}),
	traceSummary: z.object({
		available: z.boolean(),
		measuredAt: IsoDateTimeSchema.nullable(),
		projectionLagMs: z.number().int().nonnegative().nullable(),
		updatedAt: IsoDateTimeSchema.nullable(),
	}),
	workflowSummary: z.object({
		branch: z.string().min(1).nullable(),
		firstDecisionActor: z.string().min(1).nullable(),
		mode: z.string().min(1).nullable(),
		planningOutcome: z.string().min(1).nullable(),
		runtimeVersions: z.record(z.string(), z.json()),
		selectedTools: z.array(z.string().min(1)),
		terminalReason: z.string().min(1).nullable(),
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
		reasons: z.array(z.string().min(1)),
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
	trends: z.array(
		z.object({
			bucketStart: IsoDateTimeSchema,
			completed: z.number().int().nonnegative(),
			failed: z.number().int().nonnegative(),
			p95DurationMs: z.number().int().nonnegative().nullable(),
			total: z.number().int().nonnegative(),
		}),
	),
	window: OpsOverviewWindowSchema,
});

const ObservabilityBaseSchema = z.object({
	dataState: OpsDataStateSchema,
	from: IsoDateTimeSchema,
	queryDurationMs: z.number().int().nonnegative(),
	queriedAt: IsoDateTimeSchema,
	records: z.array(z.record(z.string(), z.json())),
	requestId: z.string().min(1),
	source: z.literal("OPENOBSERVE"),
	to: IsoDateTimeSchema,
	traceId: z.string().min(1),
	truncated: z.boolean(),
});

export const OpsObservabilityResponseSchema = z.discriminatedUnion("kind", [
	ObservabilityBaseSchema.extend({
		kind: z.literal("logs"),
		limit: z.literal(200),
		records: z.array(z.record(z.string(), z.json())).max(200),
	}),
	ObservabilityBaseSchema.extend({
		kind: z.literal("trace"),
		limit: z.literal(500),
		records: z.array(z.record(z.string(), z.json())).max(500),
	}),
]);

export type OpsDataState = z.infer<typeof OpsDataStateSchema>;
export type OpsHealthStatus = z.infer<typeof OpsHealthStatusSchema>;
export type OpsObservabilityResponse = z.infer<typeof OpsObservabilityResponseSchema>;
export type OpsOverviewResponse = z.infer<typeof OpsOverviewResponseSchema>;
export type OpsOverviewWindow = z.infer<typeof OpsOverviewWindowSchema>;
export type OpsRequestDetailResponse = z.infer<typeof OpsRequestDetailResponseSchema>;
export type OpsRequestListResponse = z.infer<typeof OpsRequestListResponseSchema>;
export type OpsRequestSummary = z.infer<typeof OpsRequestSummarySchema>;
export type OpsRequestWindow = z.infer<typeof OpsRequestWindowSchema>;
