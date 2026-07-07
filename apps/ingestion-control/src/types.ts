import type {
	IngestionTaskOperatorProjectionList,
	IngestionTaskProjectionFilters,
	IngestionTaskRecord,
} from "ingest-core";
import type {
	IngestionArtifactRef as SharedIngestionArtifactRef,
	IngestionTaskEnvelope as SharedIngestionTaskEnvelope,
} from "ingestion-contracts";

export type StoreClock = () => Date;
export type MaybePromise<T> = T | Promise<T>;

export interface IngestionTaskAdmissionResult {
	created: boolean;
	record: IngestionTaskRecord;
}

export interface IngestionTaskStore {
	admitTask(task: SharedIngestionTaskEnvelope): MaybePromise<IngestionTaskAdmissionResult>;
	getTask(taskId: string): MaybePromise<IngestionTaskRecord | null>;
	markTaskRunning(input: {
		taskId: string;
		workflowRunId?: string | null;
	}): MaybePromise<IngestionTaskRecord>;
	completeTask(input: {
		artifactRefs?: SharedIngestionArtifactRef[];
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

export type IngestionExecutorKind = "rust_kernel" | "ts_control";

export type {
	IngestionTaskCloseout,
	IngestionTaskOperatorProjection,
	IngestionTaskOperatorProjectionList,
	IngestionTaskProjectionFilters,
	IngestionTaskRecord,
	IngestionWorkflowStatus,
} from "ingest-core";
export type {
	IngestionArtifactRef,
	IngestionTaskEnvelope,
	IngestionTaskRegistry,
	IngestionTaskRegistryTask,
} from "ingestion-contracts";
