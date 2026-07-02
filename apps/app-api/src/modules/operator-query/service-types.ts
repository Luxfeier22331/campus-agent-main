import type { ExecutionControlOperatorRuntimeHealth } from "../integration";
import type { RequestDiagnosticsSummary } from "../request-diagnostics";
import type { RequestExecutionStatus } from "../runtime-command";
import type { VersionQuery } from "../version-query";

export type {
	AutoscalerActuationStatus as WorkerAutoscalerActuationStatus,
	AutoscalerScalerStatus as WorkerAutoscalerScalerStatus,
	NormalizedTemporalTaskQueueListFilters,
	NormalizedWorkerAutoscalerActuationListFilters,
	NormalizedWorkerAutoscalerPostureListFilters,
	TemporalTaskQueueKind,
	TemporalTaskQueueListFilters,
	TemporalTaskQueueListResult,
	TemporalTaskQueueSnapshotRecord,
	WorkerAutoscalerActuationListFilters,
	WorkerAutoscalerActuationListResult,
	WorkerAutoscalerActuationRecord,
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

export interface NormalizedOperatorRequestListFilters {
	limit: number;
	cursor: string | null;
	q: string | null;
	status: string | null;
	surface: string | null;
	conversationId: string | null;
	requestId: string | null;
}

export interface OperatorOverviewFilters {
	window?: string | null;
	granularity?: string | null;
	surface?: string | null;
	principalType?: string | null;
}

export interface NormalizedOperatorOverviewFilters {
	window: OperatorOverviewWindow;
	granularity: OperatorResultWindow["granularity"] | null;
	surface: string | null;
	principalType: string | null;
}

export interface OperatorQueryListResult {
	requests: RequestProjectionRecord[];
	page: {
		nextCursor: string | null;
	};
}

export type OperatorRuntimeHealthResult = ExecutionControlOperatorRuntimeHealth;

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
		sinkHealth: {
			missingTraceRate: MetricRatio;
			projectionFailureCount: number;
			outboxPendingCount: number;
			outboxRetryCount: number;
			outboxStaleCount: number;
		};
	};
	asOf: string;
}

export type {
	OperatorQueryService,
	OperatorQueryServiceDependencies,
	OperatorQueryStore,
} from "./service-contracts";
export type {
	MetricRatio,
	OperatorDistributionBucket,
	OperatorOverviewWindow,
	OperatorResultWindow,
} from "./service-metric-types";
