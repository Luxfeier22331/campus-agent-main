import type { ExecutionControlOperatorRuntimeHealth } from "../integration";
import type { ToolExecutionWorkflowTraceSummary } from "../integration/tool-execution-types";
import type {
	RequestClaimSupportSummary,
	RequestDiagnosticsSummary,
	RequestRemoteContentSuspicionSummary,
	RequestRetrievalPlanSummary,
	RequestSourceTrustSummary,
} from "../request-diagnostics";
import type { RequestExecutionStatus } from "../runtime-command";
import type { RuntimeRunPhase } from "../runtime-run";
import type { ObservedSourceTraceEntry } from "../source-trace";
import type { VersionQuery, VersionQueryMode } from "../version-query";

export type {
	AutoscalerActuationStatus as WorkerAutoscalerActuationStatus,
	AutoscalerDecisionKind as WorkerAutoscalerDecisionKind,
	AutoscalerScalerStatus as WorkerAutoscalerScalerStatus,
	NormalizedTemporalTaskQueueListFilters,
	NormalizedWorkerAutoscalerActuationListFilters,
	NormalizedWorkerAutoscalerDecisionListFilters,
	NormalizedWorkerAutoscalerPostureListFilters,
	TemporalTaskQueueKind,
	TemporalTaskQueueListFilters,
	TemporalTaskQueueListResult,
	TemporalTaskQueueSnapshotRecord,
	WorkerAutoscalerActuationListFilters,
	WorkerAutoscalerActuationListResult,
	WorkerAutoscalerActuationRecord,
	WorkerAutoscalerDecisionListFilters,
	WorkerAutoscalerDecisionListResult,
	WorkerAutoscalerDecisionRecord,
	WorkerAutoscalerPostureListFilters,
	WorkerAutoscalerPostureListResult,
	WorkerAutoscalerPostureRecord,
} from "../operator-runtime-observability";

import type {
	MetricRatio,
	OperatorOverviewWindow,
	OperatorResultWindow,
} from "./service-metric-types";

export interface RequestProjectionRecord {
	requestId: string;
	runId: string | null;
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
	requestedTool: string | null;
	requestedScope: Record<string, unknown> | null;
	versionQuery?: VersionQuery;
	resolvedScope: Record<string, unknown> | null;
	selectedTool: string | null;
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
	selectedTool?: string | null;
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
	selectedTool: string | null;
	eventType: string | null;
	status: string | null;
}

export interface OperatorOverviewFilters {
	window?: string | null;
	granularity?: string | null;
	surface?: string | null;
	selectedTool?: string | null;
	requestedTool?: string | null;
	principalType?: string | null;
	collection?: string | null;
	modelName?: string | null;
}

