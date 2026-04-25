import type { ResolvedAppPrincipal } from "../auth";
import type {
	RequestClaimSupportSummary,
	RequestDiagnosticsSummary,
	RequestRemoteContentSuspicionSummary,
	RequestRetrievalPlanSummary,
	RequestSourceTrustSummary,
} from "../request-diagnostics";
import type { RequestExecutionStatus } from "../runtime-command";
import type { ObservedSourceTraceEntry } from "../source-trace";
import type { VersionQuery, VersionQueryMode } from "../version-query";

export interface RequestProjectionRecord {
	requestId: string;
	traceId: string;
	surface: string;
	conversationId: string;
	principalType: string;
	principalId: string;
	principalLabel: string | null;
	entitlementSnapshotId: string | null;
	entitlementGroups: string[];
	visibilityScope: string | null;
	applicabilityScope: string | null;
	requestedCapability: string | null;
	requestedScope: Record<string, unknown> | null;
	versionQuery?: VersionQuery;
	resolvedScope: Record<string, unknown> | null;
	selectedTarget: string | null;
	status: RequestExecutionStatus;
	errorCode: string | null;
	questionPreview: string;
	answerPreview: string | null;
	diagnostics?: RequestDiagnosticsSummary;
	sourceDocIds: string[];
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
	projectedAt: string;
}

export interface OperatorRequestListFilters {
	limit?: number | null;
	cursor?: string | null;
	q?: string | null;
	status?: string | null;
	surface?: string | null;
	conversationId?: string | null;
	requestId?: string | null;
}

export interface OperatorAuditListFilters {
	limit?: number | null;
	cursor?: string | null;
	requestId?: string | null;
	traceId?: string | null;
	principalType?: string | null;
	surface?: string | null;
	selectedTarget?: string | null;
	eventType?: string | null;
	status?: string | null;
}

export interface NormalizedOperatorRequestListFilters {
	limit: number;
	cursor: string | null;
	q: string | null;
	status: string | null;
	surface: string | null;
	conversationId: string | null;
	requestId: string | null;
}

export interface NormalizedOperatorAuditListFilters {
	limit: number;
	cursor: string | null;
	requestId: string | null;
	traceId: string | null;
	principalType: string | null;
	surface: string | null;
	selectedTarget: string | null;
	eventType: string | null;
	status: string | null;
}

export interface OperatorOverviewFilters {
	window?: string | null;
	granularity?: string | null;
	surface?: string | null;
	selectedTarget?: string | null;
	requestedCapability?: string | null;
	principalType?: string | null;
	collection?: string | null;
	modelName?: string | null;
}

export interface NormalizedOperatorOverviewFilters {
	window: OperatorOverviewWindow;
	granularity: OperatorResultWindow["granularity"] | null;
	surface: string | null;
	selectedTarget: string | null;
	requestedCapability: string | null;
	principalType: string | null;
	collection: string | null;
	modelName: string | null;
}

export interface OperatorQueryListResult {
	requests: RequestProjectionRecord[];
	page: {
		nextCursor: string | null;
	};
}

export type OperatorOverviewWindow = "15m" | "1h" | "24h" | "7d" | "30d";

export interface MetricRatio {
	value: number;
	count: number;
	eligibleCount: number | null;
}

export interface OperatorDistributionBucket {
	value: string;
	count: number;
}

export interface OperatorResultWindow {
	from: string;
	to: string;
	granularity: "5m" | "15m" | "1h" | "1d";
}

export interface OperatorIntentObservabilitySummary {
	capability: string | null;
	taskKind: string | null;
	launchState: string | null;
	nextAction: string | null;
	scopeClass: string | null;
	scopeReason: string | null;
	policyReason: string | null;
	classifierVersion: string | null;
	schemaVersion?: string | null;
	routingConfidence?: string | null;
	ambiguitySignal?: string | null;
	contextResolutionState?: string | null;
	contextReferenceType?: string | null;
	resolvedSlots?: Record<string, string> | null;
	missingSlots?: string[] | null;
	ambiguityReason?: string | null;
}

