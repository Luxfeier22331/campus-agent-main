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
