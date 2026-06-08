import type {
	MetricRatio,
	OperatorDistributionBucket,
	OperatorResultWindow,
} from "./service-metric-types";

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
