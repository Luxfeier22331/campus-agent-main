export type OperatorOverviewWindow = "15m" | "1h" | "24h" | "7d" | "30d";

export type OperatorTimeseriesGranularity = "5m" | "15m" | "1h" | "1d";

export interface OperatorAggregateFilterInput {
	collection?: string | null;
	modelName?: string | null;
	principalType?: string | null;
	requestedCapability?: string | null;
	selectedCapability?: string | null;
	surface?: string | null;
	window?: OperatorOverviewWindow | null;
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

export type OperatorRuntimeReadinessCheckStatus = "ready" | "not_ready" | "not_reported";

export interface RawOperatorRuntimeHealthRecord {
	asOf: string;
	executionRuntime: {
		blockers: Record<string, string>;
		checks: {
			runProjectionStore: OperatorRuntimeReadinessCheckStatus;
			temporalRuntime: OperatorRuntimeReadinessCheckStatus;
		};
		status: "ready" | "blocked" | "not_reported";
	};
	runProjectionStore: {
		configured: boolean;
		healthy: boolean;
		lastError: string | null;
	} | null;
	status: "ready" | "degraded";
	temporalRuntime: {
		configured: boolean;
		healthy: boolean;
		lastError: string | null;
		namespace: string;
		requiredTaskQueues: string[];
		taskQueueGate: "pollers_required";
		taskQueuePollers: Array<{
			healthy: boolean;
			name: string;
			pollers: number;
			type: string;
		}>;
		workerId: string;
		workflowTaskQueue: string;
	} | null;
}

export type OperatorRuntimeHealthRecord = RawOperatorRuntimeHealthRecord;

export function normalizeOperatorRuntimeHealthRecord(
	input: RawOperatorRuntimeHealthRecord,
): OperatorRuntimeHealthRecord {
	return input;
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