export interface OperatorRequestObservabilityRecord {
	request: {
		requestId: string;
		traceId: string;
		conversationId: string;
		surface: string;
		status: RequestExecutionStatus;
		requestedCapability: string | null;
		requestedScope: Record<string, unknown> | null;
		versionQuery?: VersionQuery;
		resolvedScope: Record<string, unknown> | null;
		selectedTarget: string | null;
		startedAt: string;
		completedAt: string | null;
	};
	observability: {
		durationMs: number | null;
		retrievalAttempted: boolean | null;
		candidateCount: number | null;
		retrievedSourceCount: number | null;
		emptyRecall: boolean | null;
		citationExpected: boolean | null;
		citationCount: number | null;
		citationMissing: boolean | null;
		refusalClass: string | null;
		aclDecision: string | null;
		aclAnomalyCode: string | null;
		failClosed: boolean | null;
		intent?: OperatorIntentObservabilitySummary;
		retrievalAdequacyVerdict: string | null;
		retrievalAdequacyReason: string | null;
		retrievalPlan?: RequestRetrievalPlanSummary | null;
		claimSupportSummary: RequestClaimSupportSummary | null;
		remoteContentSuspicionSummary?: RequestRemoteContentSuspicionSummary | null;
		sourceTrustSummary?: RequestSourceTrustSummary | null;
		model: {
			provider: string | null;
			name: string | null;
		};
		prompt: {
			id: string | null;
			version: string | null;
			templateSha256: string | null;
			runtimeState: string | null;
			runtimeDetail: string | null;
		};
		inputTokens: number | null;
		outputTokens: number | null;
		cachedInputTokens: number | null;
		estimatedCost: {
			microusd: number | null;
			currency: "USD";
		};
		sourceTrace: {
			retrieved: ObservedSourceTraceEntry[];
			supporting: ObservedSourceTraceEntry[];
		};
		traceAvailable: boolean;
		projectionLagMs: number | null;
		measuredAt: string | null;
		versionQueryMode?: VersionQueryMode | null;
		versionQuerySummary?: string | null;
	};
	links: {
		traceLink: string | null;
		issueLink: string | null;
		issueFingerprint: string | null;
	};
	replay: {
		context: {
			principalType: string;
			entitlementSnapshotId: string | null;
			entitlementGroups: string[];
			visibilityScope: string | null;
			applicabilityScope: string | null;
			policyProjectionVersion: string | null;
		};
		routing: {
			requestedCapability: string | null;
			requestedScope: Record<string, unknown> | null;
			resolvedScope: Record<string, unknown> | null;
			selectedTarget: string | null;
			intent?: OperatorIntentObservabilitySummary;
		};
		execution: {
			status: RequestExecutionStatus;
			errorCode: string | null;
			semanticOutcome: string | null;
			refusalClass: string | null;
			scopeClass: string | null;
			failClosed: boolean | null;
		};
		retrieval: {
			retrievalAttempted: boolean | null;
			candidateCount: number | null;
			retrievedSourceCount: number | null;
			emptyRecall: boolean | null;
			adequacyVerdict: string | null;
			adequacyReason: string | null;
			plan?: RequestRetrievalPlanSummary | null;
			sourceTraceCounts: {
				retrieved: number;
				supporting: number;
			};
		};
		answerQuality: {
			citationExpected: boolean | null;
			citationCount: number | null;
			citationMissing: boolean | null;
			claimSupportSummary: RequestClaimSupportSummary | null;
			groundingVerdict: string | null;
			groundingDowngraded: boolean | null;
			freshnessFailClosed: boolean | null;
			policyReason: string | null;
		};
		prompt: {
			id: string | null;
			version: string | null;
			templateSha256: string | null;
			runtimeState: string | null;
			runtimeDetail: string | null;
		};
	};
	auditSummary: {
		auditEventCount: number;
		latestTerminalCode: string | null;
	};
}

