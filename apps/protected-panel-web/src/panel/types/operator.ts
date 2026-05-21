export type OperatorOverviewWindow = "15m" | "1h" | "24h" | "7d" | "30d";

export type OperatorTimeseriesGranularity = "5m" | "15m" | "1h" | "1d";

export interface OperatorAggregateFilterInput {
	collection?: string | null;
	modelName?: string | null;
	principalType?: string | null;
	requestedCapability?: string | null;
	selectedTarget?: string | null;
	surface?: string | null;
	window?: OperatorOverviewWindow | null;
}

export interface OperatorTimeseriesFilterInput extends OperatorAggregateFilterInput {
	granularity?: OperatorTimeseriesGranularity | null;
}

export interface OperatorCursorPageInput {
	page?: number;
	perPage?: number;
}

export interface OperatorQualityBadcaseListFilterInput extends OperatorCursorPageInput {
	causeClass?: string | null;
	detectedBy?: string | null;
	selectedTarget?: string | null;
	status?: string | null;
	surface?: string | null;
	window?: OperatorOverviewWindow | null;
}

export interface OperatorSafetyAnomalyListFilterInput extends OperatorCursorPageInput {
	anomalyCode?: string | null;
	selectedTarget?: string | null;
	severity?: string | null;
	status?: string | null;
	surface?: string | null;
	window?: OperatorOverviewWindow | null;
}

export interface OperatorAuditListFilterInput extends OperatorCursorPageInput {
	eventType?: string | null;
	principalType?: string | null;
	requestId?: string | null;
	selectedTarget?: string | null;
	status?: string | null;
	surface?: string | null;
	traceId?: string | null;
}

export interface RawOperatorMetricRatio {
	count: number;
	eligibleCount: number | null;
	value: number;
}

export type OperatorMetricRatio = RawOperatorMetricRatio;

export interface RawOperatorResultWindow {
	from: string;
	granularity: OperatorTimeseriesGranularity;
	to: string;
}

export type OperatorResultWindow = RawOperatorResultWindow;

export interface RawOperatorOverviewAlert {
	alertId: string;
	code: string;
	domain: string;
	incidentBackfill: {
		mode: "incident_backfill" | null;
		required: boolean;
	};
	requestCount: number;
	severity: string;
	startedAt: string;
	status: string;
}

export interface OperatorOverviewAlert extends RawOperatorOverviewAlert {
	id: string;
}

export interface RawOperatorOverviewRecord {
	alerts: RawOperatorOverviewAlert[];
	asOf: string;
	overview: {
		aclAnomalyRate: RawOperatorMetricRatio;
		citationMissRate: RawOperatorMetricRatio;
		emptyRecallRate: RawOperatorMetricRatio;
		estimatedCost: {
			currency: "USD";
			microusd: number;
		};
		failureRate: RawOperatorMetricRatio;
		latency: {
			p50Ms: number | null;
			p95Ms: number | null;
			p99Ms: number | null;
		};
		refusalRate: RawOperatorMetricRatio;
		requestVolume: {
			accepted: number;
			completed: number;
			errored: number;
		};
		sinkHealth: {
			missingTraceRate: RawOperatorMetricRatio;
			outboxPendingCount: number;
			outboxRetryCount: number;
			outboxStaleCount: number;
			projectionFailureCount: number;
		};
	};
	window: RawOperatorResultWindow;
}

export interface OperatorOverviewRecord extends Omit<RawOperatorOverviewRecord, "alerts"> {
	alerts: OperatorOverviewAlert[];
}

export interface RawOperatorQualitySummaryRecord {
	asOf: string;
	runtime: {
		citationMissRate: RawOperatorMetricRatio;
		emptyRecallRate: RawOperatorMetricRatio;
		feedback: {
			coverageRate: RawOperatorMetricRatio;
			distributions: {
				answerKind: RawOperatorDistributionBucket[];
				capability: RawOperatorDistributionBucket[];
				citationPosture: RawOperatorDistributionBucket[];
				reasonCode: RawOperatorDistributionBucket[];
				surface: RawOperatorDistributionBucket[];
				vote: RawOperatorDistributionBucket[];
			};
			feedbackCount: number;
			helpfulRate: RawOperatorMetricRatio;
			noAnswerUnhelpfulRate: RawOperatorMetricRatio;
			unhelpfulRate: RawOperatorMetricRatio;
		};
		refusalDistribution: {
			approvalRequired: number;
			needsClarification: number;
			noAnswer: number;
			rejected: number;
		};
		requestCount: number;
	};
	sampledGrades: {
		badcaseOpenCount: number | null;
		citationPassRate: RawOperatorMetricRatio | null;
		coverageRate: RawOperatorMetricRatio | null;
		groundingPassRate: RawOperatorMetricRatio | null;
		intentPassRate: RawOperatorMetricRatio | null;
		policyPassRate: RawOperatorMetricRatio | null;
	} | null;
	window: RawOperatorResultWindow;
}

