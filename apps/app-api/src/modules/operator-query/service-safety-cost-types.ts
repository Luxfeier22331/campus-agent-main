import type {
	MetricRatio,
	OperatorOverviewWindow,
	OperatorResultWindow,
} from "./service-metric-types";

export interface OperatorSafetyAnomalyListFilters {
	limit?: number | null;
	cursor?: string | null;
	window?: string | null;
	surface?: string | null;
	selectedCapability?: string | null;
	severity?: string | null;
	status?: string | null;
	anomalyCode?: string | null;
}

export interface NormalizedOperatorSafetyAnomalyListFilters {
	limit: number;
	cursor: string | null;
	window: OperatorOverviewWindow | null;
	surface: string | null;
	selectedCapability: string | null;
	severity: string | null;
	status: string | null;
	anomalyCode: string | null;
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
		selectedCapability: string | null;
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