export interface OperatorOverviewResult {
	window: OperatorResultWindow;
	overview: {
		requestVolume: {
			accepted: number;
			completed: number;
			errored: number;
		};
		latency: {
			p50Ms: number | null;
			p95Ms: number | null;
			p99Ms: number | null;
		};
		failureRate: MetricRatio;
		emptyRecallRate: MetricRatio;
		citationMissRate: MetricRatio;
		refusalRate: MetricRatio;
		aclAnomalyRate: MetricRatio;
		estimatedCost: {
			microusd: number;
			currency: "USD";
		};
		sinkHealth: {
			missingTraceRate: MetricRatio;
			projectionFailureCount: number;
			outboxPendingCount: number;
			outboxRetryCount: number;
			outboxStaleCount: number;
		};
	};
	alerts: OperatorOverviewAlert[];
	asOf: string;
}

export interface OperatorOverviewAlert {
	alertId: string;
	domain: string;
	severity: string;
	code: string;
	status: string;
	startedAt: string;
	requestCount: number;
	incidentBackfill: {
		mode: "incident_backfill" | null;
		required: boolean;
	};
}

export interface OperatorAuditEventListItem {
	auditEventId: string;
	requestId: string;
	traceId: string;
	occurredAt: string;
	eventType: string;
	surface: string;
	principalType: string;
	selectedTarget: string | null;
	status: string;
	summary: string;
}

export interface OperatorAuditEventDetail {
	event: {
		auditEventId: string;
		requestId: string;
		traceId: string;
		occurredAt: string;
		eventType: string;
		surface: string;
		principalType: string;
		entitlementSnapshotId: string | null;
		policyProjectionVersion: string | null;
		requestedCapability: string | null;
		selectedTarget: string | null;
		status: string;
		terminalCode: string | null;
		summary: string;
		diagnostics: {
			failClosed: boolean | null;
			aclAnomalyCode: string | null;
			bridgeDurationMs?: number | null;
			decision?: string | null;
			durationMs?: number | null;
			failureKind?: string | null;
			httpStatus?: number | null;
			lane?: string | null;
			queueWaitMs?: number | null;
			retryable?: boolean | null;
			sourceDocIds: string[];
		};
	};
	links: {
		traceLink: string | null;
		issueLink: string | null;
		issueFingerprint: string | null;
	};
}

export interface OperatorAuditListResult {
	events: OperatorAuditEventListItem[];
	page: {
		nextCursor: string | null;
	};
}

export interface OperatorQualityTimeseriesResult {
	window: OperatorResultWindow;
	series: Array<{
		bucketStart: string;
		bucketEnd: string;
		requestCount: number;
		emptyRecallRate: number;
		citationMissRate: number;
		noAnswerRate: number;
		needsClarificationRate: number;
		sampledGroundingPassRate: number | null;
	}>;
	asOf: string;
}

export interface OperatorIntentSummaryResult {
	window: OperatorResultWindow;
	runtime: {
		requestCount: number;
		lowConfidenceRate: MetricRatio;
		ambiguityRate: MetricRatio;
		contextUnresolvedRate: MetricRatio;
		distributions: {
			capability: OperatorDistributionBucket[];
			taskKind: OperatorDistributionBucket[];
			launchState: OperatorDistributionBucket[];
			nextAction: OperatorDistributionBucket[];
			scopeClass: OperatorDistributionBucket[];
			classifierVersion: OperatorDistributionBucket[];
			schemaVersion: OperatorDistributionBucket[];
		};
	};
	sampledGrades: {
		coverageRate: MetricRatio | null;
		intentPassRate: MetricRatio | null;
	} | null;
	asOf: string;
}

export interface OperatorIntentTimeseriesResult {
	window: OperatorResultWindow;
	series: Array<{
		bucketStart: string;
		bucketEnd: string;
		requestCount: number;
		lowConfidenceRate: number;
		ambiguityRate: number;
		contextUnresolvedRate: number;
		sampledIntentPassRate: number | null;
	}>;
	asOf: string;
}

export interface OperatorQualityBadcaseListFilters {
	limit?: number | null;
	cursor?: string | null;
	status?: string | null;
	causeClass?: string | null;
	detectedBy?: string | null;
}

