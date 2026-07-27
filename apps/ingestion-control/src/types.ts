import type {
	IngestionTaskOperatorProjectionList,
	IngestionTaskProjectionFilters,
	IngestionTaskRecord,
} from "ingest-core";
import type { IngestionTaskExecutionSnapshot, IngestionTaskResult } from "ingestion-contracts";

export type StoreClock = () => Date;
export type MaybePromise<T> = T | Promise<T>;

export interface RecordIngestionTaskStartedInput {
	createdBy: string;
	retryOfTaskId: string | null;
	snapshot: IngestionTaskExecutionSnapshot;
	workflowId: string;
	workflowRunId: string;
}

export interface IngestionTaskStore {
	recordTaskStarted(input: RecordIngestionTaskStartedInput): MaybePromise<IngestionTaskRecord>;
	getTask(taskId: string): MaybePromise<IngestionTaskRecord | null>;
	completeTask(input: {
		result: IngestionTaskResult;
		taskId: string;
	}): MaybePromise<IngestionTaskRecord>;
	failTask(input: {
		errorCode: string;
		errorMessage: string;
		taskId: string;
	}): MaybePromise<IngestionTaskRecord>;
	cancelTask(input: { taskId: string; reason: string }): MaybePromise<IngestionTaskRecord>;
	listOperatorTaskProjections(
		filters: IngestionTaskProjectionFilters,
	): MaybePromise<IngestionTaskOperatorProjectionList>;
}

export type {
	IngestionTaskOperatorProjection,
	IngestionTaskOperatorProjectionList,
	IngestionTaskProjectionFilters,
	IngestionTaskRecord,
	IngestionWorkflowStatus,
} from "ingest-core";
export type {
	IngestionArtifactRef,
	IngestionTaskEnvelope,
	IngestionTaskExecutionSnapshot,
	IngestionTaskRegistry,
	IngestionTaskRegistryTask,
	IngestionTaskResult,
} from "ingestion-contracts";
