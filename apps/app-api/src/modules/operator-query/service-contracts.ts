import type { ResolvedAppPrincipal } from "../auth";
import type {
	ExecutionControlOperatorRuntimeHealth,
	ExecutionControlRuntimeClient,
} from "../integration";
import type {
	NormalizedOperatorAuditListFilters,
	NormalizedOperatorOverviewFilters,
	NormalizedOperatorQualityBadcaseListFilters,
	NormalizedOperatorRequestListFilters,
	NormalizedOperatorSafetyAnomalyListFilters,
	NormalizedTemporalTaskQueueListFilters,
	NormalizedWorkerAutoscalerActuationListFilters,
	NormalizedWorkerAutoscalerDecisionListFilters,
	OperatorAuditEventDetail,
	OperatorAuditListFilters,
	OperatorAuditListResult,
	OperatorCostSummaryResult,
	OperatorCostTimeseriesResult,
	OperatorEvalCoverageResult,
	OperatorIntentSummaryResult,
	OperatorIntentTimeseriesResult,
	OperatorLangfuseEvalBacklinkResult,
	OperatorOverviewFilters,
	OperatorOverviewResult,
	OperatorQualityBadcaseListFilters,
	OperatorQualityBadcaseListResult,
	OperatorQualityEvalCandidateListResult,
	OperatorQualitySummaryResult,
	OperatorQualityTimeseriesResult,
	OperatorQueryListResult,
	OperatorRequestListFilters,
	OperatorRequestObservabilityRecord,
	OperatorSafetyAnomalyListFilters,
	OperatorSafetyAnomalyListResult,
	OperatorSafetySummaryResult,
	RequestProjectionRecord,
	TemporalTaskQueueListFilters,
	TemporalTaskQueueListResult,
	WorkerAutoscalerActuationListFilters,
	WorkerAutoscalerActuationListResult,
	WorkerAutoscalerDecisionListFilters,
	WorkerAutoscalerDecisionListResult,
} from "./service-types";

export interface OperatorQueryStore {
	getById(requestId: string): Promise<RequestProjectionRecord | null>;
	getAuditById(auditEventId: string): Promise<OperatorAuditEventDetail | null>;
	getEvalCoverage(): Promise<OperatorEvalCoverageResult | null>;
	getLangfuseEvalBacklinksByTraceId(traceId: string): Promise<OperatorLangfuseEvalBacklinkResult>;
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
	listQualityFeedbackEvalCandidates(
		filters: NormalizedOperatorQualityBadcaseListFilters,
	): Promise<OperatorQualityEvalCandidateListResult>;
	listEvalDiagnosticCandidates(
		filters: NormalizedOperatorQualityBadcaseListFilters,
	): Promise<OperatorQualityEvalCandidateListResult>;
	listTemporalTaskQueues(
		filters: NormalizedTemporalTaskQueueListFilters,
	): Promise<TemporalTaskQueueListResult>;
	listAutoscalerDecisions(
		filters: NormalizedWorkerAutoscalerDecisionListFilters,
	): Promise<WorkerAutoscalerDecisionListResult>;
	listAutoscalerActuations(
		filters: NormalizedWorkerAutoscalerActuationListFilters,
	): Promise<WorkerAutoscalerActuationListResult>;
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
	getEvalCoverage(input: { principal: ResolvedAppPrincipal }): Promise<OperatorEvalCoverageResult>;
	getLangfuseEvalBacklinksByTraceId(input: {
		principal: ResolvedAppPrincipal;
		traceId: string;
	}): Promise<OperatorLangfuseEvalBacklinkResult>;
	getOverview(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorOverviewFilters;
	}): Promise<OperatorOverviewResult>;
	getRuntimeHealth(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<ExecutionControlOperatorRuntimeHealth>;
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
	listTemporalTaskQueues(input: {
		principal: ResolvedAppPrincipal;
		filters: TemporalTaskQueueListFilters;
	}): Promise<TemporalTaskQueueListResult>;
	listAutoscalerDecisions(input: {
		principal: ResolvedAppPrincipal;
		filters: WorkerAutoscalerDecisionListFilters;
	}): Promise<WorkerAutoscalerDecisionListResult>;
	listAutoscalerActuations(input: {
		principal: ResolvedAppPrincipal;
		filters: WorkerAutoscalerActuationListFilters;
	}): Promise<WorkerAutoscalerActuationListResult>;
}

export interface OperatorQueryServiceDependencies {
	executionRuntime?: ExecutionControlRuntimeClient | null;
	store: OperatorQueryStore;
	runtimeHealthProbe?: (() => Promise<ExecutionControlOperatorRuntimeHealth>) | null;
}
