export type TemporalTaskQueueKind = "workflow" | "activity";
export type SourceMetricState = "observed" | "unsupported_by_source";
export type AutoscalerDecisionKind = "scale_up" | "scale_down" | "hold";
export type AutoscalerBudgetState = "within_budget" | "budget_exhausted" | "actuation_disabled";
export type AutoscalerActuationStatus = "applied" | "skipped" | "failed";
export type AutoscalerScalerKind = "docker_compose" | "keda_temporal";
export type AutoscalerScalerStatus = "healthy" | "degraded" | "paused" | "disabled";

export interface UnsupportedSourceMetric {
	state: "unsupported_by_source";
}

export interface CountSourceMetric {
	count: number | null;
	state: SourceMetricState;
}

export interface DurationSourceMetric {
	ms: number | null;
	state: SourceMetricState;
}

export interface TemporalTaskQueueSnapshotWrite {
	backlog: CountSourceMetric;
	namespace: string;
	oldestTaskAge: DurationSourceMetric;
	pollerCount: number;
	pollerIdentities: string[];
	projectedAt: string;
	sampledAt: string;
	scheduleToStartLatency: DurationSourceMetric;
	snapshotId: string;
	source: string;
	taskQueue: string;
	taskQueueKind: TemporalTaskQueueKind;
}

export interface WorkerAutoscalerDecisionWrite {
	budgetState: AutoscalerBudgetState;
	currentReplicas: number;
	decidedAt: string;
	decision: AutoscalerDecisionKind;
	decisionId: string;
	desiredReplicas: number;
	evidence: Record<string, unknown>;
	projectedAt: string;
	reason: string;
	sourceSnapshotId: string;
	targetService: string;
	taskQueue: string;
	taskQueueKind: TemporalTaskQueueKind;
}

export interface WorkerAutoscalerActuationWrite {
	actedAt: string;
	action: string;
	actuationId: string;
	actuatorKind: string;
	decisionId: string;
	errorCode: string | null;
	fromReplicas: number;
	projectedAt: string;
	status: AutoscalerActuationStatus;
	targetService: string;
	toReplicas: number;
}

export interface WorkerAutoscalerPostureWrite {
	currentReplicas: number;
	desiredReplicas: number;
	evidence: Record<string, unknown>;
	lastScaleEventAt: string | null;
	lastScaleEventId: string | null;
	maxReplicas: number;
	metricFreshness: DurationSourceMetric;
	minReplicas: number;
	observedAt: string;
	projectedAt: string;
	reason: string;
	scalerKind: AutoscalerScalerKind;
	scalerStatus: AutoscalerScalerStatus;
	taskQueue: string;
	taskQueueKind: TemporalTaskQueueKind;
	targetService: string;
}

export interface TemporalTaskQueueSnapshotRecord extends TemporalTaskQueueSnapshotWrite {}
export interface WorkerAutoscalerDecisionRecord
	extends Omit<WorkerAutoscalerDecisionWrite, "evidence"> {}
export interface WorkerAutoscalerActuationRecord extends WorkerAutoscalerActuationWrite {}
export interface WorkerAutoscalerPostureRecord extends WorkerAutoscalerPostureWrite {}

export interface TemporalTaskQueueListFilters {
	cursor?: string | null;
	limit?: number | null;
	taskQueue?: string | null;
	taskQueueKind?: string | null;
}

export interface NormalizedTemporalTaskQueueListFilters {
	cursor: string | null;
	limit: number;
	taskQueue: string | null;
	taskQueueKind: TemporalTaskQueueKind | null;
}

export interface WorkerAutoscalerDecisionListFilters {
	cursor?: string | null;
	decision?: string | null;
	limit?: number | null;
	targetService?: string | null;
}

export interface NormalizedWorkerAutoscalerDecisionListFilters {
	cursor: string | null;
	decision: AutoscalerDecisionKind | null;
	limit: number;
	targetService: string | null;
}

export interface WorkerAutoscalerActuationListFilters {
	cursor?: string | null;
	decisionId?: string | null;
	limit?: number | null;
	status?: string | null;
	targetService?: string | null;
}

export interface NormalizedWorkerAutoscalerActuationListFilters {
	cursor: string | null;
	decisionId: string | null;
	limit: number;
	status: AutoscalerActuationStatus | null;
	targetService: string | null;
}

export interface WorkerAutoscalerPostureListFilters {
	cursor?: string | null;
	limit?: number | null;
	scalerStatus?: string | null;
	targetService?: string | null;
}

export interface NormalizedWorkerAutoscalerPostureListFilters {
	cursor: string | null;
	limit: number;
	scalerStatus: AutoscalerScalerStatus | null;
	targetService: string | null;
}

export interface TemporalTaskQueueListResult {
	page: {
		nextCursor: string | null;
	};
	snapshots: TemporalTaskQueueSnapshotRecord[];
}

export interface WorkerAutoscalerPostureListResult {
	page: {
		nextCursor: string | null;
	};
	postures: WorkerAutoscalerPostureRecord[];
}

export interface WorkerAutoscalerDecisionListResult {
	decisions: WorkerAutoscalerDecisionRecord[];
	page: {
		nextCursor: string | null;
	};
}

export interface WorkerAutoscalerActuationListResult {
	actuations: WorkerAutoscalerActuationRecord[];
	page: {
		nextCursor: string | null;
	};
}