export type OperatorQualitySummaryRecord = RawOperatorQualitySummaryRecord;

export interface RawOperatorQualityTimeseriesBucket {
	bucketEnd: string;
	bucketStart: string;
	citationMissRate: number;
	emptyRecallRate: number;
	feedbackCount: number;
	feedbackCoverageRate: number;
	feedbackEligibleAnswerCount: number;
	feedbackHelpfulCount: number;
	feedbackHelpfulRate: number;
	feedbackNoAnswerEligibleCount: number;
	feedbackNoAnswerUnhelpfulCount: number;
	feedbackNoAnswerUnhelpfulRate: number;
	feedbackUnhelpfulCount: number;
	feedbackUnhelpfulRate: number;
	needsClarificationRate: number;
	noAnswerRate: number;
	requestCount: number;
	sampledGroundingPassRate: number | null;
}

export interface RawOperatorQualityTimeseriesRecord {
	asOf: string;
	series: RawOperatorQualityTimeseriesBucket[];
	window: RawOperatorResultWindow;
}

export type OperatorQualityTimeseriesRecord = RawOperatorQualityTimeseriesRecord;

export interface RawOperatorDistributionBucket {
	count: number;
	value: string;
}

export type OperatorDistributionBucket = RawOperatorDistributionBucket;

export interface RawOperatorIntentSummaryRecord {
	asOf: string;
	runtime: {
		ambiguityRate: RawOperatorMetricRatio;
		contextUnresolvedRate: RawOperatorMetricRatio;
		distributions: {
			capability: RawOperatorDistributionBucket[];
			classifierVersion: RawOperatorDistributionBucket[];
			launchState: RawOperatorDistributionBucket[];
			nextAction: RawOperatorDistributionBucket[];
			schemaVersion: RawOperatorDistributionBucket[];
			scopeClass: RawOperatorDistributionBucket[];
			taskKind: RawOperatorDistributionBucket[];
		};
		lowConfidenceRate: RawOperatorMetricRatio;
		requestCount: number;
	};
	sampledGrades: {
		coverageRate: RawOperatorMetricRatio | null;
		intentPassRate: RawOperatorMetricRatio | null;
	} | null;
	window: RawOperatorResultWindow;
}

export type OperatorIntentSummaryRecord = RawOperatorIntentSummaryRecord;

export interface RawOperatorIntentTimeseriesBucket {
	ambiguityRate: number;
	bucketEnd: string;
	bucketStart: string;
	contextUnresolvedRate: number;
	lowConfidenceRate: number;
	requestCount: number;
	sampledIntentPassRate: number | null;
}

export interface RawOperatorIntentTimeseriesRecord {
	asOf: string;
	series: RawOperatorIntentTimeseriesBucket[];
	window: RawOperatorResultWindow;
}

export type OperatorIntentTimeseriesRecord = RawOperatorIntentTimeseriesRecord;

export interface RawOperatorTraceLinks {
	issueFingerprint: string | null;
	issueLink: string | null;
	traceLink: string | null;
}

export interface RawOperatorQualityBadcaseRecord {
	badcaseId: string;
	causeClass: string;
	detectedBy: string;
	grade: {
		graderVersion: string;
		result: string;
		score: number | null;
	} | null;
	links: RawOperatorTraceLinks;
	openedAt: string;
	requestId: string;
	selectedTarget: string | null;
	status: string;
	summary: string;
	surface: string;
	traceId: string;
}

export interface OperatorQualityBadcaseRecord extends RawOperatorQualityBadcaseRecord {
	id: string;
}

export interface RawOperatorQualityBadcaseListResponse {
	badcases: RawOperatorQualityBadcaseRecord[];
	page: {
		nextCursor: string | null;
	};
}