export interface NormalizedOperatorOverviewFilters {
	window: OperatorOverviewWindow;
	granularity: OperatorResultWindow["granularity"] | null;
	surface: string | null;
	selectedTool: string | null;
	requestedTool: string | null;
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

export type OperatorRuntimeHealthResult = ExecutionControlOperatorRuntimeHealth;

export interface OperatorIntentObservabilitySummary {
	tool: string | null;
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
		runId: string | null;
		traceId: string;
		conversationId: string;
		surface: string;
		status: RequestExecutionStatus;
		requestedTool: string | null;
		requestedScope: Record<string, unknown> | null;
		versionQuery?: VersionQuery;
		resolvedScope: Record<string, unknown> | null;
		selectedTool: string | null;
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
		tool?: {
			businessOutcome: string | null;
			failCloseReason: string | null;
			historicalDowngradeReason: string | null;
			selectedTool: string | null;
		};
		workflowTrace?: ToolExecutionWorkflowTraceSummary | null;
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
			requestedTool: string | null;
			requestedScope: Record<string, unknown> | null;
			resolvedScope: Record<string, unknown> | null;
			selectedTool: string | null;
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
	runtimeRun?: OperatorRuntimeRunSummary | null;
}

export interface OperatorRuntimeRunEventSummary {
	eventType: string;
	occurredAt: string;
	sequence: number;
	visibility: string;
}

export interface OperatorRuntimeRunSummary {
	run: {
		conversationId: string;
		phase: RuntimeRunPhase;
		requestId: string;
		runId: string;
		status: string;
		terminalReason: string | null;
		traceId: string;
	};
	eventSummary: {
		eventCount: number;
		latestEvent: OperatorRuntimeRunEventSummary | null;
		terminalEvent: OperatorRuntimeRunEventSummary | null;
		visibilityCounts: {
			browser: number;
			eval: number;
			internal: number;
			panel: number;
		};
	};
	stepTrajectory: {
		attemptCount: number;
		resultCount: number;
		steps: Array<{
			attemptCount: number;
			agentSdkTraceRef?: string | null;
			agentSelectedTools?: string[];
			agentTerminalReason?: string | null;
			agentToolResultRefs?: string[];
			tool: string;
			cancelOutcome: string | null;
			durationMs: number | null;
			estimatedCostMicrousd: number;
			failCloseReason: string | null;
			inputTokens: number;
			lateCompletionOutcome: string | null;
			latestResultRef: string | null;
			modelName: string | null;
			modelProvider: string | null;
			outputTokens: number;
			providerRequestRef: string | null;
			queueWaitMs: number | null;
			replanReason: string | null;
			resultCount: number;
			status: string;
			stepId: string;
			stepKind: string;
			taskQueue: string;
			timeoutOutcome: string | null;
			workerId: string;
		}>;
	};
	operatorStepTrajectory: {
		conversationId: string;
		requestId: string;
		runId: string;
		schemaVersion: "operator_step_trajectory.v1";
		steps: Array<{
			agentSdkTraceRef?: string | null;
			agentSelectedTools?: string[];
			agentTerminalReason?: string | null;
			agentToolResultRefs?: string[];
			attemptCount: number;
			tool: string;
			cancelOutcome: string | null;
			durationMs: number | null;
			estimatedCostMicrousd: number;
			failCloseReason: string | null;
			inputTokens: number;
			lateCompletionOutcome: string | null;
			latestResultRef: string | null;
			modelName: string | null;
			modelProvider: string | null;
			outputTokens: number;
			projectionRefs: string[];
			providerRequestRef: string | null;
			queueWaitMs: number | null;
			replanReason: string | null;
			resultCount: number;
			status: string;
			stepId: string;
			stepKind: string;
			taskQueue: string;
			terminalReason: string | null;
			timeoutOutcome: string | null;
			toolName: string | null;
			toolStatus: string | null;
			workerId: string;
		}>;
		traceId: string;
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
	selectedTool: string | null;
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
		requestedTool: string | null;
		selectedTool: string | null;
		status: string;
		terminalCode: string | null;
		summary: string;
		diagnostics: {
			failClosed: boolean | null;
			aclAnomalyCode: string | null;
			activityDurationMs?: number | null;
			decision?: string | null;
			durationMs?: number | null;
			failureKind?: string | null;
			httpStatus?: number | null;
			taskQueue?: string | null;
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

export type {
	OperatorQueryService,
	OperatorQueryServiceDependencies,
	OperatorQueryStore,
} from "./service-contracts";
export type {
	OperatorIntentSummaryResult,
	OperatorIntentTimeseriesResult,
} from "./service-intent-types";
export type {
	MetricRatio,
	OperatorDistributionBucket,
	OperatorOverviewWindow,
	OperatorResultWindow,
} from "./service-metric-types";
export type {
	NormalizedOperatorQualityBadcaseListFilters,
	OperatorQualityBadcaseListFilters,
	OperatorQualityBadcaseListResult,
	OperatorQualityEvalCandidateListResult,
	OperatorQualitySummaryResult,
	OperatorQualityTimeseriesResult,
} from "./service-quality-types";
export type {
	NormalizedOperatorSafetyAnomalyListFilters,
	OperatorCostSummaryResult,
	OperatorCostTimeseriesResult,
	OperatorSafetyAnomalyListFilters,
	OperatorSafetyAnomalyListResult,
	OperatorSafetySummaryResult,
} from "./service-safety-cost-types";
