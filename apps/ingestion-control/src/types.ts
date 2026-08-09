import type {
	IngestionTaskOperatorProjectionList,
	IngestionTaskProjectionFilters,
	IngestionTaskRecord,
} from "ingest-core";
import type { IngestionTaskExecutionSnapshot, IngestionTaskResult } from "ingestion-contracts";

const SAFE_INGESTION_ERROR_CODE = /^[A-Za-z0-9_.:-]{1,80}$/u;

export type StoreClock = () => Date;
export type MaybePromise<T> = T | Promise<T>;

export function assertSafeIngestionErrorCode(value: string): string {
	const code = value.trim();
	if (!SAFE_INGESTION_ERROR_CODE.test(code)) {
		throw new Error("ingestion task error code is invalid");
	}
	return code;
}

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
	failTask(input: { errorCode: string; taskId: string }): MaybePromise<IngestionTaskRecord>;
	cancelTask(input: { taskId: string }): MaybePromise<IngestionTaskRecord>;
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