export interface RawOperatorQualityEvalCandidateRecord {
	candidateId: string;
	causeClass: string;
	correlation?: {
		answerKind: string;
		assistantMessageId: string;
		citationPosture: string;
		conversationId: string;
		intent: {
			capability?: string | null;
			classifierVersion?: string | null;
			launchState?: string | null;
			nextAction?: string | null;
			scopeClass?: string | null;
			taskKind?: string | null;
		};
	};
	feedback?: {
		feedbackId: string;
		reasonCodes: string[];
		updatedAt: string;
		vote: "unhelpful";
	};
	diagnostic?: {
		answerShape: string | null;
		caseId: string;
		expectedDocIds: string[];
		failureStage: "retrieval" | "evidence_selection" | "synthesis" | "diagnostic";
		metricFailureReason: string;
		metricName: string;
		presentationKind: string | null;
		retrievedContextIds: string[];
		retrievedDocIds: string[];
		score: number;
		supportingDocIds: string[];
		threshold: number;
	};
	grade: {
		graderVersion: string;
		result: string;
		score: number | null;
	} | null;
	intake: {
		createdAt: string;
		source: "operator_badcase" | "negative_feedback" | "ragas_diagnostic";
		status: "pending_review";
		suggestedEvalFamily: "citation" | "grounding" | "intent" | "policy" | "unknown";
	};
	links: RawOperatorTraceLinks;
	privacy?: {
		providerRawResponseIncluded: false;
		rawAuthMaterialIncluded: false;
		rawTranscriptIncluded: false;
	};
	review?: {
		suggestedLabels: Array<
			| "false_positive"
			| "false_negative"
			| "wrong_intent"
			| "stale_missing_evidence"
			| "answer_style_issue"
		>;
	};
	requestId: string | null;
	selectedTarget: string | null;
	summary: string;
	surface: string;
	traceId: string | null;
}

export interface OperatorQualityEvalCandidateRecord extends RawOperatorQualityEvalCandidateRecord {
	id: string;
}

export interface RawOperatorQualityEvalCandidateListResponse {
	candidates: RawOperatorQualityEvalCandidateRecord[];
	page: {
		nextCursor: string | null;
	};
}

export interface RawOperatorSafetySummaryRecord {
	asOf: string;
	summary: {
		aclAnomalyRate: RawOperatorMetricRatio;
		decisionDistribution: {
			allowed: number;
			approvalRequired: number;
			denied: number;
			failClosed: number;
		};
		failClosedRate: RawOperatorMetricRatio;
		restrictedDenyRate: RawOperatorMetricRatio;
	};
	window: RawOperatorResultWindow;
}

export type OperatorSafetySummaryRecord = RawOperatorSafetySummaryRecord;

export interface RawOperatorSafetyAnomalyRecord {
	anomalyCode: string;
	anomalyId: string;
	detectedAt: string;
	links: RawOperatorTraceLinks;
	principalType: string;
	requestId: string;
	selectedTarget: string | null;
	severity: "high" | "medium";
	status: "open";
	summary: string;
	surface: string;
	traceId: string;
}

export interface OperatorSafetyAnomalyRecord extends RawOperatorSafetyAnomalyRecord {
	id: string;
}

export interface RawOperatorSafetyAnomalyListResponse {
	anomalies: RawOperatorSafetyAnomalyRecord[];
	page: {
		nextCursor: string | null;
	};
}

export interface RawOperatorCostSummaryRecord {
	asOf: string;
	summary: {
		byModel: Array<{
			estimatedCostMicrousd: number;
			modelName: string;
			requestCount: number;
		}>;
		bySurface: Array<{
			estimatedCostMicrousd: number;
			requestCount: number;
			surface: string;
		}>;
		estimatedCost: {
			currency: "USD";
			microusd: number;
		};
		tokens: {
			cachedInput: number;
			input: number;
			output: number;
		};
	};
	window: RawOperatorResultWindow;
}

export type OperatorCostSummaryRecord = RawOperatorCostSummaryRecord;

export interface RawOperatorCostTimeseriesBucket {
	bucketEnd: string;
	bucketStart: string;
	cachedInputTokens: number;
	estimatedCostMicrousd: number;
	inputTokens: number;
	outputTokens: number;
}

export interface RawOperatorCostTimeseriesRecord {
	asOf: string;
	series: RawOperatorCostTimeseriesBucket[];
	window: RawOperatorResultWindow;
}

export type OperatorCostTimeseriesRecord = RawOperatorCostTimeseriesRecord;

export interface RawOperatorAuditEventRecord {
	auditEventId: string;
	eventType: string;
	occurredAt: string;
	principalType: string;
	requestId: string;
	selectedTarget: string | null;
	status: string;
	summary: string;
	surface: string;
	traceId: string;
}

export interface OperatorAuditEventRecord extends RawOperatorAuditEventRecord {
	id: string;
}

