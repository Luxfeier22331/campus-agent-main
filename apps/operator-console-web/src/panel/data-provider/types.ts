import type { DataProvider, Identifier } from "react-admin";

import type {
	OperatorAggregateFilterInput,
	OperatorAuditEventDetailResponse,
	OperatorAuditEventRecord,
	OperatorAuditListFilterInput,
	OperatorCostSummaryRecord,
	OperatorCostTimeseriesRecord,
	OperatorEvalCoverageRecord,
	OperatorIntentSummaryRecord,
	OperatorIntentTimeseriesRecord,
	OperatorOverviewRecord,
	OperatorQualityBadcaseListFilterInput,
	OperatorQualityBadcaseRecord,
	OperatorQualityEvalCandidateRecord,
	OperatorQualitySummaryRecord,
	OperatorQualityTimeseriesRecord,
	OperatorSafetyAnomalyListFilterInput,
	OperatorSafetyAnomalyRecord,
	OperatorSafetySummaryRecord,
	OperatorTimeseriesFilterInput,
	PanelOverviewRecord,
	RequestObservabilityRecord,
} from "../types";

export interface OperatorConsoleDataProvider extends DataProvider {
	getOverview(input?: { signal?: AbortSignal }): Promise<{ data: PanelOverviewRecord }>;
	getOperatorOverview(
		input?: OperatorAggregateFilterInput & { signal?: AbortSignal },
	): Promise<{ data: OperatorOverviewRecord }>;
	getOperatorQualitySummary(
		input?: OperatorAggregateFilterInput & { signal?: AbortSignal },
	): Promise<{ data: OperatorQualitySummaryRecord }>;
	getOperatorQualityTimeseries(
		input?: OperatorTimeseriesFilterInput & { signal?: AbortSignal },
	): Promise<{ data: OperatorQualityTimeseriesRecord }>;
	getOperatorIntentSummary(
		input?: OperatorAggregateFilterInput & { signal?: AbortSignal },
	): Promise<{ data: OperatorIntentSummaryRecord }>;
	getOperatorIntentTimeseries(
		input?: OperatorTimeseriesFilterInput & { signal?: AbortSignal },
	): Promise<{ data: OperatorIntentTimeseriesRecord }>;
	listOperatorQualityBadcases(
		input?: OperatorQualityBadcaseListFilterInput & { signal?: AbortSignal },
	): Promise<{
		data: OperatorQualityBadcaseRecord[];
		pageInfo: {
			hasNextPage: boolean;
			hasPreviousPage: boolean;
		};
	}>;
	listOperatorQualityEvalCandidates(
		input?: OperatorQualityBadcaseListFilterInput & { signal?: AbortSignal },
	): Promise<{
		data: OperatorQualityEvalCandidateRecord[];
		pageInfo: {
			hasNextPage: boolean;
			hasPreviousPage: boolean;
		};
	}>;
	getOperatorSafetySummary(
		input?: OperatorAggregateFilterInput & { signal?: AbortSignal },
	): Promise<{ data: OperatorSafetySummaryRecord }>;
	listOperatorSafetyAnomalies(
		input?: OperatorSafetyAnomalyListFilterInput & { signal?: AbortSignal },
	): Promise<{
		data: OperatorSafetyAnomalyRecord[];
		pageInfo: {
			hasNextPage: boolean;
			hasPreviousPage: boolean;
		};
	}>;
	getOperatorCostSummary(
		input?: OperatorAggregateFilterInput & { signal?: AbortSignal },
	): Promise<{ data: OperatorCostSummaryRecord }>;
	getOperatorCostTimeseries(
		input?: OperatorTimeseriesFilterInput & { signal?: AbortSignal },
	): Promise<{ data: OperatorCostTimeseriesRecord }>;
	getOperatorEvalCoverage(input?: { signal?: AbortSignal }): Promise<{
		data: OperatorEvalCoverageRecord;
	}>;
	listOperatorAudit(input?: OperatorAuditListFilterInput & { signal?: AbortSignal }): Promise<{
		data: OperatorAuditEventRecord[];
		pageInfo: {
			hasNextPage: boolean;
			hasPreviousPage: boolean;
		};
	}>;
	getOperatorAuditEvent(input: {
		auditEventId: Identifier;
		signal?: AbortSignal;
	}): Promise<{ data: OperatorAuditEventDetailResponse }>;
	getRequestObservability(input: {
		requestId: Identifier;
		signal?: AbortSignal;
	}): Promise<{ data: RequestObservabilityRecord }>;
}
