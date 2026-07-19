import type {
	IngestionTaskOperatorProjectionList,
	IngestionTaskProjectionFilters,
	IngestionTaskRecord,
} from "ingest-core";
import type {
	IngestionArtifactRef,
	IngestionTaskExecutionSnapshot,
	IngestionTaskResult,
} from "ingestion-contracts";

export type StoreClock = () => Date;
export type MaybePromise<T> = T | Promise<T>;

export interface RecordIngestionTaskStartedInput {
	createdBy: string;
	pipelineWorkflowId: string | null;
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

export interface OfflineReleaseStreamRecord {
	stream_id: string;
	source_channel: string;
	source_surface: "file_release" | "notice";
	corpus: string;
	collection: string;
	current_release_id: string | null;
	checkpoint: Record<string, unknown>;
	version: number;
	created_at: string;
	updated_at: string;
	last_check_at: string | null;
	last_check_mode: "incremental" | "reconcile" | "selected" | null;
	last_check_outcome: "deferred" | "failed" | "published" | "unchanged" | null;
	last_check_error_code: string | null;
	last_reconcile_at: string | null;
	last_published_at: string | null;
	last_added_count: number;
	last_updated_count: number;
	last_withdrawn_count: number;
}

export interface OfflineReleaseCheckRecord {
	addedCount: number;
	checkedAt: string;
	errorCode: string | null;
	mode: "incremental" | "reconcile" | "selected";
	outcome: "deferred" | "failed" | "published" | "unchanged";
	updatedCount: number;
	withdrawnCount: number;
}

export interface OfflineReleaseRecord {
	release_id: string;
	stream_id: string;
	previous_release_id: string | null;
	run_id: string;
	workflow_id: string;
	workflow_run_id: string;
	manifest_ref: IngestionArtifactRef;
	item_count: number;
	committed_at: string;
}

export interface OfflineReleaseStore {
	ensureStream(input: {
		collection: string;
		corpus: string;
		sourceChannel: string;
		sourceSurface: "file_release" | "notice";
		streamId: string;
	}): MaybePromise<OfflineReleaseStreamRecord>;
	getCurrentRelease(streamId: string): MaybePromise<OfflineReleaseRecord | null>;
	getReleaseByRun(streamId: string, runId: string): MaybePromise<OfflineReleaseRecord | null>;
	getStream(streamId: string): MaybePromise<OfflineReleaseStreamRecord | null>;
	recordCheck(input: {
		check: OfflineReleaseCheckRecord;
		streamId: string;
	}): MaybePromise<OfflineReleaseStreamRecord>;
	commitRelease(input: {
		check: OfflineReleaseCheckRecord;
		checkpoint: Record<string, unknown>;
		expectedStreamVersion: number;
		release: Omit<OfflineReleaseRecord, "committed_at">;
	}): MaybePromise<{ release: OfflineReleaseRecord; stream: OfflineReleaseStreamRecord }>;
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
