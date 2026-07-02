import type { ResolvedAppPrincipal } from "../auth";
import type {
	ExecutionControlOperatorRuntimeHealth,
	ExecutionControlRuntimeClient,
} from "../integration";
import type {
	NormalizedOperatorOverviewFilters,
	NormalizedOperatorRequestListFilters,
	NormalizedTemporalTaskQueueListFilters,
	NormalizedWorkerAutoscalerActuationListFilters,
	NormalizedWorkerAutoscalerPostureListFilters,
	OperatorOverviewFilters,
	OperatorOverviewResult,
	OperatorQueryListResult,
	OperatorRequestListFilters,
	RequestProjectionRecord,
	TemporalTaskQueueListFilters,
	TemporalTaskQueueListResult,
	WorkerAutoscalerActuationListFilters,
	WorkerAutoscalerActuationListResult,
	WorkerAutoscalerPostureListFilters,
	WorkerAutoscalerPostureListResult,
} from "./service-types";

export interface OperatorQueryStore {
	getById(requestId: string): Promise<RequestProjectionRecord | null>;
	getOverview(filters: NormalizedOperatorOverviewFilters): Promise<OperatorOverviewResult>;
	listTemporalTaskQueues(
		filters: NormalizedTemporalTaskQueueListFilters,
	): Promise<TemporalTaskQueueListResult>;
	listAutoscalerActuations(
		filters: NormalizedWorkerAutoscalerActuationListFilters,
	): Promise<WorkerAutoscalerActuationListResult>;
	listAutoscalerPostures(
		filters: NormalizedWorkerAutoscalerPostureListFilters,
	): Promise<WorkerAutoscalerPostureListResult>;
	list(filters: NormalizedOperatorRequestListFilters): Promise<OperatorQueryListResult>;
}

export interface OperatorQueryService {
	getById(input: {
		principal: ResolvedAppPrincipal;
		requestId: string;
	}): Promise<RequestProjectionRecord>;
	getOverview(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorOverviewFilters;
	}): Promise<OperatorOverviewResult>;
	getRuntimeHealth(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<ExecutionControlOperatorRuntimeHealth>;
	list(input: {
		principal: ResolvedAppPrincipal;
		filters: OperatorRequestListFilters;
	}): Promise<OperatorQueryListResult>;
	listTemporalTaskQueues(input: {
		principal: ResolvedAppPrincipal;
		filters: TemporalTaskQueueListFilters;
	}): Promise<TemporalTaskQueueListResult>;
	listAutoscalerActuations(input: {
		principal: ResolvedAppPrincipal;
		filters: WorkerAutoscalerActuationListFilters;
	}): Promise<WorkerAutoscalerActuationListResult>;
	listAutoscalerPostures(input: {
		principal: ResolvedAppPrincipal;
		filters: WorkerAutoscalerPostureListFilters;
	}): Promise<WorkerAutoscalerPostureListResult>;
}

export interface OperatorQueryServiceDependencies {
	executionRuntime?: ExecutionControlRuntimeClient | null;
	store: OperatorQueryStore;
	runtimeHealthProbe?: (() => Promise<ExecutionControlOperatorRuntimeHealth>) | null;
}