export interface RawOperatorAuditListResponse {
	events: RawOperatorAuditEventRecord[];
	page: {
		nextCursor: string | null;
	};
}

export interface RawOperatorAuditEventDetailRecord {
	auditEventId: string;
	diagnostics: {
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
	};
	entitlementSnapshotId: string | null;
	eventType: string;
	occurredAt: string;
	policyProjectionVersion: string | null;
	principalType: string;
	requestId: string;
	requestedCapability: string | null;
	selectedTarget: string | null;
	status: string;
	summary: string;
	surface: string;
	terminalCode: string | null;
	traceId: string;
}

export interface OperatorAuditEventDetailRecord extends RawOperatorAuditEventDetailRecord {
	id: string;
}

export interface RawOperatorAuditEventDetailResponse {
	event: RawOperatorAuditEventDetailRecord;
	links: RawOperatorTraceLinks;
}

export interface OperatorAuditEventDetailResponse {
	event: OperatorAuditEventDetailRecord;
	links: RawOperatorTraceLinks;
}

export function normalizeOperatorOverviewAlert(
	input: RawOperatorOverviewAlert,
): OperatorOverviewAlert {
	return {
		...input,
		id: input.alertId,
	};
}

export function normalizeOperatorOverviewRecord(
	input: RawOperatorOverviewRecord,
): OperatorOverviewRecord {
	const sinkHealth = input.overview.sinkHealth as Partial<
		RawOperatorOverviewRecord["overview"]["sinkHealth"]
	> &
		Pick<
			RawOperatorOverviewRecord["overview"]["sinkHealth"],
			"missingTraceRate" | "projectionFailureCount"
		>;

	return {
		...input,
		alerts: input.alerts.map(normalizeOperatorOverviewAlert),
		overview: {
			...input.overview,
			sinkHealth: {
				...sinkHealth,
				outboxPendingCount: sinkHealth.outboxPendingCount ?? 0,
				outboxRetryCount: sinkHealth.outboxRetryCount ?? 0,
				outboxStaleCount: sinkHealth.outboxStaleCount ?? 0,
			},
		},
	};
}

export function normalizeOperatorQualitySummaryRecord(
	input: RawOperatorQualitySummaryRecord,
): OperatorQualitySummaryRecord {
	return {
		...input,
	};
}

export function normalizeOperatorQualityTimeseriesRecord(
	input: RawOperatorQualityTimeseriesRecord,
): OperatorQualityTimeseriesRecord {
	return {
		...input,
	};
}

export function normalizeOperatorIntentSummaryRecord(
	input: RawOperatorIntentSummaryRecord,
): OperatorIntentSummaryRecord {
	return {
		...input,
	};
}

export function normalizeOperatorIntentTimeseriesRecord(
	input: RawOperatorIntentTimeseriesRecord,
): OperatorIntentTimeseriesRecord {
	return {
		...input,
	};
}

export function normalizeOperatorQualityBadcaseRecord(
	input: RawOperatorQualityBadcaseRecord,
): OperatorQualityBadcaseRecord {
	return {
		...input,
		id: input.badcaseId,
	};
}

export function normalizeOperatorQualityEvalCandidateRecord(
	input: RawOperatorQualityEvalCandidateRecord,
): OperatorQualityEvalCandidateRecord {
	return {
		...input,
		id: input.candidateId,
	};
}

export function normalizeOperatorSafetySummaryRecord(
	input: RawOperatorSafetySummaryRecord,
): OperatorSafetySummaryRecord {
	return {
		...input,
	};
}

export function normalizeOperatorSafetyAnomalyRecord(
	input: RawOperatorSafetyAnomalyRecord,
): OperatorSafetyAnomalyRecord {
	return {
		...input,
		id: input.anomalyId,
	};
}

export function normalizeOperatorCostSummaryRecord(
	input: RawOperatorCostSummaryRecord,
): OperatorCostSummaryRecord {
	return {
		...input,
	};
}

export function normalizeOperatorCostTimeseriesRecord(
	input: RawOperatorCostTimeseriesRecord,
): OperatorCostTimeseriesRecord {
	return {
		...input,
	};
}

export function normalizeOperatorAuditEventRecord(
	input: RawOperatorAuditEventRecord,
): OperatorAuditEventRecord {
	return {
		...input,
		id: input.auditEventId,
	};
}

export function normalizeOperatorAuditEventDetailRecord(
	input: RawOperatorAuditEventDetailResponse,
): OperatorAuditEventDetailResponse {
	return {
		...input,
		event: {
			...input.event,
			id: input.event.auditEventId,
		},
	};
}