export interface OperatorSafetyAnomalyListFilters {
	limit?: number | null;
	cursor?: string | null;
	severity?: string | null;
	status?: string | null;
	anomalyCode?: string | null;
}

export interface NormalizedOperatorQualityBadcaseListFilters {
	limit: number;
	cursor: string | null;
	status: string | null;
	causeClass: string | null;
	detectedBy: string | null;
}

export interface NormalizedOperatorSafetyAnomalyListFilters {
	limit: number;
	cursor: string | null;
	severity: string | null;
	status: string | null;
	anomalyCode: string | null;
}

export interface OperatorQualityBadcaseListResult {
	badcases: Array<{
		badcaseId: string;
		requestId: string;
		traceId: string;
		surface: string;
		selectedTarget: string | null;
		status: string;
		causeClass: string;
		detectedBy: string;
		openedAt: string;
		summary: string;
		grade: {
			result: string;
			score: number | null;
			graderVersion: string;
		} | null;
		links: {
			traceLink: string | null;
			issueLink: string | null;
			issueFingerprint: string | null;
		};
	}>;
	page: {
		nextCursor: string | null;
	};
}

export interface OperatorQualityEvalCandidateListResult {
	candidates: Array<{
		candidateId: string;
		requestId: string;
		traceId: string;
		surface: string;
		selectedTarget: string | null;
		causeClass: string;
		summary: string;
		grade: {
			result: string;
			score: number | null;
			graderVersion: string;
		} | null;
		links: {
			traceLink: string | null;
			issueLink: string | null;
			issueFingerprint: string | null;
		};
		intake: {
			source: "operator_badcase";
			status: "pending_review";
			suggestedEvalFamily: "citation" | "grounding" | "intent" | "policy" | "unknown";
			createdAt: string;
		};
	}>;
	page: {
		nextCursor: string | null;
	};
}

export interface OperatorQualitySummaryResult {
	window: OperatorResultWindow;
	runtime: {
		requestCount: number;
		emptyRecallRate: MetricRatio;
		citationMissRate: MetricRatio;
		refusalDistribution: {
			noAnswer: number;
			needsClarification: number;
			approvalRequired: number;
			rejected: number;
		};
	};
	sampledGrades: {
		coverageRate: MetricRatio | null;
		groundingPassRate: MetricRatio | null;
		citationPassRate: MetricRatio | null;
		intentPassRate: MetricRatio | null;
		policyPassRate: MetricRatio | null;
		badcaseOpenCount: number | null;
	} | null;
	asOf: string;
}

export interface OperatorSafetySummaryResult {
	window: OperatorResultWindow;
	summary: {
		decisionDistribution: {
			allowed: number;
			approvalRequired: number;
			denied: number;
			failClosed: number;
		};
		aclAnomalyRate: MetricRatio;
		restrictedDenyRate: MetricRatio;
		failClosedRate: MetricRatio;
	};
	asOf: string;
}

export interface OperatorSafetyAnomalyListResult {
	anomalies: Array<{
		anomalyId: string;
		requestId: string;
		traceId: string;
		surface: string;
		principalType: string;
		selectedTarget: string | null;
		anomalyCode: string;
		severity: "high" | "medium";
		status: "open";
		summary: string;
		detectedAt: string;
		links: {
			traceLink: string | null;
			issueLink: string | null;
			issueFingerprint: string | null;
		};
	}>;
	page: {
		nextCursor: string | null;
	};
}

export interface OperatorCostSummaryResult {
	window: OperatorResultWindow;
	summary: {
		tokens: {
			input: number;
			output: number;
			cachedInput: number;
		};
		estimatedCost: {
			microusd: number;
			currency: "USD";
		};
		byModel: Array<{
			modelName: string;
			requestCount: number;
			estimatedCostMicrousd: number;
		}>;
		bySurface: Array<{
			surface: string;
			requestCount: number;
			estimatedCostMicrousd: number;
		}>;
	};
	asOf: string;
}

export interface OperatorCostTimeseriesResult {
	window: OperatorResultWindow;
	series: Array<{
		bucketStart: string;
		bucketEnd: string;
		inputTokens: number;
		outputTokens: number;
		cachedInputTokens: number;
		estimatedCostMicrousd: number;
	}>;
	asOf: string;
}

export interface OperatorQueryStore {
	getById(requestId: string): Promise<RequestProjectionRecord | null>;
	getAuditById(auditEventId: string): Promise<OperatorAuditEventDetail | null>;
	getObservabilityById(requestId: string): Promise<OperatorRequestObservabilityRecord | null>;
	getOverview(filters: NormalizedOperatorOverviewFilters): Promise<OperatorOverviewResult>;
	getQualitySummary(
		filters: NormalizedOperatorOverviewFilters,
	): Promise<OperatorQualitySummaryResult>;
	getQualityTimeseries(
		filters: NormalizedOperatorOverviewFilters,
	): Promise<OperatorQualityTimeseriesResult>;
	getIntentSummary(
		filters: NormalizedOperatorOverviewFilters,
	): Promise<OperatorIntentSummaryResult>;
	getIntentTimeseries(
		filters: NormalizedOperatorOverviewFilters,
	): Promise<OperatorIntentTimeseriesResult>;
	getSafetySummary(
		filters: NormalizedOperatorOverviewFilters,
	): Promise<OperatorSafetySummaryResult>;
	listSafetyAnomalies(
		filters: NormalizedOperatorSafetyAnomalyListFilters,
	): Promise<OperatorSafetyAnomalyListResult>;
	getCostSummary(filters: NormalizedOperatorOverviewFilters): Promise<OperatorCostSummaryResult>;
	getCostTimeseries(
		filters: NormalizedOperatorOverviewFilters,
	): Promise<OperatorCostTimeseriesResult>;
	listQualityBadcases(
		filters: NormalizedOperatorQualityBadcaseListFilters,
	): Promise<OperatorQualityBadcaseListResult>;
	listAudit(filters: NormalizedOperatorAuditListFilters): Promise<OperatorAuditListResult>;
	list(filters: NormalizedOperatorRequestListFilters): Promise<OperatorQueryListResult>;
}

export interface OperatorQueryService {
	getById(input: {
		principal: ResolvedAppPrincipal;
		requestId: string;
	}): Promise<RequestProjectionRecord>;
	getObservabilityById(input: {
		principal: ResolvedAppPrincipal;
		requestId: string;
	}): Promise<OperatorRequestObservabilityRecord>;
	getAuditById(input: {
		principal: ResolvedAppPrincipal;
		auditEventId: string;
	}): Promise<OperatorAuditEventDetail>;
	getOverview(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorOverviewFilters;
	}): Promise<OperatorOverviewResult>;
	getQualitySummary(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorOverviewFilters;
	}): Promise<OperatorQualitySummaryResult>;
	getQualityTimeseries(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorOverviewFilters;
	}): Promise<OperatorQualityTimeseriesResult>;
	getIntentSummary(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorOverviewFilters;
	}): Promise<OperatorIntentSummaryResult>;
	getIntentTimeseries(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorOverviewFilters;
	}): Promise<OperatorIntentTimeseriesResult>;
	getSafetySummary(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorOverviewFilters;
	}): Promise<OperatorSafetySummaryResult>;
	listSafetyAnomalies(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorSafetyAnomalyListFilters;
	}): Promise<OperatorSafetyAnomalyListResult>;
	getCostSummary(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorOverviewFilters;
	}): Promise<OperatorCostSummaryResult>;
	getCostTimeseries(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorOverviewFilters;
	}): Promise<OperatorCostTimeseriesResult>;
	list(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorRequestListFilters;
	}): Promise<OperatorQueryListResult>;
	listAudit(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorAuditListFilters;
	}): Promise<OperatorAuditListResult>;
	listQualityBadcases(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorQualityBadcaseListFilters;
	}): Promise<OperatorQualityBadcaseListResult>;
	listQualityEvalCandidates(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorQualityBadcaseListFilters;
	}): Promise<OperatorQualityEvalCandidateListResult>;
}

export interface OperatorQueryServiceDependencies {
	store: OperatorQueryStore;
}
